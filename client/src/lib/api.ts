// Thin fetch wrapper. Week 1 Day 4 adds: in-memory access token + silent refresh on 401.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include', // send the refresh-token cookie
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const title =
      isJson && body && typeof body === 'object' && 'title' in body
        ? String(body.title)
        : res.statusText;
    throw new ApiError(res.status, title, body);
  }
  return body as T;
}
