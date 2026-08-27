/*
  Admin API Cost API-C1 - usage accounting for the paid request-based APIs
  that are not OpenAI.

  Three services cost money per request and none of them was counted
  anywhere: JSearch through RapidAPI, Google Places autocomplete, and Resend.
  The console could show OpenAI to the dollar while the rest of the bill was
  invisible, which is a worse failure than an imprecise number - nobody can
  react to spend they cannot see.

  Provider-neutral on purpose. A table per vendor would mean a migration per
  vendor and an admin query per vendor; one shaped around "an external
  request happened" holds JSearch and Places now and Resend in C2 without
  touching the schema again. 'resend' is already in the allowed set for that
  reason.

  Usage is recorded exactly. Cost is not: nothing here proves which RapidAPI
  plan is subscribed or which Places SKU a request bills against, so
  estimated_cost_usd stays null and the classification says so rather than
  printing a confident $0. Counting requests correctly is the part that has
  to be right first; attaching prices to them is a later phase with real plan
  information, and a fabricated price would be harder to notice than a
  missing one.

  Nothing identifying is stored. No search terms, no city text, no request
  or response bodies, no URLs carrying user input, no keys, no headers. What
  a row says is: this provider was called, for this operation, in this
  deployment, and it succeeded or it did not.

  environment is NOT NULL here, unlike openai_usage_events. That column was
  added to a table with history whose origin could not be established; this
  table starts empty, so every row it will ever hold is attributable and
  there is no honest reason to allow a blank.
*/

create table if not exists public.external_api_usage_events (
  id bigint generated always as identity primary key,

  provider text not null
    check (provider in ('rapidapi_jsearch', 'google_places', 'resend')),

  operation text not null
    check (operation in ('JOB_SEARCH', 'PLACES_AUTOCOMPLETE', 'EMAIL_SEND')),

  status text not null check (status in ('success', 'error')),

  http_status_class text
    check (
      http_status_class is null
      or http_status_class in ('2xx', '4xx', '429', '5xx', 'timeout', 'network', 'unknown')
    ),

  /*
    Billable requests this row represents - one, because one row is written
    per actual upstream request. A single Career Élan action that fetches two
    JSearch pages writes two rows, since the provider was asked twice and
    will bill accordingly. A failed request still counts: it was still sent.
  */
  request_units integer not null default 1 check (request_units > 0),

  /*
    Null until a phase exists that knows the real plan and SKU pricing. The
    classification carries why, so a reader is never left to interpret a null
    as free.
  */
  estimated_cost_usd numeric(12, 6),

  cost_classification text not null
    check (
      cost_classification in
      ('LOCAL_USAGE_EXACT', 'LOCAL_COST_ESTIMATE', 'VENDOR_EXACT', 'NOT_AVAILABLE')
    ),

  /* Same five values API-B established for OpenAI, decided the same way. */
  environment text not null
    check (environment in ('production', 'deploy-preview', 'branch-deploy', 'development', 'unknown')),

  /*
    Only when the calling route already knows who is asking. The city
    autocomplete is unauthenticated, so its rows carry null rather than the
    route acquiring an identity it does not otherwise need.
  */
  user_id uuid references auth.users(id) on delete set null,

  duration_ms integer,
  retry_count integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.external_api_usage_events is
  'API-C1 - one row per upstream request to a paid non-OpenAI provider. Usage is exact; cost is null until real plan/SKU pricing is supplied. Holds no search terms, request/response bodies, URLs, keys or headers.';

comment on column public.external_api_usage_events.request_units is
  'Billable upstream requests this row represents. Always 1: one row per actual provider request, failures included.';

/* The shape every future admin read will use: one provider, one environment, over a period. */
create index if not exists external_api_usage_events_provider_env_created_idx
  on public.external_api_usage_events (provider, environment, created_at desc);

/*
  Service-role only, like openai_usage_events and the admin tables. A browser
  that could insert here could invent usage against another account, or bury
  real spend under noise - there is no version of this a client needs to
  write, and none it needs to read.
*/
alter table public.external_api_usage_events enable row level security;

revoke all on public.external_api_usage_events from anon, authenticated;

grant select, insert on public.external_api_usage_events to service_role;
