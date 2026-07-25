/*
  Hardens the Recommended Jobs / Analytics caches
  (20260725174500_recommended_job_cache.sql,
  20260725174600_analytics_cache_hash_status.sql) against two real gaps:

  1. Purely time-based reclaim of a 'generating' row let a second request
     steal ownership from a still-genuinely-running first request once
     p_stale_after_seconds elapsed, allowing two OpenAI calls for the
     same cache key. Fix: automatic reclaim of 'generating' is removed
     entirely. A 'generating' row is only ever left by an explicit
     failure (-> 'failed', reclaimable normally) or genuine completion.
     A truly orphaned 'generating' row (the process died before it could
     reach either of those) is left exactly as-is for a human/ops
     process to inspect and release via the new reclaim_orphaned_*
     functions below - never auto-reclaimed by a normal request.

  2. If the OpenAI call succeeded but the single combined "save result +
     mark completed" write then failed after retries, nothing durable
     existed anywhere - a later request would find 'generating' with no
     result and (under the old time-based reclaim) eventually re-call
     OpenAI for the exact same content. Fix: saving the raw result and
     marking the row fully 'completed' are now two separate steps, with
     a new 'recovery_pending' status in between. The moment OpenAI
     returns, the raw result is written durably first (status flips to
     'recovery_pending') - only *after* that succeeds does anything else
     happen. A subsequent claim call for the same key that finds
     'recovery_pending' serves the already-stored result immediately
     (opportunistically flipping it to 'completed' in the same
     statement) without ever calling OpenAI again - even across a full
     server restart, since this lives in the database, not memory.

  New status set: generating -> recovery_pending -> completed, or
  generating -> failed. 'recovery_pending' behaves like a cache hit for
  every read path (it already holds a valid, complete result) - it is
  purely a bookkeeping distinction for "result saved, formal completion
  not yet confirmed."
*/

alter table public.recommended_job_cache
  drop constraint recommended_job_cache_status_check;

alter table public.recommended_job_cache
  add constraint recommended_job_cache_status_check
  check (status in ('generating', 'recovery_pending', 'completed', 'failed'));

alter table public.analytics_cache
  drop constraint analytics_cache_status_check;

alter table public.analytics_cache
  add constraint analytics_cache_status_check
  check (status is null or status in ('generating', 'recovery_pending', 'completed', 'failed'));

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
      -- Result already durably saved by a prior attempt that never
      -- confirmed the final status flip (crash, lost response, etc.) -
      -- serve it now and opportunistically finalize. No OpenAI call.
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
      -- Never reclaimed by elapsed time alone - a genuinely still-running
      -- request keeps ownership indefinitely. See migration header for
      -- the orphan-recovery policy.
      return query select false, 'generating', null::jsonb;
      return;
    end if;

    -- v_status = 'failed' - the only status a normal request may reclaim.
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
  Durably saves the raw OpenAI result the moment it's available - the
  single most important write in this whole feature, since everything
  else can be recovered once this has succeeded. Only affects a row
  still in 'generating' (never overwrites an already-saved result).
*/
create or replace function public.save_recommended_job_result(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.recommended_job_cache
    set status = 'recovery_pending',
        result = p_result,
        updated_at = now()
  where user_id = p_user_id
    and resume_id = p_resume_id
    and resume_source = p_resume_source
    and resume_content_hash = p_resume_content_hash
    and status = 'generating';
$$;

revoke all on function public.save_recommended_job_result(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_recommended_job_result(uuid, uuid, text, text, jsonb) to service_role;

/*
  Trivial, low-risk status-only flip once the result is already durably
  saved. Safe to call best-effort (not retried aggressively) - if it
  never runs, the next claim_recommended_job_cache() call for this key
  finalizes it opportunistically instead, with identical results.
*/
create or replace function public.finalize_recommended_job_cache(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.recommended_job_cache
    set status = 'completed', completed_at = now(), updated_at = now()
  where user_id = p_user_id
    and resume_id = p_resume_id
    and resume_source = p_resume_source
    and resume_content_hash = p_resume_content_hash
    and status = 'recovery_pending';
$$;

revoke all on function public.finalize_recommended_job_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finalize_recommended_job_cache(uuid, uuid, text, text) to service_role;

/*
  Manual/operational recovery only - never called from the request path.
  Releases 'generating' rows old enough to be confidently abandoned
  (default 24h, far beyond any real request lifetime) so a future
  request for that same key can start fresh. Intentionally not wired to
  any endpoint or cron in this change.
*/
create or replace function public.reclaim_orphaned_recommended_job_cache(
  p_older_than_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.recommended_job_cache
    set status = 'failed',
        error_code = 'ORPHANED_GENERATING',
        completed_at = now(),
        updated_at = now()
  where status = 'generating'
    and created_at < now() - make_interval(hours => p_older_than_hours);

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.reclaim_orphaned_recommended_job_cache(integer) from public, anon, authenticated;
grant execute on function public.reclaim_orphaned_recommended_job_cache(integer) to service_role;

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
      -- Never reclaimed by elapsed time alone - see migration header.
      return query select false, 'generating', null::text;
      return;
    end if;

    -- Same hash but 'failed' -> reclaim and retry.
    -- Different hash (any prior status, including a live 'generating'
    -- or 'recovery_pending' for stale data) -> the underlying
    -- applications data actually changed; always reclaim for a fresh
    -- analysis, since the in-flight/pending result (if any) no longer
    -- reflects the caller's current data anyway.
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

create or replace function public.save_analytics_result(
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
    set status = 'recovery_pending',
        summary = p_summary,
        updated_at = now()
  where user_id = p_user_id
    and input_hash = p_input_hash
    and status = 'generating';
$$;

revoke all on function public.save_analytics_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_analytics_result(uuid, text, text) to service_role;

create or replace function public.finalize_analytics_cache(
  p_user_id uuid,
  p_input_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.analytics_cache
    set status = 'completed', completed_at = now(), updated_at = now()
  where user_id = p_user_id
    and input_hash = p_input_hash
    and status = 'recovery_pending';
$$;

revoke all on function public.finalize_analytics_cache(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_analytics_cache(uuid, text) to service_role;

create or replace function public.reclaim_orphaned_analytics_cache(
  p_older_than_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.analytics_cache
    set status = 'failed',
        error_code = 'ORPHANED_GENERATING',
        completed_at = now(),
        updated_at = now()
  where status = 'generating'
    and started_at is not null
    and started_at < now() - make_interval(hours => p_older_than_hours);

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.reclaim_orphaned_analytics_cache(integer) from public, anon, authenticated;
grant execute on function public.reclaim_orphaned_analytics_cache(integer) to service_role;
