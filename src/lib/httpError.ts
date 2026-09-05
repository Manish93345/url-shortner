import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function validationError(err: ZodError): HttpError {
  return new HttpError(400, 'Validation failed',
    err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
}