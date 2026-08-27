/*
  Admin API Cost API-B - records which deployment an OpenAI call came from.

  Deploy Previews inherit the production environment variables, so a preview
  build talks to this same database with the same keys. Exercising an AI
  feature on a preview therefore writes a usage row indistinguishable from
  real traffic - and until now there was nothing on the row to tell them
  apart. The console counted them as production spend, and the monthly
  budget alerts counted them toward thresholds meant to describe what
  customers are actually costing.

  Nullable on purpose, and deliberately not backfilled. The 122 rows that
  exist today were written before anything recorded provenance, and their
  origin is genuinely unknown: no timestamp, user or operation proves where
  they ran. Stamping them 'production' would be inventing the exact fact
  this column exists to establish. They stay NULL, which reads as "from
  before attribution" and is the only honest value available.

  The consequence is deliberate and worth stating plainly: production-only
  accounting starts empty and fills from the deployment of this change
  forward. That discontinuity is real, and preferable to a continuous number
  that quietly includes traffic nobody can vouch for.

  'unknown' is distinct from NULL. NULL means the row predates attribution;
  'unknown' means attribution ran and could not determine the context, which
  is a live condition worth being able to see.
*/

alter table public.openai_usage_events
  add column if not exists environment text;

alter table public.openai_usage_events
  add constraint openai_usage_events_environment_check
  check (
    environment is null
    or environment in ('production', 'deploy-preview', 'branch-deploy', 'development', 'unknown')
  );

comment on column public.openai_usage_events.environment is
  'API-B - deployment context the call ran in, decided server-side from the Netlify CONTEXT variable. NULL means the row predates attribution and its origin is unknown; it is never backfilled. Only ''production'' counts toward the admin console''s production totals and the monthly budget thresholds.';

/*
  Both queries that now filter on this - the admin console's period
  aggregation and the monthly budget spend sum - select by environment
  within a created_at range, which is exactly this index. Added because
  those two reads are the reason the column exists, not on speculation.
*/
create index if not exists openai_usage_events_environment_created_idx
  on public.openai_usage_events (environment, created_at desc);
