# Canonical Career Memory — Operations Runbook

Status: Phase 6I. Day-to-day operational procedures for running the canonical system in Production — distinct from the Incident Response Runbook (which covers active failures) and the Canary Plan (which covers rollout stage progression).

## 1. Changing the canary stage

1. Confirm the current stage's success/rollback thresholds have held (Canary Plan doc) for at least its minimum duration.
2. Update `CANONICAL_CANARY_STAGE` in the Netlify environment (Site configuration → Environment variables). Takes effect on the next request — flags are read at call time, never cached (`featureFlags.ts`/`canonicalCanaryConfig.ts`'s own design).
3. For Stage 1→2 or within Stage 1–2, also update `CANONICAL_CANARY_ALLOWLIST_USER_IDS` (comma-separated real `auth.users` ids — never emails, this var may appear in deploy logs).
4. Watch `canonical_routing_decision` logs for ~15 minutes to confirm the new stage's traffic split matches expectations (e.g. Stage 3 should show roughly 1 in 100 decisions as `route:"canonical"`).
5. Record the change (timestamp, old stage, new stage, operator) — no automated changelog exists for this; keep it in the incident/ops log manually.

## 2. Adding or removing an allowlisted user (Stage 1–2 only)

Edit `CANONICAL_CANARY_ALLOWLIST_USER_IDS` directly — it's a flat comma-separated list, no separate admin UI. Confirm the user id is a real `auth.users.id` (UUID), not an email — the allowlist check is a plain string-set membership test against `userId`, which is always a UUID at the call site.

## 3. Checking a specific user's routing outcome

Given a `user_id`, there is no dedicated lookup tool — reconstruct it from `canonical_routing_decision` logs (filter by searching Netlify Function Logs around the time of their request; the log line does not include `userId` itself, by PII-safety design — see Monitoring Dashboard doc — so correlate by `applicationId` from `canonical_generate`/`canonical_status` instead, or `hashUserIdToBucket(userId)` computed locally against the active stage's `trafficPercent`).

## 4. Checking quota state for a user

Quota is the SAME ledger legacy uses (`generate_package_quota_periods`/`generate_package_quota_reservations`) — no canonical-specific quota table exists. Query via the existing `get_generate_package_usage` RPC or the admin SQL pattern already established for legacy quota support requests. A canonical-routed generation and a legacy-routed generation both count against the same monthly limit.

## 5. Forcing a specific user to legacy (support escalation)

There is no per-user override flag. The only levers are: (a) remove them from the Stage 1–2 allowlist if applicable, (b) reduce the active stage's traffic percent (affects all users near their bucket boundary, not just one), or (c) roll back to Stage 0 entirely (Rollback Plan doc). A true per-user kill switch is not implemented this phase — flagged in Known Issues if it becomes a real operational need.

## 6. Verifying the background worker is healthy

- **Local/dev**: `app/api/internal/canonical-generate-package-worker/route.ts` — 404s automatically if `isNetlifyRuntime()` is true, so this only matters when testing locally.
- **Production**: `netlify/functions/canonical-generate-package-background.ts` — check Netlify's own Functions dashboard for invocation count/error rate/duration on this function specifically. A generation stuck at `generation_status='pending'` with `generation_worker_claimed_at` still `null` past a few minutes indicates the enqueue call itself failed silently or the Background Function never started — cross-check against `canonical_generate` error-outcome logs with `errorCode` absent (the dispatch-level enqueue failure already logs via `logSafeError`, not `logCanonicalMetric`, so check `route:"/api/generate-package#canonical-enqueue"` in Netlify's raw function logs, not the structured metric stream).

## 7. Manually reconciling a stuck canonical row

If a row is `generation_status='pending'`, `generation_engine='canonical'`, and has been claimed (`generation_worker_claimed_at` set) for an unreasonable time (worker likely crashed mid-generation): there is no automatic stale-reclaim for canonical rows in this phase (legacy has its own reclaim logic in `route.ts`'s claim-conflict handling; canonical inherits idempotent-replay on retry via the SAME dispatch path, which reclaims a `failed`-or-stale-`pending`-unclaimed row exactly like legacy does — but a row stuck CLAIMED has no automatic timeout). Manual reconciliation: call `complete_canonical_generate_worker(p_status='failed', p_error_code='STUCK_MANUAL_RECONCILE')` via the Supabase SQL editor (service-role only), then have the user retry — their next dispatch with the same `generationRequestId` will see `generation_status='failed'` and reclaim the row automatically.

## 8. Known operational gaps (not built this phase)

- No automated stale-claimed-row reclaim for canonical (see §7) — legacy's own `GIVE_UP_THRESHOLD_MS` reclaim logic was not ported, since canonical's worker-invocation profile hasn't been observed in real Production yet to size a correct threshold.
- No per-user routing override (see §5).
- No canonical-specific quota dashboard — reuses legacy's existing support tooling.
