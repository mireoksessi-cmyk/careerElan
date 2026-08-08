-- ============================================================
-- Phase 6I.6.5 - Canonical Package Analysis Parity
--
-- Widens complete_canonical_generate_worker() with one new optional
-- parameter (p_ai_insight jsonb, default null) so the SAME atomic
-- completion transaction that marks a canonical generation succeeded
-- can also write applications.ai_insight - the EXISTING column legacy
-- Generate Package already uses for its packageAnalysis payload (see
-- lib/generatePackage/generateCore.ts's own complete_generate_package_
-- generation call). No new table, no new column - reuses ai_insight's
-- existing, untyped jsonb semantics.
--
-- Adding a parameter changes the function's signature (Postgres
-- overload identity is arg-type-based), so `create or replace` alone
-- would create a second, ambiguous 6-arg overload alongside the old
-- 5-arg one rather than replacing it - every existing named-arg call
-- site (canonicalGenerationWorker.ts, phase6iProductionEnablement.
-- realdb.test.mts) calls this with only 3 required args, which the
-- default values on BOTH overloads would satisfy, making Postgres
-- reject the call as "not unique". The old 5-arg signature is
-- therefore dropped first, then the 6-arg version is created in its
-- place - this is additive to every existing call site's own contract
-- (an omitted p_ai_insight defaults to null, and the UPDATE below only
-- ever writes ai_insight when p_ai_insight is actually supplied and
-- the status is succeeded, via coalesce - a caller that never passes
-- it, including every existing legacy-fallback call path, behaves
-- byte-for-byte as before).
-- ============================================================
drop function if exists public.complete_canonical_generate_worker(uuid, uuid, text, text, text);

create or replace function public.complete_canonical_generate_worker(
  p_application_id uuid,
  p_user_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_summary text default null,
  p_ai_insight jsonb default null
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
    updated_at = now()
  where id = p_application_id and user_id = p_user_id;
end;
$$;

comment on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb) is
  'Sets the generic generation_status/generation_completed_at/generation_error_*/status columns for a canonical (non-fallback) generation outcome, and - Phase 6I.6.5 - optionally writes applications.ai_insight (the same PackageAnalysis-shaped jsonb column legacy Generate Package already uses) in the same atomic transaction when p_status=succeeded and p_ai_insight is supplied. Idempotent by construction (a repeat call with the same status is a no-op overwrite, not a state transition); omitting p_ai_insight never clears an already-written value.';

revoke all on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_canonical_generate_worker(uuid, uuid, text, text, text, jsonb) to service_role;
