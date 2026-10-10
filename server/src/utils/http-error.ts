// [CONCEPT: HTTP Status Codes] Throw an HttpError anywhere; the error middleware turns it into the right status + body.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
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
}
