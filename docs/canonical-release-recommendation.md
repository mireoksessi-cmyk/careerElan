# Canonical Career Memory — Release Recommendation

Status: Phase 6I (Production Enablement), final assessment. Supersedes the Phase 6H recommendation, which held that Stage 3+ was not achievable in code — that is no longer true.

## Recommendation: PASS for Stage 0 (current state) through Stage 2 with high confidence; **conditionally ready** for Stage 3 pending real Production data from Stage 1–2, not blocked by missing mechanisms anymore.

## What changed since Phase 6H

Phase 6H's own recommendation named 3 structural gaps as the reason Stage 3+ wasn't achievable: no traffic-routing mechanism, no quota mechanism, and the fallback flag having no real effect. All 3 are closed this phase (Known Issues doc, "Closed this phase"):

- **Routing**: the existing "Generate Package" button now automatically reaches canonical for canary-eligible users, with zero new UI (Traffic Routing doc).
- **Quota**: canonical shares legacy's own proven quota ledger — no new metering system, no double-charging risk (Production Architecture doc §7).
- **Fallback**: `runCanonicalWithFallbackDecision()` is genuinely wired in; a fallback-eligible canonical failure now hands off to legacy's real, unmodified generation logic, verified end-to-end at the SQL/orchestration level this phase (`phase6iProductionEnablement.realdb.test.mts` §F).

A 4th, previously-undetected bug (bare `NotFoundError` incorrectly falling back) was found and fixed while closing the fallback gap — closing #4 required actually exercising the classification logic against the real domain-error hierarchy, which is what surfaced it.

## Why "conditionally ready" rather than unconditional PASS for Stage 3+

Every mechanism Stage 3+ needs now EXISTS and is verified at the orchestration/SQL level — but none of it has run against real OpenAI calls or real Production traffic yet (deliberately: this phase's own tests avoid real AI cost, per this repo's established convention, in favor of exhaustive RPC/orchestration-level verification). Specifically still unknown:

1. **Real fallback latency**: a fallback-eligible failure now costs the user a canonical attempt's time (including the doomed OpenAI call) PLUS legacy's own full generation time — this could roughly double worst-case latency for a fallback-triggering request. Not measured against real timing yet.
2. **Real Production background-worker behavior**: the canonical Background Function has never actually run in real Netlify Production. Legacy's own equivalent is proven there; canonical's is proven only via the local-dev stand-in route + direct RPC testing.
3. **Stale-claim reclaim gap** (Known Issues #7): if the Background Function crashes mid-generation in real Production, that row currently has no automatic recovery — acceptable at Stage 1–2's low volume (manual reconciliation, Operations Runbook §7), a genuine risk at Stage 3+'s real-user volume if the crash rate turns out to be non-negligible.

None of these require new architecture to resolve — they require Stage 1–2 to actually run in Production and produce real data, which is precisely what Stage 1–2 is for.

## Recommended path

1. Enable Stage 1 (internal developers) in Production. Confirm the dev-only inspector pages are genuinely unreachable there first (Known Issues #6).
2. Run Stage 1 long enough to observe: real fallback latency (if any fallback triggers), real Background Function cold-start/duration, whether any row gets stuck claimed.
3. Advance to Stage 2 (internal employees) once Stage 1 shows no surprises. This is real dogfooding at low-but-nonzero volume.
4. Before Stage 3: revisit Known Issues #7 with real Stage 1–2 data to size a stale-claim reclaim threshold if the crash rate observed warrants it; otherwise proceed to Stage 3 with manual reconciliation as the accepted interim process.
5. Follow the Canary Plan doc's own per-stage thresholds and durations from Stage 3 onward.

## Verification summary (this phase)

- 773 real-DB + unit assertions passing, 0 failures (regression + 50 new Phase 6I assertions covering canary config, routing decisions, all 4 new RPCs, the fallback SQL handoff, and dispatch idempotency).
- `npx tsc --noEmit -p .` — clean.
- `npm run build` — clean; both the legacy and new canonical worker routes present in the manifest.
- 1 real bug found and fixed (`classifyForFallback` ownership gap), regression-guarded.
- No new migration risk: 3 new RPCs (plus 1 tiny read-only helper) added, all additive, no existing RPC modified, no existing table altered beyond columns Phase 6G already added and left unused.

## Final verdict

**Phase 6I: PASS** for its own explicit scope (routing, fallback, quota, background execution, canary staging, metrics, verification, documentation — all delivered, zero regressions, zero new user-visible features, zero changes to Career Memory/Runtime/Overlay/Template semantics). Recommends proceeding to Stage 1 in Production; Stage 3+ readiness should be reconfirmed with real Stage 1–2 operational data before advancing, not because any mechanism is missing, but because none of this phase's new code has run against real Production traffic yet.
