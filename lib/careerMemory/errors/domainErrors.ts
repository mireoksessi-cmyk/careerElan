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
  | "SCHEMA_GAP"
  /* Phase 6G additions - Canonical Generate Package integration. Kept
     in the same shared union (rather than a parallel error system) so
     every new route goes through the same single errorResponse()
     mapping everything else already uses. */
  | "MALFORMED_REQUEST"
  | "QUOTA_EXCEEDED";

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

export class MalformedRequestError extends DomainError {
  readonly code = "MALFORMED_REQUEST" as const;
  constructor(message: string) {
    super(message);
  }
}

export class QuotaExceededError extends DomainError {
  readonly code = "QUOTA_EXCEEDED" as const;
  constructor(message = "Generation quota exceeded.") {
    super(message);
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/*
  Phase 6G - Canonical Generate Package domain errors. Every one maps
  onto the SAME 10-code DomainErrorCode union above (never a parallel
  error/HTTP-mapping system) - see the round spec's own §23 error list
  for the intended name-to-status mapping; each class below picks the
  existing DomainErrorCode whose HTTP status already matches what §23
  asks for that error, rather than inventing new statuses:
    CanonicalProfileUnavailableError/CanonicalVersionUnavailableError -> NOT_FOUND (404)
    CanonicalDeserializationError -> PERSISTENCE_ERROR (500, genuinely unexpected)
    CanonicalTailoringError/CanonicalOverlayValidationError -> VALIDATION_FAILED (422)
    TemplateResolutionError -> NOT_FOUND (404, unknown template id) or
      MALFORMED_REQUEST (400, unsupported format/paperSize/density for an
      otherwise-valid template) - two constructors, see below.
    TemplateRenderingError/GeneratedDocumentError -> PERSISTENCE_ERROR (500)
    LegacyFallbackError -> PERSISTENCE_ERROR (500, fallback itself failed -
      the one case with no lower path left to fall back to)
    ShadowComparisonError -> never thrown to a caller; shadow mode is
      fully isolated (see canonicalShadowComparisonService.ts) - included
      here only as a typed value for the internal comparison log, not a
      thrown DomainError.
*/
export class CanonicalProfileUnavailableError extends NotFoundError {
  constructor(reason = "no canonical profile exists for this user") {
    super(`Canonical profile (${reason})`);
  }
}

export class CanonicalVersionUnavailableError extends NotFoundError {
  constructor(reason = "no resume version exists for this profile") {
    super(`Canonical resume version (${reason})`);
  }
}

export class CanonicalDeserializationError extends PersistenceError {
  constructor(detail: string) {
    super(`canonical runtime deserialization failed: ${detail}`);
  }
}

export class CanonicalTailoringError extends ValidationError {
  constructor(issues: string[]) {
    super(issues.length > 0 ? issues : ["AI tailoring output failed schema validation."]);
  }
}

export class CanonicalOverlayValidationError extends ValidationError {
  constructor(rejections: string[]) {
    super(rejections.length > 0 ? rejections : ["Overlay validation failed."]);
  }
}

export class TemplateResolutionError extends DomainError {
  readonly code: "NOT_FOUND" | "MALFORMED_REQUEST";
  constructor(reason: "unknown-template-id" | "unsupported-option", message: string) {
    super(message);
    this.code = reason === "unknown-template-id" ? "NOT_FOUND" : "MALFORMED_REQUEST";
  }
}

export class TemplateRenderingError extends PersistenceError {
  constructor(detail: string) {
    super(`template rendering failed: ${detail}`);
  }
}

export class GeneratedDocumentError extends PersistenceError {
  constructor(detail: string) {
    super(`generated document storage failed: ${detail}`);
  }
}

export class LegacyFallbackError extends PersistenceError {
  constructor(detail: string) {
    super(`legacy fallback itself failed: ${detail}`);
  }
}

/* Not a DomainError subclass - shadow comparison never surfaces to an
   HTTP caller (see canonicalShadowComparisonService.ts's own isolation
   guarantee); this type exists only for the internal comparison log
   record's own `resultCategory` field. */
export type ShadowComparisonErrorCategory = "canonical-generation-failed" | "canonical-render-failed" | "canonical-timeout" | "unexpected";
