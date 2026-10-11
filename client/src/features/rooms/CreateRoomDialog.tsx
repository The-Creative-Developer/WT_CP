import { createRoomSchema, LANGUAGE_IDS, LANGUAGES } from '@devverse/shared';
import { useId, useImperativeHandle, useRef, type Ref } from 'react';
import { useNavigate } from 'react-router';
import { FormError, SubmitButton } from '../../components/forms/FormParts';
import { TextField } from '../../components/forms/TextField';
import { useZodForm } from '../../hooks/useZodForm';
import { useCreateRoom } from './queries';

export interface CreateRoomDialogHandle {
  open(): void;
}

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', hint: 'Only people with your invite link can join.' },
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone signed in can watch; invited people can edit.',
  },
] as const;

// [CONCEPT: Native <dialog>] showModal() gives focus trapping, Esc to close, an inert background and a ::backdrop
// for free, with no focus-trap library.
export function CreateRoomDialog({ ref }: { ref: Ref<CreateRoomDialogHandle> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const languageId = useId();
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const { errors, formError, submitting, reset, formProps } = useZodForm(
    createRoomSchema,
    async (data) => {
      const room = await createRoom.mutateAsync(data);
      dialogRef.current?.close();
      navigate(`/rooms/${room.slug}`);
    },
  );

  // [CONCEPT: Imperative Handle] The parent gets a tiny open() API instead of reaching into the DOM node.
  useImperativeHandle(ref, () => ({
    open() {
      formRef.current?.reset();
      reset();
      dialogRef.current?.showModal();
    },
  }));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow-md)] backdrop:bg-black/50"
    >
      <form ref={formRef} {...formProps} aria-busy={submitting} className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-xl font-bold">
          New room
        </h2>
        <FormError message={formError} />

        <TextField
          label="Room name"
          name="name"
          autoComplete="off"
          required
          maxLength={60}
          // No autoFocus needed: showModal() focuses the first focusable element, which is this field.
          error={errors.name}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={languageId} className="text-sm font-medium">
            Language
          </label>
          <select
            id={languageId}
            name="language"
            defaultValue="javascript"
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            {LANGUAGE_IDS.map((id) => (
              <option key={id} value={id}>
                {LANGUAGES[id].label}
              </option>
            ))}
          </select>
        </div>

        {/* [CONCEPT: fieldset + legend] Groups radio buttons so screen readers announce the question with each option. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Who can join?</legend>
          {VISIBILITY_OPTIONS.map((option) => (
            <div
              key={option.value}
              className="relative flex gap-3 rounded-md border border-border p-3 has-[:checked]:border-accent"
            >
              <input
                id={`${titleId}-${option.value}`}
                type="radio"
                name="visibility"
                value={option.value}
                defaultChecked={option.value === 'private'}
                // Short name ("Private") plus a separate description, rather than one long run-on label.
                aria-describedby={`${titleId}-${option.value}-hint`}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <div>
                {/* The ::after stretches the label over the whole box, so clicking anywhere selects it. */}
                <label
                  htmlFor={`${titleId}-${option.value}`}
                  className="block cursor-pointer font-medium after:absolute after:inset-0 after:content-['']"
                >
                  {option.label}
                </label>
                <p id={`${titleId}-${option.value}-hint`} className="text-sm text-muted">
                  {option.hint}
                </p>
              </div>
            </div>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="mt-2 rounded-lg border border-border px-4 py-2.5 hover:bg-surface-2"
          >
            Cancel
          </button>
          <SubmitButton submitting={submitting} idle="Create room" busy="Creating…" />
        </div>
      </form>
    </dialog>
  );
}
