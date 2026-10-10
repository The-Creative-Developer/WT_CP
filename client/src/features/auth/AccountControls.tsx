import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from './AuthContext';

export function AccountControls() {
  const { state, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  if (state.status === 'loading') return null;

  if (state.status === 'anonymous') {
    return (
      <div className="flex items-center gap-1">
        <Link to="/login" className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-fg">
          Log in
        </Link>
        <Link
          to="/register"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast max-sm:hidden"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium max-sm:sr-only">
        <span className="sr-only">Signed in as </span>@{state.user.username}
      </span>
      <button
        type="button"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          await logout().catch(() => undefined);
          setLeaving(false);
        }}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
      >
        Log out
      </button>
    </div>
  );
}
