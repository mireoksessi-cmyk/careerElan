/*
  Phase 6I.6.36 - read-only operational health aggregation helpers.
  Every query returns only counts/aggregates (never row content, never
  resume/job/cover-letter text) and reuses the SAME thresholds the
  production reclaim logic already uses rather than inventing new ones
  - see each constant's own comment for its source of truth.

  Deliberately NOT wrapped in a public HTTP endpoint (Part V/W of this
  phase): the External/Admin readiness audits run this same phase found
  no existing safe admin-authentication mechanism to gate one behind
  (see docs/PRODUCTION_MONITORING_RUNBOOK.md's ADMIN_AUTH_REQUIRED_FOR_
  MONITORING_UI note). These functions are for direct server-side use
  only - a one-off script (supabaseAdmin already requires the service
  role key, itself server-only), or a future authenticated admin route
  once one exists - never exposed unauthenticated.
*/
import { supabaseAdmin } from "../supabaseAdmin";

// Mirrors WORKER_STALE_THRESHOLD_MS in
// lib/careerMemory/orchestration/canonicalGenerateDispatchService.ts -
// not re-derived, deliberately identical, so "stuck" here means the
// exact same thing the reclaim logic itself already acts on.
const STUCK_PENDING_THRESHOLD_MS = 5 * 60 * 1000;

/*
  A stale-quota-reservation COUNT helper was drafted for this phase but
  deliberately left out: supabase/migrations/
  20260725073100_generate_package_lifetime_quota.sql:305 runs `revoke
  all on public.generate_package_quota_reservations from anon,
  authenticated` and grants no privileges to service_role either - this
  table is intentionally reachable ONLY through its own SECURITY
  DEFINER RPCs (reserve/complete/release/reclaim_generate_package_
  usage), confirmed empirically in this phase's own test run
  ("permission denied for table generate_package_quota_reservations",
  code 42501, even via supabaseAdmin). None of the existing RPCs expose
  a plain "how many reservations are currently stale" count. Adding one
  would be a genuine schema change (a new SECURITY DEFINER function),
  which this phase's own instructions say to flag rather than add
  silently - reported as OBSERVABILITY_SCHEMA_CHANGE_REQUIRED in the
  phase's final report instead of worked around with a direct-access
  GRANT (which would itself weaken this table's existing lockdown).
*/

export type StuckPendingGenerationsHealth = {
  count: number;
  oldestPendingAgeMs: number | null;
};

export async function getStuckPendingGenerationsHealth(): Promise<StuckPendingGenerationsHealth> {
  const cutoff = new Date(Date.now() - STUCK_PENDING_THRESHOLD_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("applications")
    .select("generation_started_at")
    .eq("generation_status", "pending")
    .lt("generation_started_at", cutoff);

  if (error || !data) return { count: 0, oldestPendingAgeMs: null };

  const oldestPendingAgeMs = data.reduce<number | null>((max, row) => {
    if (!row.generation_started_at) return max;
    const age = Date.now() - new Date(row.generation_started_at).getTime();
    return max === null ? age : Math.max(max, age);
  }, null);

  return { count: data.length, oldestPendingAgeMs };
}

export type GenerationOutcomeHealth = {
  windowMinutes: number;
  succeeded: number;
  failed: number;
  pending: number;
  // failed / (succeeded + failed) - null when nothing terminal happened
  // in the window yet, so a dashboard/alert never divides by zero or
  // misreads "no data" as "0% error rate".
  errorRate: number | null;
};

export async function getRecentGenerationOutcomeHealth(windowMinutes = 60): Promise<GenerationOutcomeHealth> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("applications")
    .select("generation_status")
    .gte("created_at", since)
    .not("generation_status", "is", null);

  if (error || !data) {
    return { windowMinutes, succeeded: 0, failed: 0, pending: 0, errorRate: null };
  }

  const succeeded = data.filter((row) => row.generation_status === "succeeded").length;
  const failed = data.filter((row) => row.generation_status === "failed").length;
  const pending = data.filter((row) => row.generation_status === "pending").length;
  const total = succeeded + failed;

  return { windowMinutes, succeeded, failed, pending, errorRate: total > 0 ? failed / total : null };
}
