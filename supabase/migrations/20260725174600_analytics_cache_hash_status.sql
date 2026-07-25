/*
  Extends the existing public.analytics_cache (one row per user, already
  UNIQUE(user_id)) with content-hash-based invalidation and an explicit
  generating/completed/failed status, instead of the previous
  "always cache forever after the first successful call" behavior.

  analytics_input_hash is computed server-side (see
  lib/cache/contentHash.ts) from exactly the same aggregate values
  app/api/analytics-summary/route.ts's prompt actually uses (total/
  interviewRate/offerRate/applied job titles/matched skills/missing
  skills, derived from the caller's own public.applications rows) -
  never from a client-supplied hash or client-supplied copies of those
  numbers. Any real change to the underlying applications data (added,
  edited, or deleted application; status change; a Generate Package
  success that adds a new application) changes at least one of those
  aggregates and therefore the hash; page refreshes, re-logins, a
  different device, or unrelated UI state (sort/filter/pagination) do
  not.

  No backfill: existing rows keep input_hash/status NULL, which simply
  means "no hash on record yet" - the very next request for that user
  computes a hash, finds no match, and reclaims the row normally.
*/

alter table public.analytics_cache
  add column if not exists input_hash text,
  add column if not exists status text,
  add column if not exists error_code text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.analytics_cache
  add constraint analytics_cache_status_check
  check (status is null or status in ('generating', 'completed', 'failed'));

/*
  Atomically decides whether the caller must (re)generate the AI summary
  for p_input_hash, or whether a matching completed/in-progress row
  already exists.

  pg_advisory_xact_lock keyed on user_id alone is sufficient here (unlike
  Recommended Jobs) since this table already has exactly one row per
  user - there is only ever one thing to serialize per user, not one per
  resume. Transaction-scoped, always released at commit/rollback.

  p_stale_after_seconds guards a 'generating' row whose process died
  before calling complete/fail - like Recommended Jobs, this route is a
  single synchronous call with no separate long-running job/status table
  to cross-reference, so elapsed time is the only available signal;
  default is well above this route's real single-OpenAI-call latency.
*/
create or replace function public.claim_analytics_cache(
  p_user_id uuid,
  p_input_hash text,
  p_stale_after_seconds integer default 90
)
returns table (
  claimed boolean,
  status text,
  summary text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_hash text;
  v_status text;
  v_summary text;
  v_started_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 3));

  select ac.input_hash, ac.status, ac.summary, ac.started_at
    into v_input_hash, v_status, v_summary, v_started_at
  from public.analytics_cache as ac
  where ac.user_id = p_user_id;

  if found then
    if v_input_hash = p_input_hash and v_status = 'completed' then
      return query select false, 'completed', v_summary;
      return;
    end if;

    if v_input_hash = p_input_hash
       and v_status = 'generating'
       and v_started_at is not null
       and v_started_at > now() - make_interval(secs => p_stale_after_seconds)
    then
      return query select false, 'generating', null::text;
      return;
    end if;

    -- Same hash but 'failed' or stale 'generating' -> reclaim and retry.
    -- Different hash (any prior status) -> the underlying data actually
    -- changed, always reclaim for a fresh analysis.
    update public.analytics_cache
      set input_hash = p_input_hash,
          status = 'generating',
          error_code = null,
          started_at = now(),
          completed_at = null,
          updated_at = now()
    where user_id = p_user_id;

    return query select true, 'generating', null::text;
    return;
  end if;

  insert into public.analytics_cache (user_id, input_hash, status, started_at, updated_at)
  values (p_user_id, p_input_hash, 'generating', now(), now());

  return query select true, 'generating', null::text;
end;
$$;

revoke all on function public.claim_analytics_cache(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_analytics_cache(uuid, text, integer) to service_role;

create or replace function public.complete_analytics_cache(
  p_user_id uuid,
  p_input_hash text,
  p_summary text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analytics_cache
    set status = 'completed',
        summary = p_summary,
        error_code = null,
        completed_at = now(),
        updated_at = now()
  where user_id = p_user_id
    and input_hash = p_input_hash
    and status = 'generating';
$$;

revoke all on function public.complete_analytics_cache(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_analytics_cache(uuid, text, text) to service_role;

create or replace function public.fail_analytics_cache(
  p_user_id uuid,
  p_input_hash text,
  p_error_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analytics_cache
    set status = 'failed',
        error_code = p_error_code,
        completed_at = now(),
        updated_at = now()
  where user_id = p_user_id
    and input_hash = p_input_hash
    and status = 'generating';
$$;

revoke all on function public.fail_analytics_cache(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_analytics_cache(uuid, text, text) to service_role;
