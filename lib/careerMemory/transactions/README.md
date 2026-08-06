# Canonical Career Memory - Transaction Status

## Phase 6D.1 (current) - real transaction, real idempotency

The `TRANSACTION_SCHEMA_GAP` disclosed in Phase 6D is closed. The four write
workflows named in the Phase 6D.1 spec, plus generated-document creation,
now each run as a single call to a SQL function (RPC) defined in
`supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql`:

| Workflow | RPC | Tables touched in one call |
|---|---|---|
| `saveCanonicalRuntime` | `save_canonical_runtime()` | `career_resume_versions` + `career_experiences`/`career_projects`/`career_credentials`/`career_awards`/`career_publications` (full replace) |
| `restoreVersion` | `restore_canonical_version()` | `career_resume_versions` only |
| `createOverlay` | `create_canonical_overlay()` | `career_tailored_resumes` only |
| `registerSourceDocument` | `register_canonical_source_document()` | `career_source_documents` only |
| `createGeneratedDocument` | `create_canonical_generated_document()` | `generated_resume_documents` only |

A PL/pgSQL function body invoked as a single statement (how PostgREST/
supabase-js's `.rpc()` calls it) runs inside one implicit transaction: any
unhandled exception raised partway through rolls back every write that
function invocation had already made. This is real Postgres atomicity, not
simulated in application code - verified against a live local database in
`fixtures/scripts/rpcTransactionIdempotency.realdb.test.mjs` (rollback,
optimistic-conflict, concurrent-request, and idempotency-replay scenarios
all pass against a real Postgres instance, not a fake client).

Repository code (`lib/careerMemory/repositories/CanonicalTransactionRepository.ts`)
is the only place any of these 5 RPCs are called from - service code never
performs an individual `.insert()`/`.update()` for the rows these RPCs own.

## Idempotency

`career_idempotency_keys` (new table, same migration) stores one row per
`(user_id, request_key, operation)`. Every RPC above accepts an optional
`p_idempotency_key`; when a caller resends the SAME key for the SAME
operation, the RPC returns the ORIGINAL response verbatim without touching
the database again - a retried request never creates a duplicate version,
overlay, source document, or generated document. Keys expire after 24
hours (`expires_at`); an expired key is treated as absent, so a
sufficiently-delayed retry performs a fresh write rather than replaying
stale data.

Every internal API route backed by one of these 5 RPCs requires an
`Idempotency-Key` request header - a request without one gets `400` before
touching the database (see `lib/careerMemory/api/routeGuard.ts`'s
`requireIdempotencyKey()`).

One design point worth stating plainly: a caller that reuses the same
idempotency key for a genuinely different request body gets the ORIGINAL
response back, not an error. This matches standard idempotency-key
semantics (the key is the caller's own promise that "same key = same
intended result") - this layer does not hash-compare the request body
against what the key was first used for.

**Concurrency**: the idempotency check ("has this key been used before?")
and the eventual insert into `career_idempotency_keys` are two separate
statements, so without a lock, concurrent callers sharing the same key
could all observe "not found" and each perform a real write. Each RPC
takes a `pg_advisory_xact_lock` keyed by `(user_id, idempotency_key,
operation)` before its idempotency check, serializing same-key concurrent
callers so only the first actually writes and every later one replays
that result. A 10-concurrent-request stress test with one shared key
(`fixtures/scripts/rpcTransactionIdempotency.realdb.test.mjs`) asserts
exactly one surviving row against the live database.

## History

- **Phase 6D** (superseded): introduced `runWithCompensatingRollback()`
  (Option A - sequential writes + best-effort reverse-order compensation
  on failure) because no migration changes were permitted that round. That
  file (`compensatingRollback.ts`) has been deleted; its one still-useful
  helper (`toPersistenceError`) now lives in
  `lib/careerMemory/errors/persistenceHelpers.ts`.
  `saveCanonicalRuntimeAcknowledgingGap()`'s method name is kept as-is to
  avoid an unrelated rename, even though the gap it once referred to no
  longer exists. The old `x-canonical-write-ack` header/503 gate on
  `POST /api/internal/canonical-career-memory/versions` is removed -
  replaced by the `Idempotency-Key` requirement described above.
