-- Document Preservation Engine (DPE) - Phase 1-4 roadmap-closure effort.
--
-- 1. Observability columns: whether DPE ran for a given generation
-- attempt and what it decided - the Validation Interface's real result,
-- persisted rather than silently discarded after the worker returns.
-- No DEFAULT (matches this project's established convention) - every
-- existing row, and every request DPE does not apply to, stays NULL.
alter table public.applications
  add column if not exists dpe_status text,
  add column if not exists dpe_reason text;

comment on column public.applications.dpe_status is
  'Real outcome of runDpePreservationForApplication() for this generation attempt - one of the Execution Engine''s own ExecutionStatus values, "not_applicable" (no original uploaded file to preserve), or "error". NULL means DPE was never invoked (should not happen once generateCore.ts''s wiring is live, but kept nullable for rows created before this migration).';
comment on column public.applications.dpe_reason is
  'Human-readable reason paired with dpe_status - never raw error text/stack traces (see runForApplication.ts''s own try/catch, which only ever passes error.message, never a stack).';

-- 2. claim_generate_package_worker must additionally return resume_id and
-- resume_template_id so the worker can resolve the original uploaded
-- file (resumes.storage_path, via resume_id) and the template to
-- real-measure against (resume_template_id) - both already existed as
-- applications columns, simply not yet part of this RPC's own output.
-- Postgres refuses `CREATE OR REPLACE FUNCTION` when a RETURNS TABLE
-- function's OUT-parameter list changes (confirmed via a real
-- `supabase db reset` in the prior DPE hardening pass) - drop first.
drop function if exists public.claim_generate_package_worker(uuid);

create or replace function public.claim_generate_package_worker(
  p_application_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  generation_request_id uuid,
  resume_source text,
  resume_id uuid,
  resume_template_id text,
  job_title text,
  company text,
  job_description text,
  job_analysis jsonb,
  generation_input_resume_text text,
  generation_input_resume_name text,
  generation_input_manifest_source jsonb,
  generation_input_cover_letter_text text,
  dpe_generation_mode text,
  dpe_layout_constraints jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.applications
    set generation_worker_claimed_at = now()
    where public.applications.id = p_application_id
      and public.applications.generation_status = 'pending'
      and public.applications.generation_worker_claimed_at is null
    returning
      public.applications.id,
      public.applications.user_id,
      public.applications.generation_request_id,
      public.applications.resume_source,
      public.applications.resume_id,
      public.applications.resume_template_id,
      public.applications.job_title,
      public.applications.company,
      public.applications.job_description,
      public.applications.job_analysis,
      public.applications.generation_input_resume_text,
      public.applications.generation_input_resume_name,
      public.applications.generation_input_manifest_source,
      public.applications.generation_input_cover_letter_text,
      public.applications.dpe_generation_mode,
      public.applications.dpe_layout_constraints;
end;
$$;

revoke all on function public.claim_generate_package_worker(uuid) from public;
grant execute on function public.claim_generate_package_worker(uuid) to service_role;

-- 3. complete_generate_package_generation must additionally accept and
-- store the real DPE outcome, set at the same point as every other
-- observability field on a successful generation.
create or replace function public.complete_generate_package_generation(
  p_application_id uuid,
  p_user_id uuid,
  p_resume_text text,
  p_cover_letter_text text,
  p_email_draft text,
  p_ai_insight jsonb,
  p_generation_model text,
  p_prompt_version text,
  p_dpe_status text default null,
  p_dpe_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
  set generation_status = 'succeeded',
      status = 'package_generated',
      resume_text = p_resume_text,
      cover_letter_text = p_cover_letter_text,
      email_draft = p_email_draft,
      ai_insight = p_ai_insight,
      generation_model = p_generation_model,
      prompt_version = p_prompt_version,
      dpe_status = p_dpe_status,
      dpe_reason = p_dpe_reason,
      generation_completed_at = now(),
      updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text, text, text) to service_role;
