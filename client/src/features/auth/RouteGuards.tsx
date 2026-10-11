import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

export interface RedirectState {
  from?: string;
}

function SessionCheck() {
  return (
    <p role="status" className="py-16 text-center text-muted">
      Checking your session…
    </p>
  );
}

// [CONCEPT: Protected Routes] Signed-out visitors are sent to log in, and come back here afterwards.
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <SessionCheck />;
  if (state.status === 'anonymous') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from } satisfies RedirectState} />;
  }
  return <Outlet />;
}

/**
 * Login and sign-up pages. Once the user is signed in (including the moment a login succeeds), send them back to
 * the page that asked them to log in.
 */
export function GuestOnly() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <SessionCheck />;
  if (state.status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    // [CONCEPT: Open Redirect Prevention] Only follow same-app paths; "//evil.example" would leave the site.
    const target = from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
