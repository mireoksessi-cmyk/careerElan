# Career Memory Persistence Layer (Phase 6B)

Schema-and-contract layer for the Canonical Career Memory architecture designed in Phase 6A/6A.1/6A.2. **Nothing in this directory is wired into production.** No file here is imported by `app/**`, and no file here imports the Runtime Layer (`lib/careerMemory/runtime/**`) or a Supabase client.

## What exists

- `../../../supabase/migrations/20260806010000_career_memory_persistence_layer.sql` - 12 new tables, RLS enabled + 4 policies each, additive only (does not alter `career_memory`, `resumes`, or `applications`).
- `types.ts` - Row/InsertInput/UpdateInput TypeScript types, one set per table, matching the migration's columns exactly.
- `constants.ts` - table name constants + documented (not-yet-created) Storage bucket/path layout.
- `repositories.ts` - one `interface` per table (contract only, no implementation, no Supabase import).
- `mappers.ts` - DB Row <-> Runtime contract function signatures, every body a `throw new MapperNotImplementedError(...)` stub (no Runtime Layer import, no serializer call).
- `queries.ts` - shared query-ordering constants for a future repository implementation to reuse.

## What does NOT exist yet (intentionally, out of this round's scope)

- Any concrete class implementing a `repositories.ts` interface (would need a Supabase client - next round).
- Any real mapper body (would need to import `lib/careerMemory/runtime/**` - next round, tracked as the TODO at the bottom of `mappers.ts`).
- Any Storage bucket (`resume-sources`/`generated-resumes` per `constants.ts`'s documented layout are names only, never created).
- Any API route, server action, or UI change.
- Any application-code caller of anything in this directory.

## Storage layout (documented only, not created)

```
resume-sources/{profile_id}/{source_document_id}/original.{pdf|docx}
generated-resumes/{profile_id}/{tailored_resume_id}/resume.{pdf|docx}
```

Mirrors the existing `resumes`/`cover-letters` buckets' own `{owner_id}/...` path-ownership convention (see the Phase 6A audit's `storage_rls_owner_check.sql` finding) so a future bucket-creation round can reuse the identical RLS policy shape.

## Next rounds (not this one)

- Phase 6C: implement the real mapper bodies (imports `lib/careerMemory/runtime/**` for the first time).
- Phase 6D: implement concrete repository classes (imports a Supabase client for the first time) + wire a real API layer.
- A separate round: create the two Storage buckets above with ownership-scoped RLS policies.
