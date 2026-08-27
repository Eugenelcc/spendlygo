import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@spendlygo/core';
import { describeError, logger } from '../logger.js';

function statusFor(error: DomainError): 400 | 401 | 403 | 404 {
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  return 400;
}

/**
 * Maps domain errors to status codes at the boundary — nothing below the
 * boundary knows about HTTP. Unexpected errors are logged and reported as a
 * generic 500: GUARDRAILS.md section 6 forbids leaking internals to the client.
 */
export const onError: ErrorHandler = (error, c) => {
  if (error instanceof DomainError) {
    const status = statusFor(error);
    if (status >= 500) logger.error('api.error', describeError(error));
    return c.json({ error: { code: error.code, message: error.message } }, status);
  }

  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'http_error', message: error.message } }, error.status);
  }

  logger.error('api.unhandled', { path: c.req.path, ...describeError(error) });
  return c.json(
    { error: { code: 'internal_error', message: 'Something went wrong on our side.' } },
    500,
  );
};

export const onNotFound: NotFoundHandler = (c) =>
  c.json({ error: { code: 'not_found', message: `No route for ${c.req.path}` } }, 404);
