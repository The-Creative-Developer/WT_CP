import { useAuth } from '../features/auth/AuthContext';

export function Dashboard() {
  const { state } = useAuth();
  const username = state.status === 'authenticated' ? state.user.username : '';

  return (
    <section aria-labelledby="page-title">
      <title>Dashboard · DevVerse</title>
      <h1 id="page-title" className="text-2xl font-bold">
        Welcome back, {username}
      </h1>
      <p className="mt-2 text-muted">Your rooms will appear here. Room creation is coming next.</p>
    </section>
  );
}
