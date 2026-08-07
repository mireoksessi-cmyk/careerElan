# Canonical Career Memory — Traffic Routing

Status: Phase 6I (Production Enablement). Describes the routing dispatcher this phase added — the mechanism Phase 6H's own Known Issues #1 flagged as missing ("no code path routes any real user's click into canonical").

## 1. Where routing happens

There is still exactly **one** user-facing entry point: `app/api/generate-package/route.ts` (`POST`), the same endpoint `app/paste-job/page.tsx`'s "Generate Package" button has always called. Phase 6I adds a single dispatch point inside that route's `POST` handler, immediately after `generationRequestId` validation and before legacy's own quota reservation:

```ts
const routingDecision = decideGenerationRoute(user.id);
logCanonicalMetric({ event: "canonical_routing_decision", ... });
if (routingDecision.route === "canonical") {
  return await dispatchCanonicalGeneration({ ... });
}
// legacy code below, completely unmodified, unreachable for a canonical-routed request
```

No new UI, no new button, no client-side change of any kind. A user who has never heard of "canonical" clicks the same button they always have; which engine actually serves them is decided entirely server-side, per request, based on their `user.id`.

## 2. The routing decision service

`lib/careerMemory/orchestration/canonicalTrafficRouter.ts` — a single pure function, `decideGenerationRoute(userId): RoutingDecision`. Contains zero generation logic (never touches OpenAI, career_memory, or any renderer) — it can be replaced with a different routing strategy without either pipeline's own code changing.

Decision order (every branch except two explicitly returns `"legacy"`):
1. `CANONICAL_GENERATE_ENABLED` unset/false → `legacy` (`flag_disabled`).
2. Canary stage 0 (`CANONICAL_CANARY_STAGE` unset or `0`) → `legacy` (`stage_0`).
3. Stage requires an allowlist (Stage 1–2) → `canonical` if the user's id is in `CANONICAL_CANARY_ALLOWLIST_USER_IDS`, else `legacy`.
4. Stage is percentage-based (Stage 3–6) → `canonical` if `hashUserIdToBucket(userId) < trafficPercent`, else `legacy`.

## 3. Deterministic percentage bucketing

`lib/careerMemory/orchestration/canonicalCanaryConfig.ts`'s `hashUserIdToBucket(userId)` is a stable (non-cryptographic) string hash reduced to `[0, 100)`. The same user always lands in the same bucket for as long as the stage's traffic percent is unchanged — a user routed to canonical today is routed to canonical tomorrow too, not re-randomized per request. Raising the traffic percent (e.g. Stage 3 → Stage 4) only ever *adds* users to the canonical side — every user already below the old threshold stays below the new, higher one.

## 4. What routing preserves (Phase 6I's own explicit requirements)

- **Legacy remains default**: confirmed structurally — `decideGenerationRoute` returns `"canonical"` on exactly 2 of 6 branches, everything else is `"legacy"`. Verified this phase (`phase6iProductionEnablement.realdb.test.mts`, section B, 8/8 passing).
- **Canonical path only when enabled**: gated by `isCanonicalGenerateEnabled()`, the same fail-closed flag Phase 6G/6H already established.
- **Routing decision isolated in one service**: `canonicalTrafficRouter.ts` — no other file makes a route decision.
- **No duplicated generation logic**: the canonical branch delegates entirely to `dispatchCanonicalGeneration()` (its own file); legacy's code below the dispatch point is untouched, byte-for-byte identical to before this phase.
- **Idempotency preserved**: canonical dispatch uses the exact same `(user_id, generation_request_id)` unique-constraint idempotency mechanism legacy already uses, on the same `applications` table.
- **Ownership preserved**: `userId` comes only from the authenticated session (`user.id`), never from the request body, on both routing and dispatch.
- **Audit trail preserved**: `canonical_input_manifest` (the generation parameters) and the legacy-equivalent input snapshot are both written at claim-insert time, and `generation_engine` records which engine actually produced the result — visible via the same `/api/applications/[id]/status` polling endpoint and Job Tracker.

## 5. Observability

Every routing decision is logged (`canonical_routing_decision` event — see Monitoring Dashboard doc) with `route`, `reason`, and `stage`, before the branch executes — this is what lets a canary stage's *actual* traffic split be measured directly from logs rather than inferred from the `applications` table.
