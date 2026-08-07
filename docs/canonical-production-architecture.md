# Canonical Career Memory — Production Architecture

Status: Phase 6I (Production Enablement). Supersedes the Phase 6H version of this document — §5 (execution model), §6 (quota), and §1 (system boundary) described a synchronous, unmetered, unrouted system that this phase closed. Sections 2–4 and 7 carry forward from Phase 6H largely unchanged, amended where noted.

## 1. System boundary

The Canonical Career Memory system now shares a **single production entry point** with legacy: `POST /api/generate-package`. A server-side routing dispatcher (Traffic Routing doc) decides, per request, which engine actually serves it — legacy by default, canonical only when the canary stage and the requesting user's bucket say so. The dev-only `/canonical-career/*` inspector pages and the internal `/api/internal/canonical-generate-package/{generate,preview,status}` routes still exist for manual/dev testing and are unaffected by this phase.

```
                        ┌─────────────────────────────┐
                        │        Client (browser)      │
                        └──────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  POST /api/generate-package     │
                        │  (the ONE production endpoint)  │
                        └───────────────┬─────────────────┘
                                        │
                          decideGenerationRoute(userId)
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼ "legacy" (default)                     ▼ "canonical" (canary-gated)
        ┌─────────────────────────┐          ┌──────────────────────────────────────┐
        │ legacy quota + claim-    │          │ dispatchCanonicalGeneration()          │
        │  insert + Netlify        │          │  (own quota reserve, own claim-insert, │
        │  background function     │          │   own enqueue - canonicalGenerate      │
        │  (unmodified since 6H)   │          │   DispatchService.ts)                  │
        └─────────────────────────┘          └───────────────────┬─────────────────────┘
                                                                    ▼
                                                    netlify/functions/canonical-generate-
                                                    package-background.ts (Production) /
                                                    canonical-generate-package-worker
                                                    (local dev) → runCanonicalGeneration()
                                                                    │
                                              ┌─────────────────────┼─────────────────────┐
                                              ▼                     ▼                     ▼
                                  claim_canonical_generate_  generateCanonicalPackage()  fallback-eligible
                                  worker (atomic claim)      wrapped in                  failure →
                                                              runCanonicalWithFallback     mark_canonical_fallback
                                                              Decision()                   → release_canonical_
                                                                                            claim_for_legacy_
                                                                                            fallback →
                                                                                            runPackageGeneration()
                                                                                            (legacy, UNMODIFIED)
```

Both engines' background workers write to the SAME `applications` row and the SAME generic lifecycle columns (`generation_status`/`generation_stage`/`generation_worker_claimed_at`), so `GET /api/applications/[id]/status` and Job Tracker work identically regardless of which engine actually produced the result — that route now branches only on `generation_engine` to pick the right response *shape* (canonical returns document metadata; legacy returns resume/cover-letter/email-draft text), never on which route the client originally called.

## 2. Feature flags (`lib/careerMemory/orchestration/featureFlags.ts`)

Unchanged from Phase 6H — all fail closed, read at call time. Two new, related env vars this phase (not feature flags in the same sense — canary configuration, see `canonicalCanaryConfig.ts`):

| Flag / var | Gates | Current default |
|---|---|---|
| `CANONICAL_GENERATE_ENABLED` | Master switch for the routing dispatcher; also still gates `/generate`, `/preview` internal routes directly | OFF |
| `CANONICAL_SHADOW_MODE` | Shadow-compare canonical vs legacy output without serving canonical | OFF |
| `CANONICAL_TEMPLATE_SELECTOR_ENABLED` | Exposes template switching UI/API | OFF |
| `CANONICAL_LEGACY_FALLBACK_ENABLED` | Whether a classified-fallback-eligible canonical error falls back to legacy | OFF — **now actually wired into the production route this phase** (Phase 6H's Known Issues #4 is closed) |
| `CANONICAL_DOCUMENT_STORAGE_ENABLED` | Whether rendered PDF/DOCX are uploaded to Storage and recorded | OFF |
| `CANONICAL_CANARY_STAGE` | Which of Stage 0–6 is active (Canary Plan doc) | unset → Stage 0 |
| `CANONICAL_CANARY_ALLOWLIST_USER_IDS` | Comma-separated user ids eligible at Stage 1–2 | unset → empty |

## 3. Data model

Unchanged from Phase 6H. `applications` already carried `generation_engine`, `fallback_used`, `fallback_reason` with CHECK constraints exactly matching this phase's needs (`generation_engine IN ('legacy','canonical')`, `fallback_reason` matching `FallbackReason`'s own enum) — these were added in Phase 6G but never actually driven by production code until this phase. One column newly put to use (already existed, unused before): `canonical_input_manifest jsonb` — now holds the generation parameters (`templateId`, `paperSize`, `density`, `locale`, `jobDescriptionText`, `jobAnalysisSummary`, `targetRole`, plus the routing `reason`/`stage` for audit) written at claim-insert time and read back by the worker after its atomic claim.

## 4. RLS coverage

Unchanged from Phase 6H (no new tables this phase; only new RPCs — see §5). Audit re-confirmed no regression during this phase's own real-DB test run (cross-user ownership assertions in `phase6iProductionEnablement.realdb.test.mts`, section E/G).

