# Canonical Career Memory — Production Checklist

Status: Phase 6H. Snapshot of production-readiness verification performed this phase, plus the standing regression suite to re-run before any future flag change.

## 1. Feature flags

- [x] `CANONICAL_GENERATE_ENABLED`, `CANONICAL_SHADOW_MODE`, `CANONICAL_TEMPLATE_SELECTOR_ENABLED`, `CANONICAL_LEGACY_FALLBACK_ENABLED`, `CANONICAL_DOCUMENT_STORAGE_ENABLED` — confirmed unset in `.env.local` (all fail-closed OFF).
- [x] All 5 flags read `process.env` at call time, never cached (`featureFlags.ts`).

## 2. RLS / data access

- [x] Every `career_*` data table has RLS enabled with 4 ownership-scoped policies (audited directly via `pg_class`/`pg_policy` this phase — see Production Architecture doc §4).
- [x] `career_idempotency_keys` RLS enabled, 2 policies.
- [x] `applications` RLS enabled, 4 policies; `service_role` confirmed to have no direct SELECT/INSERT/UPDATE/DELETE grant (RPC-only access, by design).
- [x] Cross-user RLS/ownership enforcement re-verified via the existing canary test's ownership assertions (Phase 6G.1) and the RPC idempotency suite's explicit ownership tests (48/48 passing, includes 3 dedicated "someone else's profile → not_found" assertions).

## 3. Monitoring (added this phase)

- [x] `canonicalProductionMetrics.ts` created; PII-safe (only safe identifiers/enums/numbers, closed 19-value error code enum, never `.message` or content).
- [x] Wired into all 3 internal routes (`generate`, `preview`, `status`) purely additively — no control-flow, status-code, or response-body change.
- [x] Verified real log lines emit correctly during route tests (confirmed structured JSON with correct fields against real requests).
- [x] `npx tsc --noEmit -p .` clean before and after the wiring.

## 4. Regression (re-run this phase, after monitoring wiring)

| Suite | Result |
|---|---|
| `phase6gCanonicalGeneratePackageRoutes.realdb.test.mts` | 93 passed, 0 failed |
| `phase6gSchemaStorageShadowPii.realdb.test.mts` | 80 passed, 0 failed |
| `canonicalOrchestration.test.ts` | 351 passed, 0 failed |
| `phase6gCanonicalGeneratePackage.realdb.test.mjs` | 130 passed, 0 failed |
| `phase6g1CanaryProfessionalAts.realdb.test.mts` | 12 passed, 0 failed |
| `rpcTransactionIdempotency.realdb.test.mjs` | 48 passed, 0 failed |
| `phase6hRollbackDemo.realdb.test.mts` (new this phase) | 9 passed, 0 failed |
| **Total** | **723 passed, 0 failed** |

All counts identical to the pre-monitoring-wiring baseline except the new rollback-demo suite, confirming zero behavioral regression from Phase 6H's code changes.

## 5. Build

- [x] `npx tsc --noEmit -p .` — exit 0, zero errors.
- [x] `npm run build` — exit 0, production build succeeds, all canonical routes present in the route manifest (`/api/internal/canonical-generate-package/{generate,preview,status,config}`, `/canonical-career/*` pages).

## 6. Migrations

- [x] No new migration in Phase 6H (monitoring/documentation only — no schema change).
- [x] `git status` confirms zero migration conflicts: no untracked or modified files under `supabase/migrations/`.

## 7. Quota

- [ ] **Not satisfied** — canonical has no quota-metering mechanism (see Known Issues). Not a Phase 6H regression (never existed), but flagged as a blocker for any real-user rollout stage (Rollout Plan, Stage 3+).

## 8. Data preservation / rollback

- [x] Rollback demonstrated as flag-only, zero data loss (`phase6hRollbackDemo.realdb.test.mts`, 9/9 passed — see Rollback Runbook).

## 9. What this checklist does NOT cover

- Real Netlify Production environment behavior (function timeout limits, cold-start latency) — untestable from this local-only verification; flagged as a risk in Known Issues, not resolved.
- Load/concurrency testing beyond the 10-concurrent-request stress assertions already in `rpcTransactionIdempotency.realdb.test.mjs`.
- The traffic-routing mechanism needed for Rollout Plan Stage 3+ — does not exist yet (out of scope, see Known Issues).
