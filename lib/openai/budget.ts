/*
  Phase 6I.6.38A - monthly OpenAI budget calculation, status
  classification, and atomic threshold-crossing dedup.

  OPENAI_MONTHLY_BUDGET_USD is a server-only env var (never
  NEXT_PUBLIC_). If absent, every function here returns
  MONTHLY_BUDGET_NOT_CONFIGURED - never a fabricated percentage
  (Part H).

  Operational Activation update: the budget an operator actually has
  available is baseBudgetUsd (OPENAI_MONTHLY_BUDGET_USD) PLUS any
  manual recharges recorded during the current UTC month
  (lib/openai/recharges.ts) - never OpenAI billing/payment data, just
  Career Élan's own record of "the operator says they topped up
  credit". effectiveBudgetUsd = baseBudgetUsd + rechargesUsd is what
  every downstream calculation (remaining capacity, percent used,
  80/90/100% thresholds) is based on from this point forward.
*/
import { supabaseAdmin } from "../supabaseAdmin";
import { getMonthlyRechargesUsd } from "./recharges";

export type BudgetStatus = "NORMAL" | "WARNING" | "CRITICAL" | "BUDGET_EXCEEDED";

export type BudgetSummary =
  | {
      configured: true;
      baseBudgetUsd: number;
      rechargesUsd: number;
      effectiveBudgetUsd: number;
      monthSpendUsd: number;
      remainingBudgetUsd: number;
      budgetUsedPercent: number;
      status: BudgetStatus;
    }
  /*
    API-A - two different reasons there is no usable budget picture, kept
    apart so the console can say which. NOT_CONFIGURED means no budget was
    ever set. SPEND_UNAVAILABLE means one is set but this month's spend
    could not be read, which is emphatically not the same as spending
    nothing.
  */
  | { configured: false; reason?: "NOT_CONFIGURED" | "SPEND_UNAVAILABLE" };

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

function startOfNextUtcMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/*
  monthSpendUsd sums estimated_cost_usd across this UTC month's
  openai_usage_events rows - historical spend, completely unaffected by
  recharges (Part N: "do NOT alter openai_usage_events... recharge only
  affects available/effective budget"). Rows with a NULL cost
  (UNKNOWN_PRICING or a failed call before usage existed) contribute 0
  - this is therefore a floor, not a ceiling, on real spend; disclosed
  as a known limitation whenever any UNKNOWN_PRICING rows exist.

  Bounded on both ends (>= start of this month, < start of next month)
  on both the spend query and the recharge query - required for this
  function to be safe to call with a synthetic/test `now`, and the
  correct, honest scope for "this month" even in real production.
*/
export async function getBudgetSummary(now = new Date()): Promise<BudgetSummary> {
  const baseBudgetUsd = getConfiguredMonthlyBudgetUsd();
  if (baseBudgetUsd === null) return { configured: false, reason: "NOT_CONFIGURED" };

  const [{ data, error }, rechargesUsdRaw] = await Promise.all([
    supabaseAdmin
      .from("openai_usage_events")
      .select("estimated_cost_usd")
      .gte("created_at", startOfUtcMonthIso(now))
      .lt("created_at", startOfNextUtcMonthIso(now)),
    getMonthlyRechargesUsd(now),
  ]);

  /*
    API-A - the read failing is not the same as having spent nothing, and
    this is the one place where confusing the two is dangerous. The old
    code substituted 0 here, which made a broken query look like a healthy
    0% month: no threshold could ever be reached, so no 80/90/100 alert
    would fire while spend was in fact unknown and possibly over budget,
    and the console would show a reassuring bar.

    Returning the unconfigured shape instead means every caller stops.
    checkAndTriggerBudgetAlerts() returns before evaluating any threshold,
    so nothing is claimed from openai_budget_alert_state and no misleading
    email goes out; the month's thresholds stay available for a later
    evaluation that can actually read the data. The alerts tab raises no
    budget card, and the console reports that the figure is unavailable
    rather than printing a zero.

    Alert monitoring failing this way never reaches the product request
    that triggered it - the caller already swallows its own errors so a
    telemetry or budget problem cannot fail somebody's generation.
  */
  if (error) {
    return { configured: false, reason: "SPEND_UNAVAILABLE" };
  }

  const monthSpendUsd = (data ?? []).reduce(
    (sum, row) => sum + (typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0),
    0
  );

  const rechargesUsd = round6(rechargesUsdRaw);
  const effectiveBudgetUsd = round6(baseBudgetUsd + rechargesUsd);

  // effectiveBudgetUsd is always > 0 here (baseBudgetUsd is required > 0
  // by getConfiguredMonthlyBudgetUsd, recharges only ever add a positive
  // amount) - never NaN/Infinity, never a division by zero (Part I).
  const budgetUsedPercent = Math.round((monthSpendUsd / effectiveBudgetUsd) * 10000) / 100;

  return {
    configured: true,
    baseBudgetUsd,
    rechargesUsd,
    effectiveBudgetUsd,
    monthSpendUsd: round6(monthSpendUsd),
    remainingBudgetUsd: round6(effectiveBudgetUsd - monthSpendUsd),
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
const CLAIM_BUDGET_COLUMN: Record<
  BudgetThreshold,
  "warning_claim_effective_budget_usd" | "critical_claim_effective_budget_usd" | "exceeded_claim_effective_budget_usd"
> = {
  warning: "warning_claim_effective_budget_usd",
  critical: "critical_claim_effective_budget_usd",
  exceeded: "exceeded_claim_effective_budget_usd",
};

/*
  Atomically claims a threshold for the current UTC month: returns true
  ONLY for the one caller that successfully transitions the column from
  NULL (or an outdated effective-budget claim) to a fresh timestamp
  (Part L/S - "must be database-safe/atomic", "two simultaneous
  requests crossing 80% must NOT produce two emails"). Every other
  concurrent caller (or a later call against the SAME effective budget)
  gets false and must not send an email.

  Re-alert-after-recharge (Part L): a threshold already claimed this
  month can be claimed AGAIN, but ONLY if effectiveBudgetUsd is
  strictly greater than the effective budget recorded at the last
  claim - i.e. only after a genuine recharge raised the ceiling, never
  merely because spend fluctuated under an unchanged budget. Recharges
  are append-only and non-negative, so effectiveBudgetUsd is
  monotonically non-decreasing within a month - this comparison can
  never spuriously reopen a threshold. Past alerts are never un-sent
  and past *_sent_at values are overwritten only on a legitimate new
  claim, preserving the "at most once per effective-budget-level"
  contract without any process-memory state.

  Implemented as an UPSERT whose UPDATE branch is conditioned on
  "target column still NULL OR its claim-budget column is below the
  new effective budget" - Postgres evaluates this atomically against
  the row lock, so this is safe under concurrent execution without a
  separate transaction/advisory lock.
*/
export async function claimBudgetAlertThreshold(
  threshold: BudgetThreshold,
  effectiveBudgetUsd: number,
  now = new Date()
): Promise<boolean> {
  if (!Number.isFinite(effectiveBudgetUsd) || effectiveBudgetUsd <= 0) return false;

  const yearMonth = currentUtcYearMonth(now);
  const column = THRESHOLD_COLUMN[threshold];
  const claimColumn = CLAIM_BUDGET_COLUMN[threshold];
  const nowIso = now.toISOString();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("openai_budget_alert_state")
    .insert({ year_month: yearMonth, [column]: nowIso, [claimColumn]: effectiveBudgetUsd })
    .select(column)
    .maybeSingle();

  if (!insertError && inserted) return true;

  // Row already exists for this month - attempt the conditional claim.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("openai_budget_alert_state")
    .update({ [column]: nowIso, [claimColumn]: effectiveBudgetUsd, updated_at: nowIso })
    .eq("year_month", yearMonth)
    .or(`${column}.is.null,${claimColumn}.lt.${effectiveBudgetUsd}`)
    .select(column)
    .maybeSingle();

  return !updateError && Boolean(updated);
}
