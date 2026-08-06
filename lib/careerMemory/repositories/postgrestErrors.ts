/*
  Phase 6D - PostgREST -> domain error translation. The ONLY place a raw
  Supabase/PostgREST error object is inspected. Every concrete
  repository in this directory calls mapPostgrestError() instead of
  re-throwing the driver error directly, so `.message`/`.details`/`.hint`
  (which can contain table/column names, constraint names, or fragments
  of SQL) never reach an API response body or a log line at INFO level
  or above - see this file's own README note on §26/§27's "no raw
  DB error exposure" / "no PII in logs" requirements.
*/
import { ConflictError, PersistenceError } from "../errors/domainErrors";

export type PostgrestErrorLike = {
  message?: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

/*
  code 23505 = unique_violation (Postgres). The two real UNIQUE
  constraints in the Phase 6B schema (career_profiles.user_id,
  career_source_documents' (profile_id, content_hash) partial index)
  both surface this code - repositories that rely on those constraints
  for idempotency (see services/canonicalSourceDocumentService.ts)
  catch ConflictError specifically to turn "insert failed" into
  "return the existing row instead".
*/
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

export function mapPostgrestError(error: PostgrestErrorLike, context: string): ConflictError | PersistenceError {
  if (error.code === UNIQUE_VIOLATION) {
    return new ConflictError(`${context}: a row with these unique values already exists.`);
  }
  if (error.code === FOREIGN_KEY_VIOLATION) {
    return new PersistenceError(`${context}: referenced row does not exist.`);
  }
  if (error.code === CHECK_VIOLATION) {
    return new PersistenceError(`${context}: value violates a database constraint.`);
  }
  return new PersistenceError(`${context}: operation failed.`);
}

export function isUniqueViolation(error: PostgrestErrorLike | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
