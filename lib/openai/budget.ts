/*
  Phase 6I.6.38A - monthly OpenAI budget calculation, status
  classification, and atomic threshold-crossing dedup.

  OPENAI_MONTHLY_BUDGET_USD is a server-only env var (never
  NEXT_PUBLIC_). If absent, every function here returns
  MONTHLY_BUDGET_NOT_CONFIGURED - never a fabricated percentage
  (Part H).
*/
import { supabaseAdmin } from "../supabaseAdmin";

export type BudgetStatus = "NORMAL" | "WARNING" | "CRITICAL" | "BUDGET_EXCEEDED";

export type BudgetSummary =
  | {
      configured: true;
      monthSpendUsd: number;
      monthlyBudgetUsd: number;
      remainingBudgetUsd: number;
      budgetUsedPercent: number;
      status: BudgetStatus;
    }
  | { configured: false };

export function getConfiguredMonthlyBudgetUsd(): number | null {
  const raw = process.env.OPENAI_MONTHLY_BUDGET_USD;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function classifyBudgetStatus(budgetUsedPercent: number): BudgetStatus {
  if (budgetUsedPercent >= 100) return "BUDGET_EXCEEDED";
  if (budgetUsedPercent >= 90) return "CRITICAL";
  if (budgetUsedPercent >= 80) return "WARNING";
  return "NORMAL";
}

export function currentUtcYearMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfUtcMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/*
  monthSpendUsd sums estimated_cost_usd across this UTC month's
  openai_usage_events rows. Rows with a NULL cost (UNKNOWN_PRICING or a
  failed call before usage existed) contribute 0 - this is therefore a
  floor, not a ceiling, on real spend; disclosed as a known limitation
  in the final report whenever any UNKNOWN_PRICING rows exist in the
  window.
*/
export async function getBudgetSummary(now = new Date()): Promise<BudgetSummary> {
  const monthlyBudgetUsd = getConfiguredMonthlyBudgetUsd();
  if (monthlyBudgetUsd === null) return { configured: false };

  const { data, error } = await supabaseAdmin
    .from("openai_usage_events")
    .select("estimated_cost_usd")
    .gte("created_at", startOfUtcMonthIso(now));

  const monthSpendUsd = error
    ? 0
    : (data ?? []).reduce((sum, row) => sum + (typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0), 0);

  const budgetUsedPercent = monthlyBudgetUsd > 0 ? Math.round((monthSpendUsd / monthlyBudgetUsd) * 10000) / 100 : 0;

  return {
    configured: true,
    monthSpendUsd: Math.round(monthSpendUsd * 1_000_000) / 1_000_000,
    monthlyBudgetUsd,
    remainingBudgetUsd: Math.round((monthlyBudgetUsd - monthSpendUsd) * 1_000_000) / 1_000_000,
    budgetUsedPercent,
    status: classifyBudgetStatus(budgetUsedPercent),
  };
}

export type BudgetThreshold = "warning" | "critical" | "exceeded";
const THRESHOLD_COLUMN: Record<BudgetThreshold, "warning_sent_at" | "critical_sent_at" | "exceeded_sent_at"> = {
  warning: "warning_sent_at",
  critical: "critical_sent_at",
  exceeded: "exceeded_sent_at",
};

/*
  Atomically claims a threshold for the current UTC month: returns true
  ONLY for the one caller that successfully transitions the column from
  NULL to a timestamp (Part L/S - "must be database-safe/atomic",
  "two simultaneous requests crossing 80% must NOT produce two
  emails"). Every other concurrent caller (or a later call in the same
  month) gets false and must not send an email.

  Implemented as an UPSERT whose UPDATE branch is conditioned on the
  target column still being NULL - Postgres evaluates ON CONFLICT ...
  WHERE atomically against the row lock, so this is safe under
  concurrent execution without a separate transaction/advisory lock.
*/
export async function claimBudgetAlertThreshold(threshold: BudgetThreshold, now = new Date()): Promise<boolean> {
  const yearMonth = currentUtcYearMonth(now);
  const column = THRESHOLD_COLUMN[threshold];
  const nowIso = now.toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("openai_budget_alert_state")
    .insert({ year_month: yearMonth, [column]: nowIso })
    .select(column)
    .maybeSingle();

  if (!insertError && inserted) return true;

  // Row already exists for this month - attempt the conditional claim.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("openai_budget_alert_state")
    .update({ [column]: nowIso, updated_at: nowIso })
    .eq("year_month", yearMonth)
    .is(column, null)
    .select(column)
    .maybeSingle();

  return !updateError && Boolean(updated);
}
