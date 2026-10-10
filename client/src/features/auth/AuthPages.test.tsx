import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import { LoginPage, RegisterPage } from './AuthPages';
import { GuestOnly } from './RouteGuards';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Renders a page as a signed-out visitor: the startup refresh call returns 401. */
function renderSignedOut(page: React.ReactNode, ...responses: Response[]) {
  const fetchMock = vi.fn().mockResolvedValueOnce(json(401, { title: 'No active session' }));
  responses.forEach((r) => fetchMock.mockResolvedValueOnce(r));
  vi.stubGlobal('fetch', fetchMock);

  const router = createMemoryRouter(
    [
      { element: <GuestOnly />, children: [{ path: '/', element: page }] },
      { path: '/dashboard', element: <p>Dashboard page</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('links validation errors to their fields and focuses the first invalid one', async () => {
    const fetchMock = renderSignedOut(<LoginPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }));

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
    expect(email).toHaveFocus();
    // Nothing was sent to the server except the startup session check.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('announces a server error in an alert', async () => {
    renderSignedOut(<LoginPage />, json(401, { title: 'Invalid email or password' }));

    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('redirects to the dashboard after logging in', async () => {
    renderSignedOut(
      <LoginPage />,
      json(200, {
        accessToken: 't',
        expiresIn: 900,
        user: {
          id: '1',
          username: 'alice',
          email: 'a@b.co',
          stats: { solved: 0, xp: 0 },
          createdAt: '',
        },
      }),
    );

    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('lets the user reveal the password', async () => {
    renderSignedOut(<LoginPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});

describe('RegisterPage', () => {
  it('shows a server-side conflict on the right field', async () => {
    renderSignedOut(
      <RegisterPage />,
      json(409, {
        title: 'That username is taken',
        errors: { username: ['That username is taken'] },
      }),
    );

    await userEvent.type(await screen.findByLabelText('Username'), 'alice');
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const username = await screen.findByLabelText('Username');
    expect(await screen.findByText('That username is taken')).toBeInTheDocument();
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveFocus();
  });
});
