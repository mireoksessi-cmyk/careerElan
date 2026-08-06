/*
  Phase 6D - TRANSACTION_SCHEMA_GAP, disclosed rather than hidden. The
  canonical save workflow writes to 1 career_resume_versions row + up
  to 6 child tables (career_experiences/languages/projects/credentials/
  awards/publications). Supabase/PostgREST has no client-callable
  multi-table transaction primitive without either (a) a database
  function/RPC, which this round's own instructions forbid creating
  (no migration changes), or (b) accepting that a crash between two
  sequential HTTP calls leaves partial state.

  This file implements Option A from the Phase 6D design report's own
  comparison: sequential writes + best-effort compensating rollback.
  It is NOT atomic - a process crash or network failure between two
  awaited steps still leaves partial state that the rollback path
  itself may also fail to clean up (that failure is reported, never
  swallowed). CanonicalCareerMemoryService.saveCanonicalRuntime() is
  the only caller, and its own JSDoc repeats this same disclosure so a
  reader of the service file doesn't have to find this one - see
  services/canonicalCareerMemoryService.ts.
*/
import { PersistenceError, TransactionUnavailableError } from "../errors/domainErrors";

export type RollbackStep = { description: string; run: () => Promise<void> };

export type CompensatingRollbackResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; rollback: { attempted: boolean; succeeded: boolean; failedSteps: string[] } };

/*
  Runs `steps` in order. Each step returns its own compensating
  "undo" action (or null if nothing to undo, e.g. a pure read). If any
  step throws, every already-completed step's compensator is run in
  REVERSE order (LIFO) - a best-effort attempt, not a guarantee; a
  compensator that itself throws is recorded in `failedSteps` and the
  remaining compensators still run (one failed cleanup should not skip
  cleaning up the rest).
*/
export async function runWithCompensatingRollback<T>(operationName: string, steps: Array<() => Promise<{ value: unknown; compensate: (() => Promise<void>) | null }>>, assemble: (values: unknown[]) => T): Promise<CompensatingRollbackResult<T>> {
  const completed: Array<() => Promise<void>> = [];
  const values: unknown[] = [];

  for (const step of steps) {
    try {
      const { value, compensate } = await step();
      values.push(value);
      if (compensate) completed.push(compensate);
    } catch (error) {
      const failedSteps: string[] = [];
      for (const compensate of [...completed].reverse()) {
        try {
          await compensate();
        } catch {
          failedSteps.push(String(completed.indexOf(compensate)));
        }
      }
      return { ok: false, error, rollback: { attempted: completed.length > 0, succeeded: failedSteps.length === 0, failedSteps } };
    }
  }

  return { ok: true, value: assemble(values) };
}

/*
  Throws TransactionUnavailableError unconditionally - the "internal/
  opt-in only" gate for the one operation (multi-table canonical save)
  the Phase 6D design report concluded cannot be declared
  production-ready this round. Callers that genuinely need to exercise
  the write path for local testing use
  runWithCompensatingRollback()/saveCanonicalRuntimeUnsafe() directly
  (see canonicalCareerMemoryService.ts) - this function exists so the
  DEFAULT, production-facing entry point fails loudly instead of
  silently accepting a request it cannot make atomic.
*/
export function assertTransactionAvailable(operation: string): never {
  throw new TransactionUnavailableError(operation);
}

export function toPersistenceError(operationName: string, error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  return new PersistenceError(`${operationName} failed during a non-atomic multi-step write.`);
}
