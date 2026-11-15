import type { ReviewDetail, RoomDetail, SnapshotDetail, SnapshotSummary } from '@devverse/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthContext';
import type { DiffViewerProps } from '../features/review/DiffViewer';
import { ReviewPage } from './ReviewPage';
import { ReviewsPage } from './ReviewsPage';

// Monaco doesn't run in jsdom. The stand-in shows what it was given and offers the gutter click as a button.
vi.mock('../features/review/DiffViewer', () => ({
  default: ({ path, original, modified, threads, onLineSelect }: DiffViewerProps) => (
    <div data-testid="diff">
      <p>
        diff of {path}: {original === null ? 'new' : 'old'} → {modified === null ? 'gone' : 'new'}
      </p>
      <p>markers on {threads.map((t) => t.line).join(',') || 'none'}</p>
      {onLineSelect && (
        <button type="button" onClick={() => onLineSelect(2)}>
          gutter line 2
        </button>
      )}
    </div>
  ),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const user = (id: string, username: string) => ({ id, username });
const session = (role: 'owner' | 'viewer') => ({
  accessToken: 't',
  expiresIn: 900,
  user: {
    ...(role === 'owner' ? user('u1', 'alice') : user('u3', 'carol')),
    email: 'x@example.com',
    stats: { solved: 0, xp: 0 },
    createdAt: '',
  },
});

const room = (role: 'owner' | 'viewer'): RoomDetail => ({
  slug: 'demo-abc123',
  name: 'Demo',
  language: 'python',
  visibility: 'public',
  owner: user('u1', 'alice'),
  memberCount: 2,
  role,
  updatedAt: '2026-11-15T09:00:00.000Z',
  projectId: 'p1',
  members: [],
  files: [],
});

const summary = (id: string, message: string): SnapshotSummary => ({
  id,
  projectId: 'p1',
  message,
  author: user('u1', 'alice'),
  fileCount: 2,
  createdAt: '2026-11-15T09:00:00.000Z',
});
const v1: SnapshotDetail = {
  ...summary('s1', 'First'),
  files: [
    { path: 'main.py', content: 'a = 1\nprint(a)\n' },
    { path: 'old.py', content: 'x = 1\n' },
  ],
};
const v2: SnapshotDetail = {
  ...summary('s2', 'Second'),
  files: [
    { path: 'main.py', content: 'a = 2\nprint(a)\nprint("done")\n' },
    { path: 'new.py', content: 'y = 2\n' },
  ],
};
const review: ReviewDetail = {
  id: 'r1',
  projectId: 'p1',
  snapshot: summary('s2', 'Second'),
  base: summary('s1', 'First'),
  requester: user('u1', 'alice'),
  status: 'open',
  openThreads: 1,
  commentCount: 1,
  createdAt: '2026-11-15T09:05:00.000Z',
  updatedAt: '2026-11-15T09:05:00.000Z',
  comments: [
    {
      id: 'c1',
      author: user('u2', 'bob'),
      path: 'main.py',
      line: 3,
      body: 'Print less?',
      parentId: null,
      resolved: false,
      createdAt: '2026-11-15T09:06:00.000Z',
      editedAt: null,
    },
  ],
};

function renderAt(
  url: string,
  routes: Record<string, Response[]>,
  role: 'owner' | 'viewer' = 'owner',
) {
  const queues = new Map(Object.entries(routes));
  const fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    if (u === '/api/v1/auth/refresh') return json(200, session(role));
    const queue = queues.get(`${init?.method ?? 'GET'} ${u}`);
    if (!queue?.length) return json(500, { title: `Unexpected request: ${u}` });
    return (queue.length > 1 ? queue.shift()! : queue[0]!).clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(
    [
      { path: '/rooms/:slug/reviews', element: <ReviewsPage /> },
      { path: '/rooms/:slug/reviews/:reviewId', element: <ReviewPage /> },
    ],
    { initialEntries: [url] },
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
  return { fetchMock, router };
}

afterEach(() => vi.unstubAllGlobals());

describe('ReviewsPage', () => {
  const { comments: _, ...reviewSummary } = review;

  it('lists open reviews and saved versions, and starts a review from a version', async () => {
    const { fetchMock, router } = renderAt('/rooms/demo-abc123/reviews', {
      'GET /api/v1/rooms/demo-abc123': [json(200, room('owner'))],
      'GET /api/v1/reviews?projectId=p1&status=open': [json(200, [reviewSummary])],
      'GET /api/v1/reviews?projectId=p1&status=closed': [json(200, [])],
      'GET /api/v1/projects/p1/snapshots': [
        json(200, [summary('s2', 'Second'), summary('s1', 'First')]),
      ],
      'POST /api/v1/reviews': [json(201, { ...review, id: 'r2', comments: [] })],
      'GET /api/v1/reviews/r2': [json(200, { ...review, id: 'r2', comments: [] })],
    });

    const link = await screen.findByRole('link', { name: 'Second' });
    expect(link).toHaveAttribute('href', '/rooms/demo-abc123/reviews/r1');
    expect(screen.getByText('1 unresolved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(router.state.location.search).toBe('?status=closed');
    expect(await screen.findByText('No closed reviews.')).toBeInTheDocument();

    const versions = screen.getByRole('region', { name: 'Saved versions' });
    const first = within(versions).getByText('First').closest('li')!;
    await userEvent.click(within(first).getByRole('button', { name: 'Ask for a review' }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && init.body);
    expect(JSON.parse(String(post![1]!.body))).toEqual({ snapshotId: 's1' });
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe('/rooms/demo-abc123/reviews/r2'),
    );
  });

  it("doesn't offer saving or reviewing to viewers", async () => {
    renderAt(
      '/rooms/demo-abc123/reviews?status=all',
      {
        'GET /api/v1/rooms/demo-abc123': [json(200, room('viewer'))],
        'GET /api/v1/reviews?projectId=p1': [json(200, [])],
        'GET /api/v1/projects/p1/snapshots': [json(200, [summary('s1', 'First')])],
      },
      'viewer',
    );
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for a review' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeInTheDocument();
  });
});

describe('ReviewPage', () => {
  const routes = (role: 'owner' | 'viewer') => ({
    'GET /api/v1/rooms/demo-abc123': [json(200, room(role))],
    'GET /api/v1/reviews/r1': [json(200, review)],
    'GET /api/v1/projects/p1/snapshots/s1': [json(200, v1)],
    'GET /api/v1/projects/p1/snapshots/s2': [json(200, v2)],
  });

  it('lists changed files with line counts and opens the first one', async () => {
    renderAt('/rooms/demo-abc123/reviews/r1', routes('owner'));
    const files = await screen.findByRole('navigation', { name: 'Files in this review' });
    const buttons = within(files).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('main.py'),
      expect.stringContaining('new.py'),
      expect.stringContaining('old.py'),
    ]);
    expect(buttons[0]).toHaveAccessibleName(
      /main\.py.*Changed, 2 lines added, 1 removed, 1 thread/,
    );
    expect(buttons[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('3 files changed,', { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('diff of main.py: old → new')).toBeInTheDocument();
    expect(screen.getByText('markers on 3')).toBeInTheDocument();
    expect(screen.getByText('Print less?')).toBeInTheDocument();
  });

  it('comments on a line picked in the gutter', async () => {
    const created = {
      ...review.comments[0]!,
      id: 'c9',
      line: 2,
      body: 'Why 2?',
      author: user('u1', 'alice'),
    };
    const { fetchMock } = renderAt('/rooms/demo-abc123/reviews/r1', {
      ...routes('owner'),
      'POST /api/v1/reviews/r1/comments': [json(201, created)],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'gutter line 2' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment on line 2 of main.py' }),
      'Why 2?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && init.body);
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      path: 'main.py',
      line: 2,
      body: 'Why 2?',
    });
    // The new thread appears straight away, with its marker.
    expect(await screen.findByText('Why 2?')).toBeInTheDocument();
    expect(screen.getByText('markers on 2,3')).toBeInTheDocument();
  });

  it('opens another file from the list, and keeps it in the URL', async () => {
    const { router } = renderAt('/rooms/demo-abc123/reviews/r1', routes('owner'));
    const files = await screen.findByRole('navigation', { name: 'Files in this review' });
    await userEvent.click(within(files).getByRole('button', { name: /old\.py/ }));
    expect(router.state.location.search).toBe('?file=old.py');
    expect(await screen.findByText('diff of old.py: old → gone')).toBeInTheDocument();
    expect(screen.getByText(/This file was deleted/)).toBeInTheDocument();
  });

  it('lets the requester close the review, and shows viewers no close button', async () => {
    const { fetchMock } = renderAt('/rooms/demo-abc123/reviews/r1', {
      ...routes('owner'),
      'PATCH /api/v1/reviews/r1': [json(200, { ...review, status: 'closed' })],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Close review' }));
    expect(await screen.findByRole('button', { name: 'Reopen review' })).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ status: 'closed' });
    expect(screen.getByText(/This review is closed/)).toBeInTheDocument();
  });

  it('hides closing from viewers who did not ask for the review', async () => {
    renderAt('/rooms/demo-abc123/reviews/r1', routes('viewer'), 'viewer');
    expect(await screen.findByText('Print less?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close review' })).not.toBeInTheDocument();
    // Viewers can still comment.
    expect(screen.getByRole('button', { name: 'gutter line 2' })).toBeInTheDocument();
  });
});
