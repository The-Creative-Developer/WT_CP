import { useId, useState, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}

const inputClass =
  'w-full rounded-md border bg-surface px-3 py-2 text-fg placeholder:text-muted aria-[invalid=true]:border-danger';

// [CONCEPT: Accessible Form Fields] A real <label>, plus aria-describedby linking the hint and error text, so a
// screen reader announces "Email, invalid entry, Enter a valid email address" when the field gets focus.
export function TextField({ label, name, error, hint, type = 'text', ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputClass} ${error ? 'border-danger' : 'border-border'} ${isPassword ? 'pr-16' : ''}`}
          {...input}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            // The accessible name contains the visible word (WCAG 2.5.3 "Label in Name").
            aria-label={`${revealed ? 'Hide' : 'Show'} password`}
            aria-controls={id}
            className="absolute inset-y-1 right-1 rounded px-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
