# Canonical Career Memory — Canary Rollout Plan (Phase 6I)

Status: Phase 6I. Supersedes Phase 6H's `docs/canonical-rollout-plan.md` for the Stage 3+ "blocked" language — the traffic-routing mechanism, quota, fallback, and background execution gaps that plan flagged as prerequisites are now closed (`docs/canonical-known-issues.md` updated accordingly). The 6H document's per-stage flag/metric structure is retained below with corrected, now-executable content.

## How a stage actually changes behavior now

Every stage below is a combination of exactly 2 environment variables plus the 5 pre-existing canonical flags:

- `CANONICAL_GENERATE_ENABLED=true` (master switch — required for any stage above 0)
- `CANONICAL_CANARY_STAGE=<0-6>` (which stage is active)
- `CANONICAL_CANARY_ALLOWLIST_USER_IDS=<comma-separated user ids>` (only read for Stage 1–2)
- `CANONICAL_LEGACY_FALLBACK_ENABLED=true` (recommended ON from Stage 1 onward — see below)
- `CANONICAL_DOCUMENT_STORAGE_ENABLED=true` (required for canonical output to actually persist)

No code deploy is required to move between stages — every stage transition is an env var change.

## Stage 0 — All flags OFF (current default)

- **Enable flags**: none.
- **Traffic**: 0%.
- **Success threshold**: N/A.
- **Rollback trigger**: N/A (this is the rollback target for every other stage).
- **Monitoring**: none canonical-specific.
- **Expected duration**: indefinite baseline.

## Stage 1 — Internal developers

- **Enable flags**: `CANONICAL_GENERATE_ENABLED=true`, `CANONICAL_CANARY_STAGE=1`, `CANONICAL_CANARY_ALLOWLIST_USER_IDS=<dev user ids>`, `CANONICAL_DOCUMENT_STORAGE_ENABLED=true`, `CANONICAL_LEGACY_FALLBACK_ENABLED=true`.
- **Traffic**: only the explicitly allowlisted developer accounts, via the SAME "Generate Package" button in production (no separate internal tool needed anymore — Traffic Routing doc §1).
- **Success threshold**: 100% of allowlisted-developer generations reach `generation_status='succeeded'` (either engine — a canonical failure absorbed by fallback still counts as a user-visible success).
- **Rollback trigger**: any generation that fails with no fallback recorded (`fallback_used=false` on a `failed` row) — investigate before continuing.
- **Monitoring**: manual tail of `canonical_routing_decision`/`canonical_generate`/`canonical_fallback` logs during test clicks.
- **Expected duration**: at least 1 full pass covering all 4 templates, minimum 1 day no-error soak.

## Stage 2 — Internal employees

- **Enable flags**: same as Stage 1, allowlist expanded to internal employee accounts.
- **Traffic**: allowlisted employees only, real dogfooding via the real UI button.
- **Success threshold**: ≥ 95% success rate (engine-agnostic, i.e. counting fallback-absorbed successes); 0 ownership/RLS violations.
- **Rollback trigger**: success rate < 95% over any 10-attempt window, or any RLS violation (P0, immediate).
- **Monitoring**: `canonical_generate` success/error rate, `canonical_fallback` rate and reasons.
- **Expected duration**: 3–5 business days minimum.

## Stage 3 — 1% of real users

- **Enable flags**: `CANONICAL_CANARY_STAGE=3` (allowlist no longer read — percentage bucketing takes over automatically).
- **Traffic**: ~1% of all real Generate Package requests, decided per-user by `hashUserIdToBucket` (Traffic Routing doc §3) — no manual account list.
- **Success threshold**: engine-agnostic success rate within 2 percentage points of legacy's own baseline; latency P95 no more than 2× legacy P95 (canonical's synchronous-per-request generation call inside the background worker, not the client-facing request, still has the same underlying latency profile legacy always had — see Production Architecture doc §5).
- **Rollback trigger**: success-rate or latency threshold breach, or fallback rate exceeding a set baseline (establish the baseline during Stage 1–2 soak).
- **Monitoring**: full dashboard (Monitoring Dashboard doc), `canonical_fallback` rate broken out by reason.
- **Expected duration**: 1–2 weeks (covers weekday/weekend variance).

## Stage 4 — 10% of real users

- **Enable flags**: unchanged; `CANONICAL_CANARY_STAGE=4`.
- **Success threshold**: same as Stage 3, now required at 10× volume.
- **Rollback trigger**: same thresholds, plus watch for any background-worker cold-start/concurrency degradation not visible at 1%.
- **Monitoring**: same, watched more closely for volume-dependent effects.
- **Expected duration**: minimum 2 weeks.

## Stage 5 — 50% of real users

- **Enable flags**: unchanged; `CANONICAL_CANARY_STAGE=5`.
- **Success threshold**: parity with legacy within 1 percentage point (tighter — this is a genuine A/B at scale).
- **Rollback trigger**: same category at the tighter threshold.
- **Monitoring**: full dashboard, actively watched by on-call, not just periodically reviewed.
- **Expected duration**: 2–3 weeks, including at least one full reporting cycle if usage ties into cost accounting.

## Stage 6 — 100% (canonical becomes primary)

- **Enable flags**: `CANONICAL_CANARY_STAGE=6`; `CANONICAL_LEGACY_FALLBACK_ENABLED=true` stays ON permanently, not just during rollout — legacy remains the safety net indefinitely.
- **Traffic**: 100%.
- **Success threshold**: sustained parity with pre-cutover baseline; fallback rate trending down over time.
- **Rollback trigger**: any sustained (multi-hour) regression; full stage-by-stage rollback capability (Rollback Plan doc) stays tested and ready even after reaching 100%.
- **Monitoring**: full dashboard, standard on-call rotation.
- **Expected duration**: indefinite — terminal state. Legacy code stays in place; deleting it is a separate, later, explicit decision.

## Cross-stage constants

- `CANONICAL_LEGACY_FALLBACK_ENABLED=true` from Stage 1 onward, always.
- Rolling back any stage to Stage 0 is `CANONICAL_GENERATE_ENABLED=false` (or unset) — no DB rollback, no data loss (Rollback Plan doc).
- Quota is shared with legacy (same ledger, same limit per user per period) — a percentage-rollout stage does not by itself increase any user's total allowed generations (Production Architecture doc §6).
