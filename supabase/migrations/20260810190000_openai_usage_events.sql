/*
  Phase 6I.6.38A - structural OpenAI call telemetry. One row per physical
  OpenAI API request attempt (not per logical operation - a call site
  with its own internal retry loop writes one row per attempt, with
  retry_count recording how many retries preceded that specific
  attempt). Never stores prompt, response, resume/job/cover-letter/
  email/Career Memory text, or a raw error object - only structural
  metadata (operation, model, status, timing, token counts, cost
  estimate, safe error classification).

  Locked down identically to admin_staff/admin_audit_log
  (20260810180000/180100_admin_*.sql): RLS enabled, ALL revoked from
  anon/authenticated, reachable only via the service-role client
  (lib/supabaseAdmin.ts). Written exclusively by
  lib/openai/telemetry.ts's withOpenAiTelemetry() wrapper, read
  exclusively by lib/admin/queries/apiCosts.ts through the existing
  Phase 6I.6.37 RBAC-gated admin routes.
*/

create table if not exists public.openai_usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  operation text not null check (operation in (
    'RESUME_ANALYSIS', 'COVER_LETTER_ANALYSIS', 'ANALYZE_JOB', 'ANALYZE_JOB_URL',
    'GENERATE_PACKAGE', 'RECOMMEND_JOBS', 'CAREER_INSIGHT', 'ANALYTICS_SUMMARY', 'OTHER'
  )),
  model text not null,
  status text not null check (status in ('success', 'error')),
  duration_ms integer not null,

  -- Normalized across responses.create (input_tokens/output_tokens) and
  -- chat.completions.create (prompt_tokens/completion_tokens) - NULL when
  -- the call failed before a usage object existed, never fabricated.
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,

  estimated_cost_usd numeric(12, 6),
  cost_classification text not null default 'ESTIMATED_COST'
    check (cost_classification in ('ESTIMATED_COST', 'EXACT_PROVIDER_DATA', 'UNKNOWN_PRICING')),

  -- 0 for a first attempt, N for the Nth retry of the same logical call.
  retry_count integer not null default 0,

  http_status_class text check (http_status_class in ('2xx', '429', '4xx', '5xx', 'timeout', 'network', 'unknown')),
  error_category text check (error_category in ('rate_limit', 'timeout', 'server_error', 'client_error', 'network_error', 'unknown')),

  request_id text,
  application_id uuid references public.applications(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null
);

comment on table public.openai_usage_events is
  'Phase 6I.6.38A - structural OpenAI call telemetry only. Never stores
   prompt, response, resume/job/cover-letter/email/Career Memory text, or
   raw error objects. Service-role access only.';

alter table public.openai_usage_events enable row level security;
revoke all on public.openai_usage_events from anon, authenticated;
grant select, insert on public.openai_usage_events to service_role;

create index if not exists openai_usage_events_created_at_idx on public.openai_usage_events (created_at desc);
create index if not exists openai_usage_events_operation_created_idx on public.openai_usage_events (operation, created_at desc);
create index if not exists openai_usage_events_status_created_idx on public.openai_usage_events (status, created_at desc);
