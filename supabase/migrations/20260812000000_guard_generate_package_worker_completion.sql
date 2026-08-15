-- I3-1 hardening (Final Product Closure Audit) - Generate Package worker
-- completion race guard.
--
-- Problem: claim_generate_package_worker / claim_canonical_generate_worker
-- already gate their claim on generation_status='pending', but the three
-- corresponding completion/failure RPCs did not re-check that the target
-- row was still 'pending' at write time. If a user reloads a Paste Job tab
-- while a generation is still in flight, then immediately uses
-- "Apply with Saved Resume" -> Save Package on the same application row
-- (app/paste-job/page.tsx's savePackage() update branch, which sets
-- status='saved' and generation_status=null), the row leaves the
-- 'pending' state before the original worker's completion/failure write
-- arrives. That late write previously had no guard against this and would
-- silently overwrite the user's just-saved content, or stamp
-- generation_status='failed' over a row the user validly marked 'saved' -
-- making it disappear from Job Tracker's own
-- generation_status.is.null/eq.succeeded filter.
--
-- Fix: add `and generation_status = 'pending'` to each function's UPDATE
-- WHERE clause. A completion/failure call whose target row is no longer
-- pending now affects 0 rows instead of overwriting it - the same
-- concurrency-safety pattern already used by the claim RPCs' own
-- UPDATE ... WHERE generation_status='pending' ... RETURNING *.
--
-- No other change: function names, argument lists/types/order/defaults,
-- return types, LANGUAGE, SECURITY DEFINER, search_path, UPDATE SET
-- lists, status-value semantics, and grants/revokes are all unchanged
-- from their current live definitions. The claim RPCs
-- (claim_generate_package_worker, claim_canonical_generate_worker) are
-- not touched by this migration.

-- complete_generate_package_generation - live signature is the 10-arg
-- version from 20260730030000_dpe_execution_wiring.sql (the only one any
-- call site in this repo ever invokes - generateCore.ts calls it with all
-- 10 named args). Redefined here with the identical signature/body, only
-- the WHERE clause gains the pending guard.
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
    and public.applications.user_id = p_user_id
    and public.applications.generation_status = 'pending';
end;
$$;

revoke all on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.complete_generate_package_generation(uuid, uuid, text, text, text, jsonb, text, text, text, text) to service_role;

-- fail_generate_package_generation - single existing signature
-- (20260726020000_generate_package_worker_rpc.sql), never widened.
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
    and public.applications.user_id = p_user_id
    and public.applications.generation_status = 'pending';
end;
$$;

revoke all on function public.fail_generate_package_generation(uuid, uuid, text, text) from public;
grant execute on function public.fail_generate_package_generation(uuid, uuid, text, text) to service_role;

-- complete_canonical_generate_worker - live signature is the 8-arg
-- version from 20260808130000_canonical_cover_letter_email.sql (the
-- final result of that migration's own drop-then-recreate widening
-- chain; the two earlier 5-arg/6-arg signatures were already dropped by
-- prior migrations and are not recreated here).
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
  where id = p_application_id and user_id = p_user_id and generation_status = 'pending';
end;
$$;

comment on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) is
  'Sets the generic generation_status/generation_completed_at/generation_error_*/status columns for a canonical (non-fallback) generation outcome, and optionally writes applications.ai_insight (Phase 6I.6.5) and applications.cover_letter_text/email_draft (Phase 6I.6.6 - the SAME columns legacy Generate Package already uses) in the same atomic transaction when p_status=succeeded and each value is supplied. Idempotent by construction; omitting any optional param never clears an already-written value.';

revoke all on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb, text, text) to service_role;
