/*
  Admin API Usage Phase 2 - manual USD->CAD accounting rate, read-only
  from a server-only env var. NEVER a live FX API call (explicitly out
  of scope for this phase) and NEVER NEXT_PUBLIC_* (this value never
  needs to reach the browser - CAD figures are computed server-side in
  lib/admin/queries/apiCosts.ts and lib/openai/telemetry.ts, same
  pattern as OPENAI_MONTHLY_BUDGET_USD in lib/openai/budget.ts).

  Deliberately mirrors getConfiguredMonthlyBudgetUsd()'s exact shape:
  returns null (never a fabricated 1.00 or any other guessed value) if
  unset, non-numeric, non-finite, or <= 0 - callers must handle "CAD
  unavailable" explicitly rather than silently defaulting.
*/

export function getConfiguredUsdToCadRate(): number | null {
  const raw = process.env.OPENAI_ACCOUNTING_USD_CAD_RATE;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/*
  Called once per usage event, at insert time (lib/openai/telemetry.ts),
  using whatever rate is configured AT THAT MOMENT - the result is then
  persisted (estimated_cost_cad + usd_cad_rate) and never recomputed
  later. This is what makes historical CAD figures immune to a later
  rate change: aggregation code (lib/openai/usageAggregation.ts) only
  ever sums the already-persisted estimated_cost_cad column, it never
  calls this function against historical usdCost figures.
*/
export function convertUsdToCad(usdCost: number, rate: number): number {
  return Math.round(usdCost * rate * 1_000_000) / 1_000_000;
}
