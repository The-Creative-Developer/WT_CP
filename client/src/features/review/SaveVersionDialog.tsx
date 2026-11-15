import { createSnapshotSchema, type SnapshotDetail } from '@devverse/shared';
import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { FormError, SubmitButton } from '../../components/forms/FormParts';
import { TextField } from '../../components/forms/TextField';
import { useZodForm } from '../../hooks/useZodForm';
import { useCreateSnapshot } from './queries';

export interface SaveVersionDialogHandle {
  open(): void;
}

const dialogClass =
  'm-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow-md)] backdrop:bg-black/50';

/** Asks for a short description, then saves every file as a new version (snapshot). */
export function SaveVersionDialog({
  ref,
  projectId,
  onSaved,
}: {
  ref: Ref<SaveVersionDialogHandle>;
  projectId: string;
  onSaved?: (snapshot: SnapshotDetail) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [opened, setOpened] = useState(0);
  const save = useCreateSnapshot(projectId);
  const { errors, formError, submitting, reset, formProps } = useZodForm(
    createSnapshotSchema,
    async ({ message }) => {
      const snapshot = await save.mutateAsync(message);
      dialogRef.current?.close();
      onSaved?.(snapshot);
    },
  );

  useImperativeHandle(ref, () => ({
    open() {
      reset();
      setOpened((n) => n + 1);
      dialogRef.current?.showModal();
      // The form remounts (key) after showModal has focused it, so focus the new field once it exists.
      requestAnimationFrame(() => {
        const input = formRef.current?.elements.namedItem('message');
        if (input instanceof HTMLInputElement) input.focus();
      });
    },
  }));

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
          Save a version
        </h2>
        <p className="text-sm text-muted">
          Saves a copy of every file as it is right now, including edits that are still being saved.
          You can ask for a review of it, and compare it with other versions later.
        </p>
        <FormError message={formError} />
        <TextField
          label="What changed?"
          name="message"
          autoComplete="off"
          required
          hint="A few words, like a commit message."
          error={errors.message}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="mt-2 rounded-lg border border-border px-4 py-2.5 hover:bg-surface-2"
          >
            Cancel
          </button>
          <SubmitButton submitting={submitting} idle="Save version" busy="Saving…" />
        </div>
      </form>
    </dialog>
  );
}
