/*
  Phase 6I.6.38A - orchestrates the 80/90/100% monthly budget email
  alerts (Part J/K/L). Called after every openai_usage_events insert
  (see lib/openai/telemetry.ts) - cheap (one aggregate read + at most
  3 atomic claim attempts) and naturally fires exactly when spend could
  have just crossed a threshold, with no separate cron job needed.

  Each threshold is checked and claimed independently every call, so a
  single cost event that jumps spend across more than one threshold at
  once (e.g. 70% -> 95%) still sends every newly-crossed alert exactly
  once, never more.

  Never throws into the caller - a failure here must not affect the
  OpenAI call or its own telemetry write.
*/
import { getBudgetSummary, claimBudgetAlertThreshold } from "./budget";
import { sendBudgetAlertEmail, type BudgetAlertLevel } from "./alertEmail";
import { logOperationalEvent, type OpenAiBudgetEvent } from "../observability/logger";

const CHECKS: { threshold: "warning" | "critical" | "exceeded"; minPercent: number; level: BudgetAlertLevel; logEvent: OpenAiBudgetEvent["event"] }[] = [
  { threshold: "warning", minPercent: 80, level: "WARNING_80", logEvent: "warning_80" },
  { threshold: "critical", minPercent: 90, level: "CRITICAL_90", logEvent: "critical_90" },
  { threshold: "exceeded", minPercent: 100, level: "EXCEEDED_100", logEvent: "exceeded_100" },
];

export async function checkAndTriggerBudgetAlerts(now = new Date()): Promise<void> {
  try {
    const summary = await getBudgetSummary(now);
    if (!summary.configured) return;

    for (const check of CHECKS) {
      if (summary.budgetUsedPercent < check.minPercent) continue;

      const claimed = await claimBudgetAlertThreshold(check.threshold, now);
      if (!claimed) continue; // already sent this month, or lost the race to another concurrent request

      const result = await sendBudgetAlertEmail({
        level: check.level,
        monthSpendUsd: summary.monthSpendUsd,
        monthlyBudgetUsd: summary.monthlyBudgetUsd,
        budgetUsedPercent: summary.budgetUsedPercent,
        timestampIso: now.toISOString(),
      });

      logOperationalEvent({
        domain: "openai_budget",
        event: check.logEvent,
        budgetUsedPercent: summary.budgetUsedPercent,
        monthSpendUsd: summary.monthSpendUsd,
        monthlyBudgetUsd: summary.monthlyBudgetUsd,
        emailSent: result.sent,
      } as OpenAiBudgetEvent);
    }
  } catch {
    // Swallowed deliberately - see this module's own header comment.
  }
}
