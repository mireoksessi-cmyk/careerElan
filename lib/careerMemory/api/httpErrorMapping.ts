/*
  Phase 6D - domain error -> HTTP response mapping. The ONLY place an
  API route decides a status code from a caught error. Every response
  body here is a small, structured `{ error: { code, message } }` -
  never `error.stack`, never a raw PostgREST payload, never the
  original JS Error object serialized directly (see domainErrors.ts's
  own header comment on why PersistenceError's message is already
  pre-sanitized before it gets here).
*/
import { NextResponse } from "next/server";
import { isDomainError } from "../errors/domainErrors";
import type { DomainErrorCode } from "../errors/domainErrors";

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  PERSISTENCE_ERROR: 500,
  TRANSACTION_UNAVAILABLE: 503,
  SCHEMA_GAP: 501,
  /* Phase 6G additions - Canonical Generate Package. */
  MALFORMED_REQUEST: 400,
  QUOTA_EXCEEDED: 429,
  /* Phase 6I.2 additions - Canonical Template Lifecycle. */
  TEMPLATE_SELECTION_REQUIRED: 409,
  INVALID_TEMPLATE_ID: 422,
  CANONICAL_PROFILE_UNAVAILABLE: 404,
  TEMPLATE_PREFERENCE_PERSIST_FAILED: 500,
  TEMPLATE_PREVIEW_FAILED: 500,
};

export function errorResponse(error: unknown): NextResponse {
  if (isDomainError(error)) {
    const status = STATUS_BY_CODE[error.code];
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: { code: "PERSISTENCE_ERROR", message: "An unexpected error occurred." } }, { status: 500, headers: { "cache-control": "no-store" } });
}

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
