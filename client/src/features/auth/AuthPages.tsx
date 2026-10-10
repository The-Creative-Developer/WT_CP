import { loginSchema, registerSchema } from '@devverse/shared';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { TextField } from '../../components/forms/TextField';
import { useZodForm } from '../../hooks/useZodForm';
import { useAuth } from './AuthContext';

// After a successful login or sign-up, GuestOnly sees the new session and redirects, so no navigate() here.

export function LoginPage() {
  const { login } = useAuth();
  const { errors, formError, submitting, formProps } = useZodForm(loginSchema, async (data) => {
    await login(data);
  });

  return (
    <AuthCard
      title="Log in"
      footer={
        <>
          New to DevVerse? <SwitchLink to="/register">Create an account</SwitchLink>
        </>
      }
    >
      <form {...formProps} aria-busy={submitting} className="flex flex-col gap-4">
        <FormError message={formError} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <SubmitButton submitting={submitting} idle="Log in" busy="Logging in…" />
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { errors, formError, submitting, formProps } = useZodForm(registerSchema, async (data) => {
    await register(data);
  });

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account? <SwitchLink to="/login">Log in</SwitchLink>
        </>
      }
    >
      <form {...formProps} aria-busy={submitting} className="flex flex-col gap-4">
        <FormError message={formError} />
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          hint="3–24 characters: letters, numbers, - and _. Shown to other coders."
          required
          error={errors.username}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          // [CONCEPT: autocomplete Tokens] "new-password" tells password managers to offer a strong generated one.
          autoComplete="new-password"
          hint="At least 8 characters. A short phrase is easier to remember."
          required
          error={errors.password}
        />
        <SubmitButton submitting={submitting} idle="Create account" busy="Creating account…" />
      </form>
    </AuthCard>
  );
}

function AuthCard({
  title,
  footer,
  children,
}: {
  title: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="auth-title" className="mx-auto w-full max-w-sm py-8">
      {/* [CONCEPT: Document Metadata] React 19 hoists <title> into <head>, so each page gets a meaningful tab title. */}
      <title>{`${title} · DevVerse`}</title>
      <h1 id="auth-title" className="mb-6 text-2xl font-bold">
        {title}
      </h1>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-md)]">
        {children}
      </div>
      <p className="mt-4 text-center text-sm text-muted">{footer}</p>
    </section>
  );
}

/** Keeps the "where to go after login" state when switching between the login and sign-up pages. */
function SwitchLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  return (
    <Link to={to} state={location.state} className="font-medium text-accent underline">
      {children}
    </Link>
  );
}

function FormError({ message }: { message: string | null }) {
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

function SubmitButton({
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
