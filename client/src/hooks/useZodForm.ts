import { useState, type FocusEvent, type FormEvent } from 'react';
import { z, type ZodType } from 'zod';
import { ApiError } from '../lib/api';

type FieldErrors = Record<string, string | undefined>;

function readForm(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value : '']),
  );
}

function firstErrors(error: z.ZodError): FieldErrors {
  const { fieldErrors } = z.flattenError(error);
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([field, messages]) => [field, (messages as string[])[0]]),
  );
}

function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors) {
  for (const element of form.elements) {
    if (element instanceof HTMLInputElement && errors[element.name]) {
      element.focus();
      return;
    }
  }
}

/**
 * Validates an uncontrolled form against a (shared) Zod schema.
 * Errors appear on submit; after that they update on blur, so a fixed field clears straight away.
 */
export function useZodForm<Schema extends ZodType>(
  schema: Schema,
  onValid: (data: z.output<Schema>) => Promise<void>,
) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    // [CONCEPT: Client-Side Validation] Instant feedback; the server still validates, because the client can be bypassed.
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(null);
    setAttempted(true);

    const result = schema.safeParse(readForm(form));
    if (!result.success) {
      const next = firstErrors(result.error);
      setErrors(next);
      focusFirstInvalid(form, next);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await onValid(result.data);
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : {};
      if (Object.keys(fieldErrors).length > 0) {
        const next = Object.fromEntries(
          Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0]]),
        );
        setErrors(next);
        focusFirstInvalid(form, next);
      } else {
        setFormError(
          err instanceof ApiError
            ? err.message
            : 'Could not reach the server. Check your connection.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onBlur(event: FocusEvent<HTMLFormElement>) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.name) return;
    // [CONCEPT: Inline Validation Timing] Before the first submit, blur only clears errors, never adds them. Adding one
    // would shift the layout under the pointer, so a click on "Submit" could land on empty space.
    if (!attempted && !errors[field.name]) return;

    const result = schema.safeParse(readForm(event.currentTarget));
    const message = result.success ? undefined : firstErrors(result.error)[field.name];
    setErrors((prev) => ({ ...prev, [field.name]: message }));
  }

  return { errors, formError, submitting, formProps: { onSubmit, onBlur, noValidate: true } };
}
