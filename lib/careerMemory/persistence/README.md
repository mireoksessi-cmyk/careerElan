# Career Memory Persistence Layer (Phase 6B + Phase 6C)

Schema-and-contract layer for the Canonical Career Memory architecture designed in Phase 6A/6A.1/6A.2. **Nothing in this directory is wired into production.** No file here is imported by `app/**`, and no file here (as of Phase 6C) imports a Supabase client - `mappers.ts`/`validation.ts` DO now import the Runtime Layer (`lib/careerMemory/runtime/**`), which Phase 6C intentionally allows for the first time.

## Phase 6C: Runtime <-> Persistence mapping

`mappers.ts`'s Phase 6B stubs are fully implemented. `validation.ts`, `bundle.ts`, and `testFixtures.ts` are new.

**Snapshot strategy (Option A - `ResumeStructuredModel` only, no wrapper metadata):** `career_resume_versions.snapshot` stores the full `ResumeStructuredModel` verbatim, nothing else. This was chosen over Option B (full `CanonicalResumeRuntime`) and Option C (model + a runtime-metadata subset) because `RuntimeVersion`'s own fields (`id`/`reason`/`parentVersionId`/`createdAt`) and `RuntimeMetadata`'s own fields (`schemaVersion`/`serializerVersion`) already have dedicated columns on `career_resume_versions` itself - duplicating them inside the snapshot JSON would be redundant, not more lossless. `overlayState` is excluded (lives in `career_tailored_resumes`, one row per history record) and `sourceDocuments` is excluded (lives in `career_source_documents`, referenced by `source_document_id`) - neither needs to be nested in the snapshot to be recoverable.

**The snapshot is the round-trip source of truth, not the six normalized child tables.** `career_experiences`/`career_projects`/`career_credentials`/`career_awards`/`career_publications` can only carry a `string | null` for fields that are `StructuredTextValue` (value+confidence+extractionMethod+source) in Runtime - the per-field confidence/extractionMethod is not independently recoverable from a child-table row alone. `careerProfileToCanonicalRuntime()` therefore reconstructs `resume` from `latestVersion.snapshot`, never by re-assembling the child tables - this is what makes the round-trip provably lossless (`lib/careerMemory/persistence/roundTrip.test.ts`) despite that real, disclosed child-table limitation. The child tables remain a queryable/editable projection for a future Phase 6D UI, populated by `canonicalRuntimeToInsertBundle()`.

**Known, disclosed gaps** (none of which cause round-trip loss, since the snapshot always carries the full picture):
- `career_languages` has no Runtime-side counterpart at all - `ResumeStructuredModel` has no `languages` field. The table stays empty until a future round adds one to the Runtime contract (out of scope here - Runtime type changes require explicit approval).
- No `career_education` table exists - `education[]` is snapshot-only, same as `identity`/`professionalSummary`/`skillGroups`/`customSections`/`metricGrids`/`slotAvailability`/`validation`.
- No child table has a dedicated column for the Runtime entry's own source-derived `id` (distinct from the DB row's own uuid `id`) - `packEntryEnvelope()`/`unpackEntryEnvelope()` in `mappers.ts` nest it (plus `isUncertain`/`reasonCodes`, which also lack dedicated columns on 4 of 5 entry tables) inside the existing `source_trace` jsonb column instead of requiring a migration change.
- `career_source_documents` has no explicit order column - `sourceDocuments[]` array order is DERIVED via `created_at` ascending (then `id` as a tiebreak), not literally stored.

## What exists

- `../../../supabase/migrations/20260806010000_career_memory_persistence_layer.sql` - 12 new tables, RLS enabled + 4 policies each, additive only (does not alter `career_memory`, `resumes`, or `applications`).
- `types.ts` - Row/InsertInput/UpdateInput TypeScript types, one set per table, matching the migration's columns exactly.
- `constants.ts` - table name constants + documented (not-yet-created) Storage bucket/path layout.
- `repositories.ts` - one `interface` per table (contract only, no implementation, no Supabase import - still true after Phase 6C).
- `mappers.ts` - real Row <-> Runtime mapping implementations (Phase 6C). No `MapperNotImplementedError` stubs remain.
- `bundle.ts` - `CareerMemoryPersistenceBundle`, the aggregate "every table's rows for one profile" type `careerProfileToCanonicalRuntime()` consumes.
- `validation.ts` - `validatePersistenceBundle`/`validateRuntimeRoundTrip`/`validateCanonicalCoverage`/`validateOverlayPersistence`, all deterministic (no AI/semantic comparison).
- `testFixtures.ts` - hand-authored `ResumeStructuredModel`/`CanonicalResumeRuntime` fixtures shared by the Phase 6C test files.
- `queries.ts` - shared query-ordering constants for a future repository implementation to reuse.

## What does NOT exist yet (intentionally, out of this round's scope)

- Any concrete class implementing a `repositories.ts` interface (would need a Supabase client - Phase 6D).
- Any real Supabase query anywhere in this directory (still true after Phase 6C - every test builds its bundle by hand in memory).
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

- Phase 6D: implement concrete repository classes (imports a Supabase client for the first time) + wire a real API layer.
- A separate round: create the two Storage buckets above with ownership-scoped RLS policies.
- A separate round (needs explicit approval, changes the Runtime contract): add a `languages` field to `ResumeStructuredModel` so `career_languages` has a real source.
