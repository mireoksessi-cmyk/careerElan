/*
  Fixed-window request-count buckets for guest/user rate limiting on
  /api/analyze-job and /api/analyze-job-url (Phase 1-C). Stores only a
  salted HMAC hash of the caller's identity (never the raw IP or user id)
  plus an aggregate count per (identity_hash, endpoint, window) - never a
  per-request log row, so this table stays small regardless of traffic.

  Nothing in this table is reachable by anon/authenticated: RLS is enabled
  with no policies (default-deny), no GRANTs are given on the table itself,
  and the only way to read or write it is through the two SECURITY DEFINER
  functions below, whose EXECUTE privilege is restricted to service_role.
  The application only ever calls these functions via the existing
  lib/supabaseAdmin.ts service-role client, from server-only code.

  Both functions use `set search_path = ''` (not `= public`) - with an
  empty search path, every reference to api_rate_limits must be (and is)
  schema-qualified as public.api_rate_limits, so a same-named object
  created in a schema earlier in some other search path can never get
  silently resolved instead. Built-ins used inside them (now(), floor(),
  extract(), to_timestamp(), make_interval()) still resolve correctly
  regardless, since pg_catalog is always implicitly searched no matter
  what search_path is set to.
*/

create table if not exists public.api_rate_limits (
  id bigint generated always as identity primary key,
  identity_hash text not null,
  endpoint text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists api_rate_limits_identity_endpoint_window_key
  on public.api_rate_limits (identity_hash, endpoint, window_started_at);

alter table public.api_rate_limits enable row level security;

revoke all on public.api_rate_limits from anon, authenticated;

/*
  Atomically claims one request against the caller's bucket for the
  current fixed window and returns the resulting count. The
  INSERT ... ON CONFLICT ... DO UPDATE is a single statement, so Postgres
  serializes concurrent callers on the same (identity_hash, endpoint,
  window_started_at) row instead of racing a separate SELECT-then-UPDATE -
  no lost updates, no duplicate rows, no unique_violation ever surfaces to
  the caller.
*/
create or replace function public.increment_rate_limit(
  p_identity_hash text,
  p_endpoint text,
  p_window_seconds integer
)
returns table (request_count integer, window_started_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  insert into public.api_rate_limits
    (identity_hash, endpoint, window_started_at, request_count, updated_at)
  values (
    p_identity_hash,
    p_endpoint,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1,
    now()
  )
  on conflict (identity_hash, endpoint, window_started_at)
  do update set
    request_count = public.api_rate_limits.request_count + 1,
    updated_at = now()
  returning public.api_rate_limits.request_count, public.api_rate_limits.window_started_at;
$$;

revoke all on function public.increment_rate_limit(text, text, integer) from public, anon, authenticated;
grant execute on function public.increment_rate_limit(text, text, integer) to service_role;

/*
  Manual cleanup for old buckets - not wired to a cron job in this phase.
  Safe to call repeatedly; only deletes windows that ended more than
  p_older_than_hours ago.
*/
create or replace function public.cleanup_old_rate_limit_buckets(
  p_older_than_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.api_rate_limits
  where window_started_at < now() - make_interval(hours => p_older_than_hours);

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke all on function public.cleanup_old_rate_limit_buckets(integer) from public, anon, authenticated;
grant execute on function public.cleanup_old_rate_limit_buckets(integer) to service_role;
