/*
  Critical system alert email delivery - the state that stops one ongoing
  incident from mailing the operator on every scheduled run, and lets a
  genuinely new incident mail again without anybody resetting anything.

  Its own table rather than a reuse. api_usage_alert_state requires a
  threshold_percent above zero and means "usage crossed a fraction of a
  configured limit"; a stuck generation has no percentage and no limit.
  openai_budget_alert_state is keyed by year_month with one column per budget
  threshold. Bending either to fit would leave a column that lies about what
  the row means, which is worse than one more small table.

  One row per alert key, not per incident. The row is the alert's current
  delivery state, and the state machine is the incident identity:

    (no row)   -> first time this alert has ever gone critical
    CLAIMED    -> a sender owns it right now
    SENT       -> the operator has been told about the episode still running
    FAILED     -> delivery failed; eligible for a bounded retry
    RECOVERED  -> the alert stopped being critical, so the next critical
                  reading is a new episode and mails again

  Recovery is written by the same scheduled evaluation that sends. Nothing
  here needs a human to clear it, which matters because the person who would
  clear it is the person the email is trying to reach.
*/
create table if not exists public.system_alert_delivery_state (
  /*
    The canonical Admin alert key - repeated_worker_enqueue_failures,
    stuck_generation_severe and so on. Primary key, so two concurrent
    evaluations racing on the same alert are resolved by Postgres: exactly
    one insert wins and only that caller sends.
  */
  alert_key text primary key,
  state text not null check (state in ('CLAIMED', 'SENT', 'FAILED', 'RECOVERED')),
  /*
    When the current episode was first claimed. Reset on each new episode, so
    the email can say how long this incident has been running rather than
    when the alert was first ever seen.
  */
  incident_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts >= 0),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  /*
    Last time the evaluator observed this alert critical. Diagnostic only -
    the state column decides delivery.
  */
  last_critical_at timestamptz,
  recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.system_alert_delivery_state is
  'Critical system alert email delivery state, one row per canonical Admin
   alert key. Claimed before the email is sent so a retry or a concurrent
   evaluation cannot double-send; set to RECOVERED when the alert stops being
   critical, which re-arms it for the next genuine episode.';

alter table public.system_alert_delivery_state enable row level security;
revoke all on public.system_alert_delivery_state from anon, authenticated;
grant select, insert, update on public.system_alert_delivery_state to service_role;

create index if not exists system_alert_delivery_state_updated_at_idx
  on public.system_alert_delivery_state (updated_at desc);
