/*
  Phase 6D.1 - a small standalone helper kept after the removal of
  transactions/compensatingRollback.ts (Option A, replaced by the
  real-transaction RPCs in supabase/migrations/
  20260806020000_career_memory_transaction_idempotency.sql). Wraps a
  caught error in a safe, generic PersistenceError unless it already is
  one - never re-exposes the original error's own message.
*/
import { PersistenceError } from "./domainErrors";

export function toPersistenceError(operationName: string, error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  return new PersistenceError(`${operationName} failed.`);
}
