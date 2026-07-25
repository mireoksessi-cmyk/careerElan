/*
  Closes the last real re-billing path in the Recommended Jobs / Analytics
  caches: 20260725181700_ai_cache_durable_recovery.sql's route.ts callers
  reacted to a final save_*_result failure (OpenAI already succeeded, but
  the durable-save write itself failed after 3 retries) by calling
  fail_*_cache - which put the row in the SAME 'failed' status used for a
  genuine pre-generation/OpenAI-call failure. Since claim_*_cache
  legitimately reclaims 'failed' for a normal retry, a completely
  ordinary next request for that same cache key would silently re-call
  OpenAI for content that already succeeded once (verified locally: a
  second claim after this exact sequence returns claimed=true with no
  operator action at all).

  Fix: a fifth, distinct terminal status - 'storage_failed' - for exactly
  "OpenAI succeeded, but we could not confirm the result was saved
  anywhere durable." It is never auto-reclaimed by any normal request,
  ever, regardless of elapsed time; only an explicit operator action
  (recover_storage_failed_*, service_role only, never called from
  application code) can move a row out of it. 'failed' keeps its
  original, narrower meaning: no successful OpenAI result exists yet, so
  a normal retry can never waste a previously-successful generation.

  Final status set: generating -> completed | recovery_pending | failed |
  storage_failed. recovery_pending and completed are unchanged from the
  previous migration.
*/

alter table public.recommended_job_cache
  drop constraint recommended_job_cache_status_check;

alter table public.recommended_job_cache
  add constraint recommended_job_cache_status_check
  check (status in ('generating', 'recovery_pending', 'completed', 'failed', 'storage_failed'));

alter table public.analytics_cache
  drop constraint analytics_cache_status_check;

alter table public.analytics_cache
  add constraint analytics_cache_status_check
  check (status is null or status in ('generating', 'recovery_pending', 'completed', 'failed', 'storage_failed'));

/* =========================================================
   RECOMMENDED JOBS
========================================================= */

create or replace function public.claim_recommended_job_cache(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text,
  p_stale_after_seconds integer default 90
)
returns table (
  claimed boolean,
  status text,
  result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_resume_id::text, 2)
  );

  select rjc.status, rjc.result
    into v_status, v_result
  from public.recommended_job_cache as rjc
  where rjc.user_id = p_user_id
    and rjc.resume_id = p_resume_id
    and rjc.resume_source = p_resume_source
    and rjc.resume_content_hash = p_resume_content_hash;

  if found then
    if v_status = 'completed' then
      return query select false, 'completed', v_result;
      return;
    end if;

    if v_status = 'recovery_pending' then
      update public.recommended_job_cache
        set status = 'completed', completed_at = now(), updated_at = now()
      where user_id = p_user_id
        and resume_id = p_resume_id
        and resume_source = p_resume_source
        and resume_content_hash = p_resume_content_hash;

      return query select false, 'completed', v_result;
      return;
    end if;

    if v_status = 'generating' then
      -- Never reclaimed by elapsed time alone.
      return query select false, 'generating', null::jsonb;
      return;
    end if;

    if v_status = 'storage_failed' then
      -- OpenAI already succeeded once for this exact content and the
      -- result could not be confirmed saved - never auto-reclaimed, at
      -- any age, by any normal request. Only an explicit operator action
      -- (recover_storage_failed_recommended_job_cache) can release this.
      return query select false, 'storage_failed', null::jsonb;
      return;
    end if;

    -- v_status = 'failed' - no successful OpenAI result exists for this
    -- key (pre-generation error, OpenAI call failure, or invalid/
    -- unparseable response) - the only status a normal request may
    -- reclaim.
    update public.recommended_job_cache
      set status = 'generating',
          result = null,
          error_code = null,
          created_at = now(),
          updated_at = now(),
          completed_at = null
    where user_id = p_user_id
      and resume_id = p_resume_id
      and resume_source = p_resume_source
      and resume_content_hash = p_resume_content_hash;

    return query select true, 'generating', null::jsonb;
    return;
  end if;

  insert into public.recommended_job_cache (
    user_id, resume_id, resume_source, resume_content_hash, status
  ) values (
    p_user_id, p_resume_id, p_resume_source, p_resume_content_hash, 'generating'
  );

  return query select true, 'generating', null::jsonb;
end;
$$;

