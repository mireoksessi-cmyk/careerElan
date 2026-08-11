/*
  Phase 6I.6.38A - dedup state for the 80/90/100% OpenAI monthly budget
  email alerts. Each *_sent_at column is set at most once per month via
  an atomic conditional UPSERT (INSERT ... ON CONFLICT DO UPDATE ...
  WHERE column IS NULL), so two concurrent requests crossing the same
  threshold in the same request tick can never both send an email - see
  lib/openai/budget.ts's claimBudgetAlertThreshold(). A new UTC month is
  simply a new primary-key row, so thresholds reset automatically with
  no cron/cleanup job needed.

  Locked down identically to admin_staff/admin_audit_log/
  openai_usage_events: RLS enabled, ALL revoked from anon/authenticated,
  service-role only.
*/

create table if not exists public.openai_budget_alert_state (
  -- UTC 'YYYY-MM'.
  year_month text primary key,
  warning_sent_at timestamptz,   -- 80% threshold (HIGH)
  critical_sent_at timestamptz,  -- 90% threshold (CRITICAL)
  exceeded_sent_at timestamptz,  -- 100% threshold (CRITICAL)
  updated_at timestamptz not null default now()
);

comment on table public.openai_budget_alert_state is
  'Phase 6I.6.38A - dedup state for the 80/90/100% OpenAI monthly budget
   email alerts. Service-role access only.';

alter table public.openai_budget_alert_state enable row level security;
revoke all on public.openai_budget_alert_state from anon, authenticated;
grant select, insert, update on public.openai_budget_alert_state to service_role;