## 5. Background execution — closed this phase (was Phase 6H Known Issues #3)

Canonical generation is no longer synchronous-in-request. `dispatchCanonicalGeneration()` claim-inserts an `applications` row (`generation_engine='canonical'`, `generation_status='pending'`) and enqueues a background worker exactly the way legacy already does, reusing the SAME generic runtime-detection helper (`resolveNamedBackgroundFunctionUrl`, already generalized in an earlier phase specifically for this kind of extension) rather than inventing a new one.

Four new RPCs (migration `20260808000000_canonical_background_execution_and_fallback.sql`) give the canonical worker the same atomic-claim/complete lifecycle legacy already has, since `service_role` has no direct grant on `applications`:

- `claim_canonical_generate_worker(p_application_id)` — atomic `UPDATE...WHERE generation_status='pending' AND generation_worker_claimed_at IS NULL AND generation_engine='canonical'...RETURNING`, mirroring `claim_generate_package_worker`'s own pattern exactly.
- `complete_canonical_generate_worker(p_application_id, p_user_id, p_status, p_error_code?, p_error_summary?)` — sets the generic lifecycle columns + Job Tracker's `status='package_generated'` on success.
- `release_canonical_claim_for_legacy_fallback(p_application_id, p_user_id)` — the fallback handoff (§6).
- `get_application_generation_status(p_application_id, p_user_id)` — read-only, used only by the worker to observe a fallback attempt's real outcome for metrics.

Netlify Background Function: `netlify/functions/canonical-generate-package-background.ts` (Production trigger). Local-dev stand-in: `app/api/internal/canonical-generate-package-worker/route.ts` (fire-and-forget, mirrors the legacy stand-in's own reasoning for why `next dev` can't reproduce a real Background Function's execution guarantee).

The platform-timeout risk Phase 6H flagged (canonical bounded by Netlify's function timeout) is now the SAME risk legacy already carries and already operates under — canonical generation runs inside the Background Function's up-to-15-minute execution window, not the client-facing request, exactly like legacy.

## 6. Automatic legacy fallback — closed this phase (was Phase 6H Known Issues #4)

`runCanonicalWithFallbackDecision()` (built in Phase 6G, unused by any real caller until now) is wired into `canonicalGenerationWorker.ts`. On a fallback-eligible failure (parser/runtime-reconstruction/overlay-validation/renderer/storage/template-rendering — `classifyForFallback()`'s own categorization, Phase 6G, one bug fixed this phase — see §8), the worker:

1. Calls `mark_canonical_fallback()` (existed since Phase 6G, unused until now) — records `fallback_used=true`, `fallback_reason`, `generation_engine='legacy'` immediately.
2. Calls `release_canonical_claim_for_legacy_fallback()` — releases the worker claim. The legacy input snapshot (`resume_source`, `resume_id`, `generation_input_*`) is **already on the row**, written unconditionally by `dispatchCanonicalGeneration()` at claim-insert time (before it's known whether canonical will even be attempted) — so this step never needs a user session to prepare one.
3. Calls `runPackageGeneration()` — legacy's own, completely unmodified worker entrypoint. It claims the now-unblocked row via its own `claim_generate_package_worker` and completes it exactly as if the request had been legacy from the start.

Never falls back for: authentication, authorization, quota, malformed request, or **ownership/ambiguous-not-found** (a bug fixed this phase — `classifyForFallback` previously let a bare `NotFoundError` fall through to the generic fallback-eligible default; it now hard-fails, matching the phase's own explicit "never fallback for ownership" requirement).

Verified end-to-end at the SQL/orchestration level (not via a real OpenAI call, to avoid cost) in `phase6iProductionEnablement.realdb.test.mts` §F: seed a canonical-claimed row → mark fallback → release claim → confirm legacy's own real `claim_generate_package_worker` RPC can claim the identical row, with the pre-written snapshot intact.

## 7. Quota — closed this phase (was Phase 6H Known Issues #2)

Canonical generation now reserves against the **same** ledger legacy uses — `generate_package_quota_reservations`/`generate_package_quota_periods`, via the identical `reserve_generate_package_usage`/`complete_generate_package_usage`/`release_generate_package_usage` RPCs, keyed by the same `(user_id, generation_request_id)` idempotency contract. This was a deliberate design choice, not a default: a user's monthly plan limit now grants one shared budget across both engines, not double the effective quota. Shadow mode (`CANONICAL_SHADOW_MODE`, a separate, pre-existing code path) never calls the dispatcher and therefore consumes zero quota by construction, not by a special case.

## 8. Monitoring (extended this phase)

Two new event types added to `canonicalProductionMetrics.ts`: `canonical_routing_decision` (route/reason/stage, logged at every dispatch point — canary traffic-split observability) and `canonical_fallback` (applicationId/reason/outcome, logged after a fallback attempt resolves). See Monitoring Dashboard doc for the full event catalogue.

## 9. What this phase deliberately did not change

Career Memory, Canonical Runtime, overlay, and template semantics are all untouched. No new client-visible UI. Parser semantics unmodified. The routing/fallback/quota/background-execution work above is additive orchestration around existing, already-verified generation logic (Phase 6F templates, Phase 6G overlay/tailoring, Phase 6G.1 content-preservation fix) — none of which was touched this phase.
