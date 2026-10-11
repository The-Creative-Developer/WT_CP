export function FormError({ message }: { message: string | null }) {
  // [CONCEPT: Live Regions] role="alert" is announced immediately when the message appears.
  return (
    <div role="alert" className="empty:hidden">
      {message && (
        <p className="rounded-md border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  submitting,
  idle,
  busy,
}: {
  submitting: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="mt-2 rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast disabled:opacity-60"
    >
      {submitting ? busy : idle}
    </button>
  );
}
