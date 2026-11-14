import {
  basename,
  filePathSchema,
  folderMoveConflict,
  moveFolderSchema,
  pathConflict,
} from '@devverse/shared';
import { useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { z } from 'zod';
import { FormError, SubmitButton } from '../../components/forms/FormParts';
import { TextField } from '../../components/forms/TextField';
import { useZodForm } from '../../hooks/useZodForm';
import { ApiError } from '../../lib/api';
import { countFiles, type TreeNode } from './tree';

export type FileNameMode = { kind: 'create'; folder: string } | { kind: 'rename'; node: TreeNode };

export interface FileNameDialogHandle {
  open(mode: FileNameMode): void;
}

const dialogClass =
  'm-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow-md)] backdrop:bg-black/50';

/** The checks the server makes, run first so a clash is explained before anything is sent. */
function schemaFor(mode: FileNameMode | null, existing: string[]) {
  return z.object({ path: filePathSchema }).superRefine(({ path }, ctx) => {
    let problem: string | null = null;
    if (mode?.kind === 'create') problem = pathConflict(existing, path);
    else if (mode?.node.kind === 'file' && path !== mode.node.path) {
      const self = mode.node.path;
      problem = pathConflict(
        existing.filter((p) => p !== self),
        path,
      );
    } else if (mode?.node.kind === 'folder' && path !== mode.node.path) {
      const move = moveFolderSchema.safeParse({ from: mode.node.path, to: path });
      problem = move.success
        ? folderMoveConflict(existing, mode.node.path, path)
        : (move.error.issues[0]?.message ?? null);
    }
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['path'] });
  });
}

/** One dialog for "New file" and "Rename", since both come down to typing a path. */
export function FileNameDialog({
  ref,
  existing,
  onCreate,
  onRename,
}: {
  ref: Ref<FileNameDialogHandle>;
  existing: string[];
  onCreate: (path: string) => Promise<void>;
  onRename: (node: TreeNode, path: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<FileNameMode | null>(null);
  // Remounts the form on every open, so the field starts from its new default value.
  const [opened, setOpened] = useState(0);
  const schema = useMemo(() => schemaFor(mode, existing), [mode, existing]);
  const { errors, formError, submitting, reset, formProps } = useZodForm(
    schema,
    async ({ path }) => {
      if (mode?.kind === 'create') await onCreate(path);
      else if (mode && path !== mode.node.path) await onRename(mode.node, path);
      dialogRef.current?.close();
    },
  );

  useImperativeHandle(ref, () => ({
    open(next) {
      reset();
      setMode(next);
      setOpened((n) => n + 1);
      dialogRef.current?.showModal();
      // Select just the name (not the folders or the extension), the part people usually change.
      requestAnimationFrame(() => {
        const input = formRef.current?.elements.namedItem('path');
        if (!(input instanceof HTMLInputElement)) return;
        input.focus();
        const name = basename(input.value);
        const start = input.value.length - name.length;
        const dot =
          next.kind === 'rename' && next.node.kind === 'file' ? name.lastIndexOf('.') : -1;
        input.setSelectionRange(start, dot > 0 ? start + dot : input.value.length);
      });
    },
  }));

  const isFolder = mode?.kind === 'rename' && mode.node.kind === 'folder';
  const title = mode?.kind === 'create' ? 'New file' : isFolder ? 'Rename folder' : 'Rename file';
  const defaultValue =
    mode?.kind === 'create' ? (mode.folder ? `${mode.folder}/` : '') : (mode?.node.path ?? '');

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className={dialogClass}>
      <form
        key={opened}
        ref={formRef}
        {...formProps}
        aria-busy={submitting}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        <FormError message={formError} />
        <TextField
          label={isFolder ? 'Folder path' : 'File path'}
          name="path"
          defaultValue={defaultValue}
          autoComplete="off"
          spellCheck={false}
          required
          hint={
            isFolder
              ? 'Every file inside moves with it.'
              : 'Use / for folders, e.g. src/utils.py. Changing the folders moves the file.'
          }
          error={errors.path}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="mt-2 rounded-lg border border-border px-4 py-2.5 hover:bg-surface-2"
          >
            Cancel
          </button>
          <SubmitButton
            submitting={submitting}
            idle={mode?.kind === 'create' ? 'Create' : 'Rename'}
            busy={mode?.kind === 'create' ? 'Creating…' : 'Renaming…'}
          />
        </div>
      </form>
    </dialog>
  );
}

export interface DeleteFileDialogHandle {
  open(node: TreeNode): void;
}

export function DeleteFileDialog({
  ref,
  onDelete,
}: {
  ref: Ref<DeleteFileDialogHandle>;
  onDelete: (node: TreeNode) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [node, setNode] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    open(next) {
      setNode(next);
      setError(null);
      dialogRef.current?.showModal();
    },
  }));

  async function confirm() {
    if (!node) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(node);
      dialogRef.current?.close();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't delete it. Check your connection.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const count = node?.kind === 'folder' ? countFiles(node) : 1;

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className={dialogClass}>
      <div className="flex flex-col gap-3 p-6">
        <h2 id={titleId} className="text-lg font-bold break-all">
          {node?.kind === 'folder'
            ? `Delete ${node.path}/ and the ${count === 1 ? 'file' : `${count} files`} in it?`
            : `Delete ${node?.path ?? ''}?`}
        </h2>
        <p className="text-sm text-muted">
          It's deleted for everyone in the room, and anyone editing it is disconnected. This can't
          be undone.
        </p>
        <FormError message={error} />
        <div className="mt-3 flex justify-end gap-2">
          {/* The safe choice comes first, so it gets focus when the dialog opens. */}
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg border border-border px-4 py-2 hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void confirm()}
            className="rounded-lg bg-danger px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
