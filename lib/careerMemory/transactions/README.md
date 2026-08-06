# Transactions (Phase 6D)

## TRANSACTION_SCHEMA_GAP (disclosed, not fixed this round)

The canonical save workflow (`CanonicalCareerMemoryService.saveCanonicalRuntime()`)
writes to `career_resume_versions` (1 row) plus up to 6 child tables
(`career_experiences`/`career_languages`/`career_projects`/`career_credentials`/
`career_awards`/`career_publications`). Supabase/PostgREST has no
client-callable multi-table transaction primitive without a database
function (RPC) - and this round's own instructions forbid any migration
change, so no RPC can be added.

**Options compared** (Phase 6D design report §13):

- **Option A - sequential writes + compensating rollback (chosen).**
  Implemented in `compensatingRollback.ts`. Not atomic: a crash between
  two awaited steps leaves partial state; the rollback path is
  best-effort and its own failures are reported, never hidden.
- **Option B - a new SQL RPC transaction.** Would solve this properly,
  but requires a migration - explicitly out of scope this round.
- **Option C - a single JSON-payload upsert.** The current 6B schema
  (12 separate tables, not one wide table) doesn't support this shape.

**Consequence:** `saveCanonicalRuntime()` (the one operation that
writes 1+6 tables) is kept **internal/opt-in only** - it is exercised
by tests via `runWithCompensatingRollback()` directly, and the
`POST /api/internal/canonical-career-memory/versions` route requires an
explicit `x-canonical-write-ack: transaction-gap-acknowledged` header to
even attempt it, returning `503 TRANSACTION_UNAVAILABLE` otherwise. This
is the round's own "부분 쓰기 위험을 숨기지 않는다" instruction applied
literally: the write path exists and is tested, but is never claimed to
be safe for unattended production traffic.

Every OTHER canonical write this round (profile create, source document
register, overlay create, user edit append, generated-document metadata
insert) is a **single-table insert** and has no atomicity gap at all.

## Resolution path (not this round)

A future round, with migration changes approved, would add a
`create_canonical_resume_version(...)` Postgres function wrapping the
version insert + child-table replace in one `plpgsql` transaction, and
`saveCanonicalRuntime()` would call `.rpc(...)` instead of
`runWithCompensatingRollback()`.
