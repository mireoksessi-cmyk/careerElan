/*
  Phase 6I.6.38A Operational Activation - lets a budget threshold
  legitimately re-fire within the same UTC month after a manual
  recharge raises the effective budget, without ever un-sending a past
  alert and without brittle process-memory logic.

  Each *_claim_effective_budget_usd column records the effective
  budget (base + recharges-to-date) that was in force at the moment
  that threshold was last claimed. lib/openai/budget.ts's
  claimBudgetAlertThreshold() then allows a NEW claim only when the
  current effective budget is strictly greater than the stored value -
  i.e. only after a genuine recharge, never merely because spend
  fluctuated under an unchanged budget. Recharges are append-only and
  non-negative (Part G/F of the operator's spec), so the effective
  budget is monotonically non-decreasing within a month - this
  comparison can never spuriously reopen a threshold.

  Nullable, no default: existing rows (and any threshold never yet
  claimed) simply have NULL here, exactly like the existing *_sent_at
  columns.
*/

alter table public.openai_budget_alert_state
  add column if not exists warning_claim_effective_budget_usd numeric(12, 6),
  add column if not exists critical_claim_effective_budget_usd numeric(12, 6),
  add column if not exists exceeded_claim_effective_budget_usd numeric(12, 6);
