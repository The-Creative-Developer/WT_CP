import { useServerHealth } from '../../hooks/useServerHealth';

export function ServerStatus() {
  const { data, isError, isPending } = useServerHealth();
  const label = isPending
    ? 'Checking server…'
    : isError
      ? 'API unreachable'
      : data.status === 'ok'
        ? 'All systems online'
        : 'Database offline';
  const color = !isPending && !isError && data.status === 'ok' ? 'bg-green-500' : 'bg-amber-500';

  return (
    // [CONCEPT: Live Regions] Screen readers announce status changes without moving focus.
    <p role="status" aria-live="polite" className="flex items-center justify-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </p>
  );
}
