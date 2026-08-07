# Canonical Career Memory — Rollback Runbook

Status: Phase 6H. Rollback demonstrated this phase via `fixtures/scripts/phase6hRollbackDemo.realdb.test.mts` — 9/9 assertions pass against real local Supabase.

## 1. What rollback means here

Rolling back canonical, at any rollout stage, is **a feature-flag flip only**:

```
CANONICAL_GENERATE_ENABLED=false   (or unset)
```

No database migration is reverted, no data is deleted, no code is redeployed. This is true whether rollback happens from Stage 1 (internal developers) all the way through Stage 6 (100% traffic) — the flag is the single kill switch for the entire canonical *creation* path at every stage.

## 2. What is preserved across a rollback (proven, not assumed)

The demonstration script seeds a full "already generated" canonical state (profile, resume version, AI overlay/tailored-resume, PDF/DOCX document ids — via the same two RPCs `generateCanonicalPackage()` itself calls, `system_create_canonical_overlay` + `complete_canonical_generation`), then flips `CANONICAL_GENERATE_ENABLED` off and re-verifies:

| Assertion | Result |
|---|---|
| With flag ON: `/status` reachable, reflects the seeded generation | PASS |
| With flag OFF: `/generate` returns 404 (new canonical generations blocked) | PASS |
| With flag OFF: `/status` still returns 200 for the already-generated application (no data hidden) | PASS |
| With flag OFF: `generation_engine` on that application is still `"canonical"` (unchanged) | PASS |
| With flag OFF: `generated_pdf_document_id`/`generated_docx_document_id` still present (documents preserved) | PASS |
| Direct DB read (owner-scoped, RLS): `career_profiles` row survives | PASS |
| Direct DB read: `career_resume_versions` row survives | PASS |
| Direct DB read: `career_tailored_resumes` (overlay) row survives | PASS |

9/9 passed. This directly satisfies the phase's own requirement: rollback requires only a flag change, requires no database rollback, and preserves user data, generated documents, overlays, and canonical profiles.

## 3. What rollback does NOT preserve / is out of scope

- **In-flight requests at the moment of rollback**: a request already inside `generateCanonicalPackage()` when the flag flips will complete or fail on its own terms — flipping a flag does not cancel an in-flight synchronous call. This is a direct consequence of the synchronous execution model (Architecture doc §5), not something rollback itself needs to fix.
- **Already-served responses**: if a user already downloaded a canonical-rendered PDF before rollback, that file is unaffected (client-side artifact, not tied to the flag).

## 4. Rollback procedure (per stage)

1. Identify the trigger (Incident Response Runbook / Rollout Plan doc's per-stage rollback triggers).
2. Set `CANONICAL_GENERATE_ENABLED` to unset or `"false"` in the Production environment (Netlify env var change — no deploy required, takes effect on next function cold start / immediately for already-warm instances reading `process.env` at call time, per this flag system's own "never cached" design, see `featureFlags.ts`).
3. Optionally also unset `CANONICAL_DOCUMENT_STORAGE_ENABLED`/`CANONICAL_TEMPLATE_SELECTOR_ENABLED`/`CANONICAL_SHADOW_MODE` if the incident warrants a full stand-down rather than just blocking new generations — these are independent flags and can be rolled back individually.
4. Verify: confirm `/api/internal/canonical-generate-package/generate` now returns 404 for a real request (or, in Netlify Production specifically, is already 404'd by the `isNetlifyRuntime()` gate in `withCanonicalAuth` regardless of the generate flag's value — see Architecture doc §2).
5. Confirm existing users' previously-generated canonical documents/status remain readable (the `/status` route has no flag gate of its own — this is intentional, not a bug, so support/on-call can still answer "what happened to my generation" during an incident).
6. Record the rollback in the incident log (Incident Response Runbook §4).

## 5. Re-enabling after rollback

Before flipping the flag back on:
1. Confirm the root cause is understood and fixed (or was a transient external issue, e.g. OpenAI outage, now resolved).
2. Re-run `fixtures/scripts/phase6hRollbackDemo.realdb.test.mts` and the full canonical real-DB regression suite (`docs/canonical-production-checklist.md`) locally.
3. Re-enable at the SAME rollout stage that was active before the rollback, not a higher one — do not use re-enabling as an opportunity to skip ahead in the Rollout Plan.
