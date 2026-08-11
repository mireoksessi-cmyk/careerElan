/*
  Phase 6I.6.38A Operational Activation - manual OpenAI recharge/top-up
  ledger. Records only the FACT that an operator manually added OpenAI
  credit outside Career Élan (e.g. via the OpenAI dashboard) - this
  table never calls any OpenAI billing/payment API and never purchases
  anything itself.

  Append-only by design (Part G of the operator's spec): no operator
  action to edit or delete a row is offered in this phase, and
  service_role is granted only SELECT/INSERT below - matching the exact
  lockdown pattern already used for openai_usage_events
  (20260810190000) and openai_budget_alert_state (20260810190100).

  actor_admin_user_id references auth.users(id) directly (not
  admin_staff(user_id)) with ON DELETE SET NULL, matching
  admin_audit_log's own established convention - so a historical
  recharge record survives even if the admin's staff row or account is
  later removed.
*/

create table if not exists public.openai_manual_recharges (
  id uuid primary key default gen_random_uuid(),
  amount_usd numeric(12, 6) not null check (amount_usd > 0),
  actor_admin_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.openai_manual_recharges is
  'Phase 6I.6.38A Operational Activation - manual record of OpenAI
   credit added outside Career Élan. Never purchases anything, never
   calls a payment/billing API. Append-only, service-role access only.';

alter table public.openai_manual_recharges enable row level security;
revoke all on public.openai_manual_recharges from anon, authenticated;
grant select, insert on public.openai_manual_recharges to service_role;

create index if not exists openai_manual_recharges_created_at_idx on public.openai_manual_recharges (created_at desc);
