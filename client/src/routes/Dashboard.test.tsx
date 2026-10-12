import type { RoomDetail } from '@devverse/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthContext';
import { Dashboard } from './Dashboard';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const session = {
  accessToken: 't',
  expiresIn: 900,
  user: {
    id: 'u1',
    username: 'alice',
    email: 'a@b.co',
    stats: { solved: 0, xp: 0 },
    createdAt: '',
  },
};

const createdRoom: RoomDetail = {
  slug: 'pair-programming-abc123',
  name: 'Pair Programming',
  language: 'python',
  visibility: 'private',
  owner: { id: 'u1', username: 'alice' },
  memberCount: 1,
  role: 'owner',
  updatedAt: new Date().toISOString(),
  projectId: 'p1',
  members: [{ id: 'u1', username: 'alice', role: 'owner' }],
  files: [{ id: 'f1', path: 'main.py' }],
  inviteCode: 'secret',
};

/**
 * Signed in as alice. Responses are routed by "METHOD /path"; a list of responses is served in order, and the last
 * one repeats. Routing by URL (not call order) keeps tests independent of which component fetches first.
 */
function renderDashboard(routes: Record<string, Response[]>) {
  const queues = new Map(Object.entries(routes));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return json(200, session);
    const queue = queues.get(`${init?.method ?? 'GET'} ${url}`);
    if (!queue?.length) return json(500, { title: `Unexpected request: ${url}` });
    return (queue.length > 1 ? queue.shift()! : queue[0]!).clone();
  });
  vi.stubGlobal('fetch', fetchMock);

  const router = createMemoryRouter(
    [
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/rooms/:slug', element: <p>Room page</p> },
    ],
    { initialEntries: ['/dashboard'] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard', () => {
  it('lists rooms as a grid of linked cards', async () => {
    renderDashboard({ 'GET /api/v1/rooms': [json(200, [createdRoom])] });
    const link = await screen.findByRole('link', { name: 'Pair Programming' });
    expect(link).toHaveAttribute('href', '/rooms/pair-programming-abc123');
    const card = link.closest('article')!;
    expect(within(card).getByText('Python')).toBeInTheDocument();
  });

  it('creates a room from the dialog and opens it', async () => {
    const fetchMock = renderDashboard({
      'GET /api/v1/rooms': [json(200, []), json(200, [createdRoom])],
      'POST /api/v1/rooms': [json(201, createdRoom)],
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Create your first room' }));
    const dialog = screen.getByRole('dialog', { name: 'New room' });

    // Too-short name is caught before anything is sent.
    await userEvent.type(within(dialog).getByLabelText('Room name'), 'ab');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));
    expect(within(dialog).getByLabelText('Room name')).toHaveAccessibleDescription(
      'Room name must be at least 3 characters',
    );

    await userEvent.type(within(dialog).getByLabelText('Room name'), 'c pairing');
    await userEvent.selectOptions(within(dialog).getByLabelText('Language'), 'python');
    expect(within(dialog).getByRole('radio', { name: 'Private' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));

    expect(await screen.findByText('Room page')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && init.body);
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      name: 'abc pairing',
      language: 'python',
      visibility: 'private',
    });
  });

  it('offers a retry when the rooms fail to load', async () => {
    renderDashboard({
      'GET /api/v1/rooms': [
        json(500, { title: 'Internal Server Error' }),
        json(200, [createdRoom]),
      ],
    });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your rooms.");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Pair Programming' })).toBeInTheDocument();
  });
});
