import { useQuery } from '@tanstack/react-query';

interface Health {
  status: 'ok' | 'degraded';
  db: 'connected' | 'disconnected';
}

// [CONCEPT: Server State Caching] TanStack Query caches, dedupes and periodically refetches server data.
export function useServerHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<Health> => {
      // 503 still carries a JSON body describing what is down, so read it instead of throwing.
      const res = await fetch('/healthz');
      return res.json();
    },
    refetchInterval: 30_000,
    retry: false,
  });
}
