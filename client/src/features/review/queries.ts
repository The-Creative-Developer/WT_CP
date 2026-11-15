import type {
  CreateCommentInput,
  ReviewComment,
  ReviewDetail,
  ReviewStatus,
  ReviewSummary,
  SnapshotDetail,
  SnapshotSummary,
} from '@devverse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

export const reviewKeys = {
  snapshots: (projectId: string) => ['projects', projectId, 'snapshots'] as const,
  snapshot: (projectId: string, id: string) => ['projects', projectId, 'snapshots', id] as const,
  reviews: (projectId: string) => ['projects', projectId, 'reviews'] as const,
  review: (id: string) => ['reviews', id] as const,
};

const project = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}`;
const noRetryOn4xx = (count: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && count < 2;

// Other people's comments and reviews show up without a reload. TanStack Query pauses this while the tab is hidden
// (Page Visibility) and refetches when it comes back into view.
const LIVE_REFRESH_MS = 15_000;

export function useSnapshots(projectId: string) {
  return useQuery({
    queryKey: reviewKeys.snapshots(projectId),
    queryFn: () => api<SnapshotSummary[]>(`${project(projectId)}/snapshots`),
  });
}

/** A saved version never changes, so once loaded it's never fetched again. */
export function useSnapshot(projectId: string, id: string | null | undefined) {
  return useQuery({
    queryKey: reviewKeys.snapshot(projectId, id ?? ''),
    queryFn: () => api<SnapshotDetail>(`${project(projectId)}/snapshots/${id}`),
    enabled: Boolean(id),
    staleTime: Infinity,
    retry: noRetryOn4xx,
  });
}

export function useCreateSnapshot(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) =>
      api<SnapshotDetail>(`${project(projectId)}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(reviewKeys.snapshot(projectId, snapshot.id), snapshot);
      void queryClient.invalidateQueries({ queryKey: reviewKeys.snapshots(projectId) });
    },
  });
}

export function useReviews(projectId: string, status?: ReviewStatus) {
  return useQuery({
    queryKey: [...reviewKeys.reviews(projectId), status ?? 'all'],
    queryFn: () => {
      const query = new URLSearchParams({ projectId, ...(status ? { status } : {}) });
      return api<ReviewSummary[]>(`/api/v1/reviews?${query}`);
    },
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useReview(id: string) {
  return useQuery({
    queryKey: reviewKeys.review(id),
    queryFn: () => api<ReviewDetail>(`/api/v1/reviews/${encodeURIComponent(id)}`),
    refetchInterval: LIVE_REFRESH_MS,
    retry: noRetryOn4xx,
  });
}

export function useCreateReview(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api<ReviewDetail>('/api/v1/reviews', {
        method: 'POST',
        body: JSON.stringify({ snapshotId }),
      }),
    onSuccess: (review) => {
      queryClient.setQueryData(reviewKeys.review(review.id), review);
      void queryClient.invalidateQueries({ queryKey: reviewKeys.reviews(projectId) });
    },
  });
}

/** Everything that changes a review: closing it, commenting, resolving. Each updates the cached review at once. */
export function useReviewMutations(review: ReviewDetail) {
  const queryClient = useQueryClient();
  const base = `/api/v1/reviews/${encodeURIComponent(review.id)}`;
  const key = reviewKeys.review(review.id);

  const replaceComment = (comment: ReviewComment) =>
    queryClient.setQueryData<ReviewDetail>(key, (r) => {
      if (!r) return r;
      const exists = r.comments.some((c) => c.id === comment.id);
      const comments = exists
        ? r.comments.map((c) => (c.id === comment.id ? comment : c))
        : [...r.comments, comment];
      return {
        ...r,
        comments,
        commentCount: comments.length,
        openThreads: comments.filter((c) => c.parentId === null && !c.resolved).length,
      };
    });
  const listsChanged = () =>
    void queryClient.invalidateQueries({ queryKey: reviewKeys.reviews(review.projectId) });

  const setStatus = useMutation({
    mutationFn: (status: ReviewStatus) =>
      api<ReviewDetail>(base, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      listsChanged();
    },
  });
  const addComment = useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api<ReviewComment>(`${base}/comments`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (comment) => {
      replaceComment(comment);
      listsChanged();
    },
  });
  const setResolved = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api<ReviewComment>(`${base}/comments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved }),
      }),
    onSuccess: (comment) => {
      replaceComment(comment);
      listsChanged();
    },
  });

  return { setStatus, addComment, setResolved };
}