revoke all on function public.claim_recommended_job_cache(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_recommended_job_cache(uuid, uuid, text, text, integer) to service_role;

/*
  Locks a row into 'storage_failed' - used ONLY when OpenAI has already
  returned a successful result but save_recommended_job_result could not
  durably persist it after retrying. Matches any status other than the
  two "already has a good result" states (completed/recovery_pending),
  which this function must never overwrite - covers the normal case
  ('generating'), and defensively covers an unexpected 'failed' (or an
  already-'storage_failed') row found at that point too, so this exact
  request's response is never a false "succeeded" while any doubt
  remains about whether the result is durable anywhere.
*/
create or replace function public.mark_recommended_job_cache_storage_failed(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text,
  p_error_code text default 'CACHE_STORAGE_FAILED'
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.recommended_job_cache
    set status = 'storage_failed',
        error_code = p_error_code,
        updated_at = now()
  where user_id = p_user_id
    and resume_id = p_resume_id
    and resume_source = p_resume_source
    and resume_content_hash = p_resume_content_hash
    and status not in ('completed', 'recovery_pending');
$$;

revoke all on function public.mark_recommended_job_cache_storage_failed(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mark_recommended_job_cache_storage_failed(uuid, uuid, text, text, text) to service_role;

/*
  MANUAL OPERATOR USE ONLY. Never called from any application code path -
  intended to be run by hand (SQL console / ops tooling) by a human who
  has confirmed it is safe to either allow a fresh OpenAI retry
  (p_action = 'reset_to_failed') or discard the row entirely
  (p_action = 'delete', the next request then starts as a brand new
  cache entry). Only ever touches a row that is currently
  'storage_failed' - a no-op (returns false) against any other status,
  so it can never be misused to bypass 'generating'/'failed' semantics.
*/
create or replace function public.recover_storage_failed_recommended_job_cache(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected integer;
begin
  if p_action = 'reset_to_failed' then
    update public.recommended_job_cache
      set status = 'failed',
          error_code = 'OPERATOR_RESET',
          completed_at = now(),
          updated_at = now()
    where user_id = p_user_id
      and resume_id = p_resume_id
      and resume_source = p_resume_source
      and resume_content_hash = p_resume_content_hash
      and status = 'storage_failed';

    get diagnostics v_affected = row_count;
    return v_affected > 0;
  elsif p_action = 'delete' then
    delete from public.recommended_job_cache
    where user_id = p_user_id
      and resume_id = p_resume_id
      and resume_source = p_resume_source
      and resume_content_hash = p_resume_content_hash
      and status = 'storage_failed';

    get diagnostics v_affected = row_count;
    return v_affected > 0;
  else
    raise exception 'recover_storage_failed_recommended_job_cache: invalid p_action %, expected reset_to_failed or delete', p_action;
  end if;
end;
$$;

revoke all on function public.recover_storage_failed_recommended_job_cache(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.recover_storage_failed_recommended_job_cache(uuid, uuid, text, text, text) to service_role;

/* =========================================================
   ANALYTICS
========================================================= */

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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 3));

  select ac.input_hash, ac.status, ac.summary
    into v_input_hash, v_status, v_summary
  from public.analytics_cache as ac
  where ac.user_id = p_user_id;

  if found then
    if v_input_hash = p_input_hash and v_status = 'completed' then
      return query select false, 'completed', v_summary;
      return;
    end if;

    if v_input_hash = p_input_hash and v_status = 'recovery_pending' then
      update public.analytics_cache
        set status = 'completed', completed_at = now(), updated_at = now()
      where user_id = p_user_id;

      return query select false, 'completed', v_summary;
      return;
    end if;

    if v_input_hash = p_input_hash and v_status = 'generating' then
      -- Never reclaimed by elapsed time alone.
      return query select false, 'generating', null::text;
      return;
    end if;

    if v_input_hash = p_input_hash and v_status = 'storage_failed' then
      -- Never auto-reclaimed, at any age, by any normal request - see
      -- claim_recommended_job_cache's identical rule.
      return query select false, 'storage_failed', null::text;
      return;
    end if;

    -- Same hash but 'failed' -> reclaim and retry.
    -- Different hash (any prior status) -> the underlying applications
    -- data actually changed; always reclaim for a fresh analysis. This
    -- intentionally also covers a different hash arriving while the
    -- stored row is 'storage_failed' for stale data - the caller's
    -- current data no longer matches what's locked, so a fresh attempt
    -- for the NEW hash is legitimate and does not touch the old result.
    update public.analytics_cache
      set input_hash = p_input_hash,
          status = 'generating',
          summary = null,
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

create or replace function public.mark_analytics_cache_storage_failed(
  p_user_id uuid,
  p_input_hash text,
  p_error_code text default 'CACHE_STORAGE_FAILED'
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analytics_cache
    set status = 'storage_failed',
        error_code = p_error_code,
        updated_at = now()
  where user_id = p_user_id
    and input_hash = p_input_hash
    and status not in ('completed', 'recovery_pending');
$$;

revoke all on function public.mark_analytics_cache_storage_failed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_analytics_cache_storage_failed(uuid, text, text) to service_role;

/*
  MANUAL OPERATOR USE ONLY. Never called from any application code path -
  see recover_storage_failed_recommended_job_cache's identical doc
  comment for the intended usage and safety guarantees.
*/
create or replace function public.recover_storage_failed_analytics_cache(
  p_user_id uuid,
  p_input_hash text,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected integer;
begin
  if p_action = 'reset_to_failed' then
    update public.analytics_cache
      set status = 'failed',
          error_code = 'OPERATOR_RESET',
          completed_at = now(),
          updated_at = now()
    where user_id = p_user_id
      and input_hash = p_input_hash
      and status = 'storage_failed';

    get diagnostics v_affected = row_count;
    return v_affected > 0;
  elsif p_action = 'delete' then
    delete from public.analytics_cache
    where user_id = p_user_id
      and input_hash = p_input_hash
      and status = 'storage_failed';

    get diagnostics v_affected = row_count;
    return v_affected > 0;
  else
    raise exception 'recover_storage_failed_analytics_cache: invalid p_action %, expected reset_to_failed or delete', p_action;
  end if;
end;
$$;

revoke all on function public.recover_storage_failed_analytics_cache(uuid, text, text) from public, anon, authenticated;
grant execute on function public.recover_storage_failed_analytics_cache(uuid, text, text) to service_role;
