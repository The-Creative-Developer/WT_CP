// [CONCEPT: HTTP Status Codes] Throw an HttpError anywhere; the error middleware turns it into the right status + body.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    /** Extra response headers, e.g. Retry-After on a 429 or 503. */
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new HttpError(400, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new HttpError(403, message);
  }
  static notFound(message = 'Resource not found') {
    return new HttpError(404, message);
  }
  static conflict(message = 'Resource already exists', details?: unknown) {
    return new HttpError(409, message, details);
  }
  // [CONCEPT: Retry-After] Tells a well-behaved client how many seconds to wait before trying again.
  static tooManyRequests(message: string, retryAfterSeconds: number) {
    return new HttpError(429, message, undefined, { 'Retry-After': String(retryAfterSeconds) });
  }
  static serviceUnavailable(message: string, retryAfterSeconds: number) {
    return new HttpError(503, message, undefined, { 'Retry-After': String(retryAfterSeconds) });
  }
}
