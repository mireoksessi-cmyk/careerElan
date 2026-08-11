/*
  Phase 6I.6.37 - Alerts. Computed fresh from existing health data on
  every read, never persisted (see this phase's own STOP-avoidance
  decision: ALERT_STATE_SCHEMA_CHANGE_REQUIRED was deferred rather than
  approved, so there is no admin_alert_state table - every alert here
  is always "OPEN", acknowledge/resolve is not offered). Thresholds
  live in lib/admin/alertThresholds.ts (a plain constants file, per
  Part N's explicit allowance for code/env-based thresholds instead of
  a settings table).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { getStuckPendingGenerationsHealth, getRecentGenerationOutcomeHealth } from "../../observability/health";
import { minutesAgo } from "./shared";
import { ALERT_THRESHOLDS } from "../alertThresholds";
import { getBudgetSummary } from "../../openai/budget";

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export type AdminAlert = {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  status: "OPEN";
};

export async function getAlerts(): Promise<AdminAlert[]> {
  const alerts: AdminAlert[] = [];
  const window15 = minutesAgo(15).toISOString();

  const [
    { count: recentFailures },
    { count: recentAttempts },
    { count: enqueueFailures15m },
    stuck,
    outcome15,
    { count: openAi429_15m },
    { count: openAiTimeouts15m },
    { count: openAiCalls15m },
    { count: openAiErrors15m },
  ] = await Promise.all([
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_status", "failed").gte("updated_at", window15),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).not("generation_status", "is", null).gte("updated_at", window15),
    supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).eq("generation_error_code", "BACKGROUND_ENQUEUE_FAILED").gte("updated_at", window15),
    getStuckPendingGenerationsHealth(),
    getRecentGenerationOutcomeHealth(15),
    supabaseAdmin.from("openai_usage_events").select("id", { count: "exact", head: true }).eq("http_status_class", "429").gte("created_at", window15),
    supabaseAdmin.from("openai_usage_events").select("id", { count: "exact", head: true }).eq("http_status_class", "timeout").gte("created_at", window15),
    supabaseAdmin.from("openai_usage_events").select("id", { count: "exact", head: true }).gte("created_at", window15),
    supabaseAdmin.from("openai_usage_events").select("id", { count: "exact", head: true }).eq("status", "error").gte("created_at", window15),
  ]);

  if ((enqueueFailures15m ?? 0) >= ALERT_THRESHOLDS.enqueueFailuresCriticalCount) {
    alerts.push({
      key: "repeated_worker_enqueue_failures",
      severity: "CRITICAL",
      title: "Repeated background worker enqueue failures",
      detail: `${enqueueFailures15m} BACKGROUND_ENQUEUE_FAILED in the last 15 minutes.`,
      status: "OPEN",
    });
  }

  if (stuck.count > 0 && (stuck.oldestPendingAgeMs ?? 0) >= ALERT_THRESHOLDS.stuckSevereAgeMs) {
    alerts.push({
      key: "stuck_generation_severe",
      severity: "CRITICAL",
      title: "Severely stuck generation(s)",
      detail: `${stuck.count} stuck pending, oldest ${Math.round((stuck.oldestPendingAgeMs ?? 0) / 60000)} min.`,
      status: "OPEN",
    });
  }

  if ((recentFailures ?? 0) >= ALERT_THRESHOLDS.highFailureCount15m) {
    alerts.push({
      key: "generate_package_failure_spike",
      severity: "HIGH",
      title: "Generate Package failure spike",
      detail: `${recentFailures} failures in the last 15 minutes.`,
      status: "OPEN",
    });
  }

  if ((recentAttempts ?? 0) >= ALERT_THRESHOLDS.minAttemptsForRateAlert && outcome15.errorRate !== null && outcome15.errorRate >= ALERT_THRESHOLDS.highFailureRate) {
    alerts.push({
      key: "generate_package_failure_rate",
      severity: "HIGH",
      title: "Elevated Generate Package failure rate",
      detail: `${Math.round(outcome15.errorRate * 100)}% failure rate over ${recentAttempts} attempts (last 15 min).`,
      status: "OPEN",
    });
  }

  if (stuck.count > 0) {
    alerts.push({
      key: "stuck_generation_present",
      severity: "MEDIUM",
      title: "Stuck pending generation(s)",
      detail: `${stuck.count} generation(s) past the reclaim threshold.`,
      status: "OPEN",
    });
  }

  /*
    Phase 6I.6.38A Part O - OpenAI call-level spikes across every
    operation (not just Generate Package), computed fresh from
    openai_usage_events on every read - same "never persisted, always
    OPEN" pattern as the rest of this function, no acknowledge/resolve
    state added (explicitly deferred per Part O).
  */
  if ((openAi429_15m ?? 0) >= ALERT_THRESHOLDS.openAiRateLimitSpike15m) {
    alerts.push({
      key: "openai_rate_limit_spike",
      severity: "HIGH",
      title: "OpenAI rate limit (429) spike",
      detail: `${openAi429_15m} rate-limited OpenAI calls in the last 15 minutes.`,
      status: "OPEN",
    });
  }

  if ((openAiTimeouts15m ?? 0) >= ALERT_THRESHOLDS.openAiTimeoutSpike15m) {
    alerts.push({
      key: "openai_timeout_spike",
      severity: "HIGH",
      title: "OpenAI timeout spike",
      detail: `${openAiTimeouts15m} timed-out OpenAI calls in the last 15 minutes.`,
      status: "OPEN",
    });
  }

  if ((openAiCalls15m ?? 0) >= ALERT_THRESHOLDS.minOpenAiCallsForRateAlert) {
    const errorRate = (openAiErrors15m ?? 0) / (openAiCalls15m ?? 1);
    if (errorRate >= ALERT_THRESHOLDS.openAiFailureRate15m) {
      alerts.push({
        key: "openai_failure_rate",
        severity: "HIGH",
        title: "Elevated OpenAI failure rate",
        detail: `${Math.round(errorRate * 100)}% failure rate over ${openAiCalls15m} OpenAI calls (last 15 min).`,
        status: "OPEN",
      });
    }
  }

  const budget = await getBudgetSummary();
  if (budget.configured && budget.status !== "NORMAL") {
    alerts.push({
      key: "openai_budget_" + budget.status.toLowerCase(),
      severity: budget.status === "WARNING" ? "MEDIUM" : "CRITICAL",
      title:
        budget.status === "BUDGET_EXCEEDED"
          ? "OpenAI monthly budget exceeded"
          : budget.status === "CRITICAL"
            ? "OpenAI monthly budget critical (90%+)"
            : "OpenAI monthly budget warning (80%+)",
      detail: `${budget.budgetUsedPercent}% of the $${budget.effectiveBudgetUsd} effective monthly budget used ($${budget.monthSpendUsd.toFixed(2)} spent).`,
      status: "OPEN",
    });
  }

  return alerts;
}

export function countBySeverity(alerts: AdminAlert[]) {
  return {
    critical: alerts.filter((a) => a.severity === "CRITICAL").length,
    high: alerts.filter((a) => a.severity === "HIGH").length,
    medium: alerts.filter((a) => a.severity === "MEDIUM").length,
    info: alerts.filter((a) => a.severity === "INFO").length,
  };
}
