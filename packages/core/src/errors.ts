/**
 * Typed domain errors. The API boundary maps these to status codes; nothing
 * below the boundary should know about HTTP.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The input was malformed or violated an invariant. */
export class ValidationError extends DomainError {
  readonly code = 'validation_error';
}

/** The requested resource does not exist, or does not belong to this user. */
export class NotFoundError extends DomainError {
  readonly code = 'not_found';
}

/** The caller is authenticated but not permitted to do this. */
export class ForbiddenError extends DomainError {
  readonly code = 'forbidden';
}

/** The caller could not be authenticated at all. */
export class UnauthorizedError extends DomainError {
  readonly code = 'unauthorized';
}
