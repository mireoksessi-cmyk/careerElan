/*
  Phase 6E - client-side error model for the Canonical Career Memory
  UI. Every internal API route in app/api/internal/canonical-career-memory/**
  returns `{ error: { code: DomainErrorCode, message } }` on failure
  (lib/careerMemory/api/httpErrorMapping.ts) - CanonicalApiError is the
  ONE place that response shape is parsed on the client, and
  classifyApiError() is the ONE place an error code is mapped to a UI
  state kind (spec section 14: Loading/Retry/Unauthorized/Version
  Conflict/Merge Conflict/Restore Failed/RPC Error/Idempotency Replay).
*/

export type CanonicalApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PERSISTENCE_ERROR"
  | "TRANSACTION_UNAVAILABLE"
  | "SCHEMA_GAP"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class CanonicalApiError extends Error {
  readonly code: CanonicalApiErrorCode;
  readonly status: number;

  constructor(code: CanonicalApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "CanonicalApiError";
    this.code = code;
    this.status = status;
  }
}

/*
  UI error "kind" - what banner/panel a page should render. Distinct
  from CanonicalApiErrorCode: several different backend codes can map
  to the same UI treatment (e.g. both AUTHENTICATION_REQUIRED and
  AUTHORIZATION_DENIED render as "unauthorized"), and one backend code
  (CONFLICT) maps to a DIFFERENT UI kind depending on which action
  produced it (a 409 from POST /versions is a version conflict; there
  is no other route that can return CONFLICT today, so "merge_conflict"
  and "idempotency_replay" are surfaced by the calling code itself, not
  derived from the HTTP response - see the callSite param below).
*/
export type UiErrorKind =
  | "retry"
  | "unauthorized"
  | "not_found"
  | "validation"
  | "version_conflict"
  | "restore_failed"
  | "rpc_error";

export type CanonicalApiCallSite = "save_version" | "restore_version" | "create_overlay" | "delete_overlay" | "register_source_document" | "generic";

export function classifyApiError(error: CanonicalApiError, callSite: CanonicalApiCallSite = "generic"): UiErrorKind {
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
    case "AUTHORIZATION_DENIED":
      return "unauthorized";
    case "NOT_FOUND":
      return "not_found";
    case "VALIDATION_FAILED":
      return "validation";
    case "CONFLICT":
      if (callSite === "save_version") return "version_conflict";
      if (callSite === "restore_version") return "restore_failed";
      return "retry";
    case "TRANSACTION_UNAVAILABLE":
    case "SCHEMA_GAP":
      return "rpc_error";
    case "PERSISTENCE_ERROR":
      if (callSite === "restore_version") return "restore_failed";
      return "retry";
    case "NETWORK_ERROR":
    case "UNKNOWN":
    default:
      return "retry";
  }
}

const KNOWN_CODES: CanonicalApiErrorCode[] = [
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_DENIED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "PERSISTENCE_ERROR",
  "TRANSACTION_UNAVAILABLE",
  "SCHEMA_GAP",
];

function isKnownCode(value: unknown): value is CanonicalApiErrorCode {
  return typeof value === "string" && (KNOWN_CODES as string[]).includes(value);
}

/*
  Builds a CanonicalApiError from a fetch Response whose body has
  already been read as JSON (or failed to parse). Never throws itself -
  a malformed error body still produces a usable CanonicalApiError
  (code "UNKNOWN") rather than crashing the caller.
*/
export function apiErrorFromResponseBody(status: number, body: unknown): CanonicalApiError {
  if (body && typeof body === "object" && "error" in body) {
    const errorField = (body as { error?: unknown }).error;
    if (errorField && typeof errorField === "object") {
      const code = (errorField as { code?: unknown }).code;
      const message = (errorField as { message?: unknown }).message;
      return new CanonicalApiError(
        isKnownCode(code) ? code : "UNKNOWN",
        typeof message === "string" && message.length > 0 ? message : "An unexpected error occurred.",
        status
      );
    }
  }
  return new CanonicalApiError("UNKNOWN", "An unexpected error occurred.", status);
}

export function networkError(detail: string): CanonicalApiError {
  return new CanonicalApiError("NETWORK_ERROR", `Network error: ${detail}`, 0);
}
