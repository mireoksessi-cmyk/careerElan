-- The background worker (lib/generatePackage/generateCore.ts) has no user
-- session to build an RLS-scoped client from - it only receives an
-- applicationId. It must use the service-role client, but public.applications
-- (like every other application table in this project - see
-- generate_package_usage's own "zero direct GRANTs, RPC-only" convention)
-- grants no SELECT/INSERT/UPDATE/DELETE to service_role directly, only to
-- authenticated (enforced via its auth.uid() = user_id RLS policies).
-- service_role itself has BYPASSRLS, but that bypasses row-level security
-- policies only - it does not substitute for the table-level GRANT Postgres
-- separately requires, so a direct supabaseAdmin.from("applications") call
-- fails with "permission denied for table applications" regardless of RLS.
--
-- These three SECURITY DEFINER functions are the worker's only path to the
-- applications row, matching this project's established RPC-only access
-- pattern for service_role rather than widening it with a blanket GRANT:
-- each does exactly the one operation the worker needs, nothing else.

-- Atomic worker claim: the same UPDATE ... WHERE generation_status='pending'
-- AND generation_worker_claimed_at IS NULL RETURNING * the worker used to
-- run directly. A second/retried invocation for the same applicationId
-- affects 0 rows and gets an empty result set back, unchanged in meaning
-- from before this function existed.
create or replace function public.claim_generate_package_worker(
  p_application_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  generation_request_id uuid,
  resume_source text,
  job_title text,
  company text,
  job_description text,
  job_analysis jsonb,
  generation_input_resume_text text,
  generation_input_resume_name text,
  generation_input_manifest_source jsonb,
  generation_input_cover_letter_text text
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
      public.applications.job_title,
      public.applications.company,
      public.applications.job_description,
      public.applications.job_analysis,
      public.applications.generation_input_resume_text,
      public.applications.generation_input_resume_name,
      public.applications.generation_input_manifest_source,
      public.applications.generation_input_cover_letter_text;
end;
$$;

revoke all on function public.claim_generate_package_worker(uuid) from public;
grant execute on function public.claim_generate_package_worker(uuid) to service_role;

-- Success write: mirrors exactly what the old synchronous route wrote on
-- success (generation_status, status, the three output documents,
-- ai_insight, generation_model, prompt_version, generation_completed_at).
-- Scoped to (id, user_id) even though this is SECURITY DEFINER, matching
-- this codebase's established defense-in-depth convention of never trusting
-- id alone.
create or replace function public.complete_generate_package_generation(
  p_application_id uuid,
  p_user_id uuid,
  p_resume_text text,
  p_cover_letter_text text,
  p_email_draft text,
  p_ai_insight jsonb,
  p_generation_model text,
  p_prompt_version text
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
      generation_completed_at = now(),
      updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text) from public;
grant execute on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text) to service_role;

-- Failure write: mirrors the old synchronous route's catch-block update.
-- error_code/error_summary are always caller-supplied from the fixed,
-- PII-safe classifyGenerationError() dictionary in lib/generatePackage/
-- shared.ts - this function stores whatever text it's given, the same as
-- a direct table UPDATE would, and does not itself constrain the values.
create or replace function public.fail_generate_package_generation(
  p_application_id uuid,
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
  update public.applications
  set generation_status = 'failed',
      generation_error_code = p_error_code,
      generation_error_summary = p_error_summary,
      generation_completed_at = now(),
      updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = p_user_id;
end;
$$;

revoke all on function public.fail_generate_package_generation(uuid, uuid, text, text) from public;
grant execute on function public.fail_generate_package_generation(uuid, uuid, text, text) to service_role;
