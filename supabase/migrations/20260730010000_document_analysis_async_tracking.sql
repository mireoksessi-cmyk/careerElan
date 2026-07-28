-- Adds async analysis tracking to resumes and cover_letters, mirroring the
-- applications table's generation_status/generation_stage pattern
-- (20260721000000-era migration) so Resume/Cover Letter text extraction +
-- OpenAI analysis can move off the synchronous request path (which was
-- being killed by Netlify's ~26s gateway timeout on real-world documents,
-- returning an HTML error page the client couldn't parse as JSON) onto the
-- same Netlify Background Function infrastructure already proven by
-- Generate Package.
--
-- Existing rows already have parsed_data/original_text populated by the old
-- synchronous flow, so they default to 'succeeded' - only newly-inserted
-- rows under the new async flow start at 'pending'. No backfill needed.

alter table public.resumes
  add column if not exists analysis_status text not null default 'succeeded',
  add column if not exists analysis_stage text,
  add column if not exists analysis_stage_updated_at timestamptz,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_worker_claimed_at timestamptz,
  add column if not exists analysis_error_code text,
  add column if not exists analysis_error_summary text;

alter table public.cover_letters
  add column if not exists analysis_status text not null default 'succeeded',
  add column if not exists analysis_stage text,
  add column if not exists analysis_stage_updated_at timestamptz,
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_worker_claimed_at timestamptz,
  add column if not exists analysis_error_code text,
  add column if not exists analysis_error_summary text;

alter table public.resumes
  add constraint resumes_analysis_status_check
  check (analysis_status in ('pending', 'processing', 'succeeded', 'failed'));

alter table public.cover_letters
  add constraint cover_letters_analysis_status_check
  check (analysis_status in ('pending', 'processing', 'succeeded', 'failed'));

-- The background workers (lib/documentAnalysis/resumeAnalysisCore.ts,
-- coverLetterAnalysisCore.ts) have no user session - they only receive a
-- resumeId/coverLetterId. Like public.applications (see
-- 20260726020000_generate_package_worker_rpc.sql's own comment),
-- public.resumes and public.cover_letters grant no SELECT/INSERT/UPDATE to
-- service_role directly, only to authenticated via RLS - confirmed via
-- information_schema.role_table_grants before writing this migration
-- (service_role has only TRUNCATE/REFERENCES/TRIGGER on both tables).
-- These SECURITY DEFINER functions are the workers' only path to these
-- rows, mirroring the exact same claim/stage/complete/fail shape already
-- proven for Generate Package.

create or replace function public.claim_resume_analysis_worker(
  p_resume_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  file_name text,
  storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.resumes
    set analysis_status = 'processing',
        analysis_worker_claimed_at = now(),
        analysis_started_at = coalesce(public.resumes.analysis_started_at, now())
    where public.resumes.id = p_resume_id
      and public.resumes.analysis_status = 'pending'
    returning
      public.resumes.id,
      public.resumes.user_id,
      public.resumes.file_name,
      public.resumes.storage_path;
end;
$$;

revoke all on function public.claim_resume_analysis_worker(uuid) from public;
grant execute on function public.claim_resume_analysis_worker(uuid) to service_role;

create or replace function public.update_resume_analysis_stage(
  p_resume_id uuid,
  p_user_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.resumes
  set analysis_stage = p_stage,
      analysis_stage_updated_at = now()
  where public.resumes.id = p_resume_id
    and public.resumes.user_id = p_user_id
    and public.resumes.analysis_status = 'processing';
end;
$$;

revoke all on function public.update_resume_analysis_stage(uuid, uuid, text) from public;
grant execute on function public.update_resume_analysis_stage(uuid, uuid, text) to service_role;

create or replace function public.complete_resume_analysis(
  p_resume_id uuid,
  p_user_id uuid,
  p_parsed_data jsonb,
  p_original_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.resumes
  set analysis_status = 'succeeded',
      analysis_stage = null,
      parsed_data = p_parsed_data,
      original_text = p_original_text,
      analysis_error_code = null,
      analysis_error_summary = null,
      updated_at = now()
  where public.resumes.id = p_resume_id
    and public.resumes.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_resume_analysis(uuid, uuid, jsonb, text) from public;
grant execute on function public.complete_resume_analysis(uuid, uuid, jsonb, text) to service_role;

create or replace function public.fail_resume_analysis(
  p_resume_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_error_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.resumes
  set analysis_status = 'failed',
      analysis_stage = null,
      analysis_error_code = p_error_code,
      analysis_error_summary = p_error_summary,
      updated_at = now()
  where public.resumes.id = p_resume_id
    and public.resumes.user_id = p_user_id;
end;
$$;

revoke all on function public.fail_resume_analysis(uuid, uuid, text, text) from public;
grant execute on function public.fail_resume_analysis(uuid, uuid, text, text) to service_role;

-- Identical shape, cover_letters.

create or replace function public.claim_cover_letter_analysis_worker(
  p_cover_letter_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  file_name text,
  storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.cover_letters
    set analysis_status = 'processing',
        analysis_worker_claimed_at = now(),
        analysis_started_at = coalesce(public.cover_letters.analysis_started_at, now())
    where public.cover_letters.id = p_cover_letter_id
      and public.cover_letters.analysis_status = 'pending'
    returning
      public.cover_letters.id,
      public.cover_letters.user_id,
      public.cover_letters.file_name,
      public.cover_letters.storage_path;
end;
$$;

revoke all on function public.claim_cover_letter_analysis_worker(uuid) from public;
grant execute on function public.claim_cover_letter_analysis_worker(uuid) to service_role;

create or replace function public.update_cover_letter_analysis_stage(
  p_cover_letter_id uuid,
  p_user_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cover_letters
  set analysis_stage = p_stage,
      analysis_stage_updated_at = now()
  where public.cover_letters.id = p_cover_letter_id
    and public.cover_letters.user_id = p_user_id
    and public.cover_letters.analysis_status = 'processing';
end;
$$;

revoke all on function public.update_cover_letter_analysis_stage(uuid, uuid, text) from public;
grant execute on function public.update_cover_letter_analysis_stage(uuid, uuid, text) to service_role;

create or replace function public.complete_cover_letter_analysis(
  p_cover_letter_id uuid,
  p_user_id uuid,
  p_parsed_data jsonb,
  p_original_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cover_letters
  set analysis_status = 'succeeded',
      analysis_stage = null,
      parsed_data = p_parsed_data,
      original_text = p_original_text,
      analysis_error_code = null,
      analysis_error_summary = null,
      updated_at = now()
  where public.cover_letters.id = p_cover_letter_id
    and public.cover_letters.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_cover_letter_analysis(uuid, uuid, jsonb, text) from public;
grant execute on function public.complete_cover_letter_analysis(uuid, uuid, jsonb, text) to service_role;

create or replace function public.fail_cover_letter_analysis(
  p_cover_letter_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_error_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cover_letters
  set analysis_status = 'failed',
      analysis_stage = null,
      analysis_error_code = p_error_code,
      analysis_error_summary = p_error_summary,
      updated_at = now()
  where public.cover_letters.id = p_cover_letter_id
    and public.cover_letters.user_id = p_user_id;
end;
$$;

revoke all on function public.fail_cover_letter_analysis(uuid, uuid, text, text) from public;
grant execute on function public.fail_cover_letter_analysis(uuid, uuid, text, text) to service_role;
