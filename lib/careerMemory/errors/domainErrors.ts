/*
  Phase 6D - Domain error model. Every error a repository/service/API
  route in lib/careerMemory/{repositories,services,api}/** throws is one
  of these - never a raw PostgREST error object, never a bare Error with
  a SQL message, never a stack trace surfaced to a caller. API routes
  map these to HTTP status codes (see api/httpErrorMapping.ts); nothing
  outside this file needs to know what a PostgREST error code means.
*/

export type DomainErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PERSISTENCE_ERROR"
  | "TRANSACTION_UNAVAILABLE"
  | "SCHEMA_GAP";

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationRequiredError extends DomainError {
  readonly code = "AUTHENTICATION_REQUIRED" as const;
  constructor(message = "Authentication required.") {
    super(message);
  }
}

export class AuthorizationError extends DomainError {
  readonly code = "AUTHORIZATION_DENIED" as const;
  constructor(message = "You do not have access to this resource.") {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor(resource: string) {
    super(`${resource} not found.`);
  }
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_FAILED" as const;
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.length === 1 ? issues[0] : `${issues.length} validation issue(s): ${issues.join("; ")}`);
    this.issues = issues;
  }
}

export class ConflictError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
  }
}

/*
  Wraps a real persistence failure (e.g. a PostgREST error not otherwise
  classified below) - `safeDetail` is a short, pre-sanitized category
  string (never the raw driver message, never SQL text) suitable for
  logs/response bodies. The original error is deliberately NOT attached
  as a `cause` field that a caller might serialize - see
  mapPostgrestError()'s own header comment.
*/
export class PersistenceError extends DomainError {
  readonly code = "PERSISTENCE_ERROR" as const;
  constructor(safeDetail: string) {
    super(`Persistence operation failed: ${safeDetail}`);
  }
}

export class TransactionUnavailableError extends DomainError {
  readonly code = "TRANSACTION_UNAVAILABLE" as const;
  constructor(operation: string) {
    super(`${operation} requires multi-table atomicity that is not available this round (TRANSACTION_SCHEMA_GAP) - see lib/careerMemory/transactions/README for the disclosed gap.`);
  }
}

export class SchemaGapError extends DomainError {
  readonly code = "SCHEMA_GAP" as const;
  readonly gap: string;
  constructor(gap: string, detail: string) {
    super(`${gap}: ${detail}`);
    this.gap = gap;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
