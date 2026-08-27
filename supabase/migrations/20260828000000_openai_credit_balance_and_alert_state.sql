/*
  API-D2 - two structures behind the OpenAI credit-balance model and the
  usage alerts that run on it.

  The old model asked the operator "how much did you top up?" and added that
  to a monthly budget figure. It never described anything OpenAI would
  recognise: a top-up is not a balance, and a balance does not reset on the
  first of the month. This replaces it with the only number the operator can
  actually verify - the current remaining credit their OpenAI billing page
  shows - recorded as a checkpoint, with local production spend accumulated
  from that instant forward.

  Nothing here deletes, rewrites or reinterprets openai_manual_recharges or
  openai_budget_alert_state. Those hold real history of a different
  measurement and are left exactly as they are.
*/

/*
  Each row is one moment at which the operator read their OpenAI balance and
  told Career Elan what it said. Append-only: a correction is a new
  checkpoint, never an edit, because the old figure was true when it was
  taken and the alert cycle that ran against it is part of the record.

  The latest row is the active accounting baseline. Everything before it is
  history.

  numeric(12,6) matches openai_manual_recharges and openai_usage_events, so
  balance and spend are subtracted at the same precision.

  actor references auth.users directly with ON DELETE SET NULL, following
  admin_audit_log and openai_manual_recharges - the financial record must
  outlive the staff row that created it.
*/
create table if not exists public.openai_credit_balance_checkpoints (
  id uuid primary key default gen_random_uuid(),
  confirmed_balance_usd numeric(12, 6) not null check (confirmed_balance_usd > 0),
  created_by_admin_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.openai_credit_balance_checkpoints is
  'API-D2 - operator-confirmed OpenAI remaining credit at a point in time.
   The value is read by a human from the OpenAI billing dashboard and typed
   in; nothing here calls a billing API, scrapes a dashboard or derives a
   balance from usage. Append-only, service-role access only.';

alter table public.openai_credit_balance_checkpoints enable row level security;
revoke all on public.openai_credit_balance_checkpoints from anon, authenticated;
grant select, insert on public.openai_credit_balance_checkpoints to service_role;

create index if not exists openai_credit_balance_checkpoints_created_at_idx
  on public.openai_credit_balance_checkpoints (created_at desc);

/*
  One row per (thing being watched, threshold), holding whether its alert has
  been claimed, sent, superseded or failed.

  alert_key carries the identity, and what goes into it is what decides when
  an alert re-arms:

    openai:checkpoint:<checkpoint uuid>:<80|90|100>
      re-arms when the operator confirms a new balance, and at no other
      time. A credit balance is not monthly and must not reset with the
      calendar.

    external:<provider>:<yyyy-mm>:<limit>:<80|90>
      re-arms each month, because these are monthly request allowances, and
      also when the configured limit changes - a different limit is a
      different threshold, and silence from an alert already sent against
      the old one would be misleading.

  The unique constraint on alert_key is the whole concurrency story: the
  insert either wins or it does not, decided by Postgres, with no advisory
  lock and nothing held in process memory.

  attempts/last_attempt_at bound retries. A send that fails is recorded as
  FAILED and may be re-claimed by a later genuine usage event, at most three
  times and never within an hour of the last attempt - enough that a
  transient Resend outage does not silently lose the alert, bounded enough
  that a persistent one cannot become a loop.
*/
create table if not exists public.api_usage_alert_state (
  alert_key text primary key,
  threshold_percent integer not null check (threshold_percent > 0),
  /*
    CLAIMED  - a sender holds it and is attempting delivery
    SENT     - delivered
    SUPERSEDED - crossed, but represented by a higher threshold's email in
                 the same evaluation, so it needs no message of its own
    FAILED   - delivery failed; eligible for a bounded retry
  */
  state text not null check (state in ('CLAIMED', 'SENT', 'SUPERSEDED', 'FAILED')),
  attempts integer not null default 1 check (attempts >= 0),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.api_usage_alert_state is
  'API-D2 - persistent at-most-once delivery state for usage alerts, keyed
   by alert_key. Claimed before the email is sent, so the telemetry written
   by the alert email itself cannot trigger a second one.';

alter table public.api_usage_alert_state enable row level security;
revoke all on public.api_usage_alert_state from anon, authenticated;
grant select, insert, update on public.api_usage_alert_state to service_role;

create index if not exists api_usage_alert_state_updated_at_idx
  on public.api_usage_alert_state (updated_at desc);
