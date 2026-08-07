# Canonical Career Memory — Remaining Known Issues

Status: Phase 6I. 5 of the 6 issues Phase 6H's Production Readiness Audit flagged are now closed. This document tracks what remains, plus new operational gaps discovered while building this phase's own routing/fallback/quota/background-execution work.

## Closed this phase

| # | Phase 6H issue | Resolution |
|---|---|---|
| 1 | No traffic-routing mechanism into canonical | `canonicalTrafficRouter.ts` + `canonicalGenerateDispatchService.ts`, wired into the existing `/api/generate-package` endpoint — no new UI needed (Traffic Routing doc) |
| 2 | No quota mechanism for canonical generation | Canonical now reserves against the SAME ledger legacy uses, same RPCs, same idempotency (Production Architecture doc §7) |
| 3 | Synchronous execution model, no background-job path | `canonicalGenerationWorker.ts` + `netlify/functions/canonical-generate-package-background.ts`, mirroring legacy's own enqueue/claim/complete pattern (Production Architecture doc §5) |
| 4 | Fallback-decision wrapper not wired into the production route | `runCanonicalWithFallbackDecision()` is now called by `canonicalGenerationWorker.ts` on every canonical attempt; a fallback-eligible failure genuinely hands off to legacy's own unmodified generation logic (Production Architecture doc §6) |
| 5 | No quota-accuracy monitoring possible | Direct consequence of #2 being closed — no longer a separate gap |

A real bug was also found and fixed while closing #4: `classifyForFallback()` let a bare `NotFoundError` (an ownership/not-found condition on the request's own target) fall through to the generic fallback-eligible default, meaning an ownership problem would have incorrectly been absorbed into a fallback instead of hard-failing. Fixed and regression-guarded (`canonicalOrchestration.test.ts`).

## Still open

### 6. Dev-only inspector pages (`/canonical-career/*`) — Production reachability still not independently re-verified

Carried forward unchanged from Phase 6H — not in scope for this phase's routing/fallback/quota/background-execution work. Before treating these pages as safely dev-only in Production, confirm independently whether Next.js routing/middleware excludes them from the real deployed build.

## New, discovered this phase (Operations Runbook §8)

### 7. No automatic stale-claimed-row reclaim for canonical

Legacy's own `route.ts` has reclaim logic for a `pending`-but-never-claimed or stuck-claimed row (`WORKER_STALE_THRESHOLD_MS`/`GIVE_UP_THRESHOLD_MS`). Canonical's dispatch service reclaims a `failed`-or-stale-unclaimed row on retry (verified this phase, `phase6iProductionEnablement.realdb.test.mts` §G), but a row that IS claimed and then the worker crashes mid-generation has no automatic timeout — it stays claimed until a human manually reconciles it (Operations Runbook §7). Not built this phase because canonical's real-world worker-invocation latency/failure profile hasn't been observed in Production yet to size a correct threshold; sizing one blind risks either reclaiming genuinely-still-running work or leaving users stuck too long.

### 8. No per-user routing override

There is no support-facing tool to force a specific user to legacy or canonical outside of the canary allowlist/percentage mechanism. A canary-stage or full rollback affects all users near a bucket boundary, not one individual. Not built this phase — flagged as a possible future need if a specific user reports a canonical-specific issue that can't wait for a stage change.

## Priority for a future phase

#6 (inspector page reachability) should be closed before Stage 1 formally begins, since Stage 1 already assumes it. #7 (stale-claim reclaim) should be revisited once real Stage 1–2 worker-latency data exists to size a threshold correctly — building it blind this phase would have been guessing. #8 (per-user override) is genuinely optional — build only if a real support need materializes.
