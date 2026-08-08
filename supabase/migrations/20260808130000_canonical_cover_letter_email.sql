-- Phase 6I.6.6 - Cover Letter / Email Draft restoration for canonical
-- Generate Package. Canonical's single tailoring AI call is extended
-- (same pattern as 20260808120000's packageAnalysis addition) to also
-- return coverLetterText/emailDraftText, reusing the EXISTING
-- applications.cover_letter_text/email_draft columns legacy already
-- writes - no new schema.
--
-- Two RPCs need widening:
-- 1. claim_canonical_generate_worker - the worker needs company/job_title
--    (already columns on applications, just never returned by this claim
--    RPC before) to build the cover-letter/email prompt inputs, mirroring
--    legacy's own buildCoverLetterEmailPrompt({title, company, ...}).
-- 2. complete_canonical_generate_worker - needs two new optional text
--    params to write cover_letter_text/email_draft in the SAME atomic
--    completion transaction that already writes ai_insight.
--
-- Same drop-then-recreate pattern as 20260808120000 (Postgres treats a
-- differing-arity/return-shape signature as a distinct overload, not a
-- replacement) - both RPCs have exactly one call site
-- (canonicalGenerationWorker.ts), so widening is safe; every other
-- caller of either RPC (the phase6iProductionEnablement/phase6i65 real-DB
-- test suites) already omits the new optional args and gets the
-- unchanged legacy behavior.

drop function if exists public.claim_canonical_generate_worker(uuid);

create or replace function public.claim_canonical_generate_worker(
  p_application_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  generation_request_id uuid,
  canonical_input_manifest jsonb,
  resume_source text,
  resume_id uuid,
  resume_template_id text,
  generation_input_resume_text text,
  generation_input_resume_name text,
  generation_input_manifest_source jsonb,
  generation_input_cover_letter_text text,
  company text,
  job_title text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.applications
    set generation_worker_claimed_at = now(),
        generation_stage = 'claimed',
        generation_stage_updated_at = now()
    where public.applications.id = p_application_id
      and public.applications.generation_status = 'pending'
      and public.applications.generation_worker_claimed_at is null
      and public.applications.generation_engine = 'canonical'
    returning
      public.applications.id,
      public.applications.user_id,
      public.applications.generation_request_id,
      public.applications.canonical_input_manifest,
      public.applications.resume_source,
      public.applications.resume_id,
      public.applications.resume_template_id,
      public.applications.generation_input_resume_text,
      public.applications.generation_input_resume_name,
      public.applications.generation_input_manifest_source,
      public.applications.generation_input_cover_letter_text,
      public.applications.company,
      public.applications.job_title;
end;
$$;

comment on function public.claim_canonical_generate_worker(uuid) is
  'Atomic canonical worker claim - mirrors claim_generate_package_worker''s own UPDATE...WHERE...RETURNING pattern (0 rows affected on a retried/duplicate invocation is the intended concurrency-safety mechanism, not an error) but scoped to generation_engine=''canonical'' rows. Phase 6I.6.6 - also returns company/job_title so the canonical tailoring call can build cover-letter/email prompt inputs without a second query.';

revoke all on function public.claim_canonical_generate_worker(uuid) from public, anon, authenticated;
grant execute on function public.claim_canonical_generate_worker(uuid) to service_role;

-- ============================================================
-- complete_canonical_generate_worker - widen with two new optional
-- text params, written only on success and only when supplied
-- (coalesce, matching p_ai_insight's own existing behavior).
-- ============================================================
drop function if exists public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb);

create or replace function public.complete_canonical_generate_worker(
  p_application_id uuid,
  p_user_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_summary text default null,
  p_ai_insight jsonb default null,
  p_cover_letter_text text default null,
  p_email_draft text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception using errcode = '22023', message = 'p_status must be succeeded or failed';
  end if;

  update public.applications
  set
    generation_status = p_status,
    generation_stage = case when p_status = 'succeeded' then 'saving' else generation_stage end,
    generation_stage_updated_at = now(),
    generation_completed_at = now(),
    generation_error_code = p_error_code,
    generation_error_summary = p_error_summary,
    status = case when p_status = 'succeeded' then 'package_generated' else status end,
    ai_insight = case when p_status = 'succeeded' and p_ai_insight is not null then p_ai_insight else ai_insight end,
    cover_letter_text = case when p_status = 'succeeded' and p_cover_letter_text is not null then p_cover_letter_text else cover_letter_text end,
    email_draft = case when p_status = 'succeeded' and p_email_draft is not null then p_email_draft else email_draft end,
    updated_at = now()
  where id = p_application_id and user_id = p_user_id;
end;
$$;

comment on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) is
  'Sets the generic generation_status/generation_completed_at/generation_error_*/status columns for a canonical (non-fallback) generation outcome, and optionally writes applications.ai_insight (Phase 6I.6.5) and applications.cover_letter_text/email_draft (Phase 6I.6.6 - the SAME columns legacy Generate Package already uses) in the same atomic transaction when p_status=succeeded and each value is supplied. Idempotent by construction; omitting any optional param never clears an already-written value.';

revoke all on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) to service_role;
