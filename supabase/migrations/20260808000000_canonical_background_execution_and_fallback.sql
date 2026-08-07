-- Phase 6I - Production Enablement. Adds the atomic worker-claim and
-- completion RPCs the canonical background execution path needs to
-- participate in the EXACT SAME generation_status/generation_stage/
-- generation_worker_claimed_at lifecycle contract app/api/generate-package/
-- route.ts, app/api/applications/[id]/status/route.ts, and Job Tracker
-- already use for legacy - those columns and their CHECK constraints
-- (applications_generation_status_check, applications_generation_stage_check,
-- applications_generation_engine_check, applications_fallback_reason_check)
-- were already added generically in earlier canonical migrations and need
-- no change here; this migration only adds the SECURITY DEFINER functions
-- a canonical worker needs to touch them (service_role has no direct
-- grant on public.applications - see complete_canonical_generation's own
-- migration header for why).
--
-- mark_canonical_fallback (20260807000000) already exists and is reused
-- unchanged by the new fallback-to-legacy path wired this phase - no
-- change needed to it.
--
-- Design note (why the fallback-to-legacy RPC below is so small): the
-- dispatch service (canonicalGenerateDispatchService.ts) resolves and
-- writes the SAME legacy input snapshot (resume_source, resume_id,
-- generation_input_*) app/api/generate-package/route.ts's own claim-
-- insert already writes, UNCONDITIONALLY, at claim time - before it is
-- known whether canonical will succeed or need to fall back. This means
-- a canonical row is ALWAYS already fallback-ready the moment it's
-- created; the fallback-to-legacy step at generation time only needs to
-- release the worker claim so legacy's own (unmodified)
-- claim_generate_package_worker/runPackageGeneration can pick the row up
-- - it never needs to WRITE the legacy snapshot itself.

-- ============================================================
-- 1. claim_canonical_generate_worker - atomic worker claim, same
--    UPDATE-WHERE-RETURNING shape as claim_generate_package_worker,
--    returning both canonical_input_manifest (the canonical-specific
--    generation parameters) and the legacy-equivalent snapshot columns
--    (needed only if a fallback-to-legacy turns out to be necessary -
--    see design note above).
-- ============================================================
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
  generation_input_cover_letter_text text
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
      public.applications.generation_input_cover_letter_text;
end;
$$;

comment on function public.claim_canonical_generate_worker(uuid) is
  'Atomic canonical worker claim - mirrors claim_generate_package_worker''s own UPDATE...WHERE...RETURNING pattern (0 rows affected on a retried/duplicate invocation is the intended concurrency-safety mechanism, not an error) but scoped to generation_engine=''canonical'' rows.';

revoke all on function public.claim_canonical_generate_worker(uuid) from public, anon, authenticated;
grant execute on function public.claim_canonical_generate_worker(uuid) to service_role;

-- ============================================================
-- 2. complete_canonical_generate_worker - sets the SAME generic
--    lifecycle columns legacy's own complete_generate_package_generation
--    sets (generation_status/generation_completed_at/generation_error_*/
--    updated_at), plus Job Tracker's own `status` field on success
--    (matching legacy's "package_generated" convention exactly, so a
--    canonical-completed application appears identically in Job Tracker
--    with no separate UI branch needed there). Does NOT touch
--    canonical_profile_id/tailored_resume_id/generated_pdf_document_id/etc
--    - those are already set by the existing, unmodified
--    complete_canonical_generation RPC, called by generateCanonicalPackage()
--    itself before this function runs.
-- ============================================================
create or replace function public.complete_canonical_generate_worker(
  p_application_id uuid,
  p_user_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_summary text default null
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
    updated_at = now()
  where id = p_application_id and user_id = p_user_id;
end;
$$;

comment on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text) is
  'Sets the generic generation_status/generation_completed_at/generation_error_*/status columns for a canonical (non-fallback) generation outcome - the same columns app/api/applications/[id]/status/route.ts and Job Tracker already read for legacy. Idempotent by construction (a repeat call with the same status is a no-op overwrite, not a state transition).';

revoke all on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text) to service_role;

-- ============================================================
-- 3. release_canonical_claim_for_legacy_fallback - the ENTIRE fallback-
--    to-legacy handoff, now that the legacy snapshot is always already
--    present (see this file's own design note above): releases
--    generation_worker_claimed_at so legacy's existing
--    claim_generate_package_worker can claim this exact row fresh, and
--    resets generation_status/generation_stage back to their pre-claim
--    values so that claim's own WHERE clause (generation_status='pending'
--    AND generation_worker_claimed_at IS NULL) matches. Deliberately
--    does NOT touch generation_engine/fallback_used/fallback_reason -
--    those are set separately by the existing mark_canonical_fallback
--    (20260807000000), called by the caller before this function.
-- ============================================================
create or replace function public.release_canonical_claim_for_legacy_fallback(
  p_application_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
  set
    generation_worker_claimed_at = null,
    generation_status = 'pending',
    generation_stage = 'queued',
    generation_stage_updated_at = now(),
    updated_at = now()
  where id = p_application_id and user_id = p_user_id;
end;
$$;

comment on function public.release_canonical_claim_for_legacy_fallback(uuid, uuid) is
  'Releases a canonical worker''s claim on an application row so legacy''s own, unmodified claim_generate_package_worker/runPackageGeneration can claim and complete it instead - the fallback-to-legacy mechanism. Safe to call even if the row was never actually claimed (idempotent UPDATE, matches 0 or 1 rows, never errors either way).';

revoke all on function public.release_canonical_claim_for_legacy_fallback(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_canonical_claim_for_legacy_fallback(uuid, uuid) to service_role;

-- ============================================================
-- 4. get_application_generation_status - single-purpose read-only
--    helper the canonical worker uses ONLY to observe the final
--    generation_status after handing a row off to legacy's own
--    runPackageGeneration() for a fallback attempt (Part F metrics:
--    "did the fallback actually succeed"), since
--    get_canonical_generation_status (20260807000000) intentionally
--    returns canonical-specific columns only, never the generic
--    lifecycle columns. Kept minimal and separate rather than widening
--    that existing, already-tested RPC's return shape.
-- ============================================================
create or replace function public.get_application_generation_status(
  p_application_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select generation_status from public.applications where id = p_application_id and user_id = p_user_id;
$$;

comment on function public.get_application_generation_status(uuid, uuid) is
  'Read-only: returns generation_status for an owned application row, or NULL if not found/not owned. Used by canonicalGenerationWorker.ts to observe a fallback-to-legacy attempt''s real outcome for metrics.';

revoke all on function public.get_application_generation_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_application_generation_status(uuid, uuid) to service_role;
