/*
  Permanent, content-addressed cache for Recommended Jobs
  (app/api/recommend-jobs/route.ts). Keyed by
  (user_id, resume_id, resume_source, resume_content_hash) - resume_id is
  either a real public.resumes.id (resume_source = 'uploaded') or a real
  public.career_memory.id (resume_source = 'career_memory'; that table
  has exactly one row per user, so its own id stands in for "which
  resume" in that case). resume_content_hash is computed server-side
  (see lib/cache/contentHash.ts) from only the substantive profile/resume
  content actually sent to the model - never from styling/selection-state
  columns or timestamps, so re-saving the same content, renaming a file,
  or merely re-selecting the same resume never produces a new hash and
  never re-triggers a paid call.

  A distinct resume_content_hash for the same (user_id, resume_id,
  resume_source) is treated as an entirely new cache entry (not an update
  of the old one) - the old row is simply superseded and left in place,
  harmless, for audit/debugging purposes.

  status lifecycle: generating -> completed (permanent, reused forever)
  or generating -> failed (retryable; a later request with the same key
  reclaims and retries, never counted as a prior success).

  Same security convention as public.api_rate_limits and
  public.generate_package_usage: RLS enabled with zero policies
  (default-deny), no direct GRANTs, and the only access path is through
  SECURITY DEFINER functions restricted to service_role, called only
  from server code using an authenticated user.id the client can never
  override.
*/

create table if not exists public.recommended_job_cache (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  resume_id uuid not null,
  resume_source text not null check (resume_source in ('uploaded', 'career_memory')),
  resume_content_hash text not null,
  status text not null check (status in ('generating', 'completed', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists recommended_job_cache_key
  on public.recommended_job_cache (user_id, resume_id, resume_source, resume_content_hash);

create index if not exists recommended_job_cache_user_resume_idx
  on public.recommended_job_cache (user_id, resume_id, resume_source);

alter table public.recommended_job_cache enable row level security;

revoke all on public.recommended_job_cache from anon, authenticated;

/*
  Atomically decides whether the caller must (re)generate recommendations
  for this exact (user_id, resume_id, resume_source, resume_content_hash),
  or whether a result already exists / is already being generated.

  A pg_advisory_xact_lock keyed on (user_id, resume_id) - not user_id
  alone - serializes concurrent requests for the SAME resume while still
  letting requests for two different resumes of the same user proceed in
  parallel. Transaction-scoped, always released at commit/rollback.

  p_stale_after_seconds guards a 'generating' row whose process died
  before ever calling complete/fail - this feature has no separate
  long-running job/status table to cross-reference (unlike Generate
  Package's applications row), so elapsed time is the only available
  signal here; the default is chosen well above this route's real
  worst-case latency (one OpenAI call plus up to 6 parallel external
  job-search lookups).
*/
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
  v_created_at timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_resume_id::text, 2)
  );

  select rjc.status, rjc.result, rjc.created_at
    into v_status, v_result, v_created_at
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

    if v_status = 'generating' and v_created_at > now() - make_interval(secs => p_stale_after_seconds) then
      return query select false, 'generating', null::jsonb;
      return;
    end if;

    -- 'failed', or 'generating' but stale (abandoned) - reclaim and retry.
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

create or replace function public.complete_recommended_job_cache(
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
    set status = 'completed',
        result = p_result,
        error_code = null,
        completed_at = now(),
        updated_at = now()
  where user_id = p_user_id
    and resume_id = p_resume_id
    and resume_source = p_resume_source
    and resume_content_hash = p_resume_content_hash
    and status = 'generating';
$$;

revoke all on function public.complete_recommended_job_cache(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_recommended_job_cache(uuid, uuid, text, text, jsonb) to service_role;

create or replace function public.fail_recommended_job_cache(
  p_user_id uuid,
  p_resume_id uuid,
  p_resume_source text,
  p_resume_content_hash text,
  p_error_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.recommended_job_cache
    set status = 'failed',
        error_code = p_error_code,
        completed_at = now(),
        updated_at = now()
  where user_id = p_user_id
    and resume_id = p_resume_id
    and resume_source = p_resume_source
    and resume_content_hash = p_resume_content_hash
    and status = 'generating';
$$;

revoke all on function public.fail_recommended_job_cache(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fail_recommended_job_cache(uuid, uuid, text, text, text) to service_role;
