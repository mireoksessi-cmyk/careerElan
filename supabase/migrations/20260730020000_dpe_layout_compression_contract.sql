-- Document Preservation Engine (DPE) Phase 4B completion. Minimal, additive
-- extension to Generate Package's public contract to carry an optional
-- Layout Compression Request - per this phase's own explicit authorization
-- ("이번 Phase에서는 Generate Package에 최소한의 공식 공개 계약 확장을 허용한다").
-- Does NOT replace or bypass the existing prompt-construction pipeline,
-- SourceManifest, Protected Claims, Validation, Safety, or JSON Extraction -
-- see lib/generatePackage/generateCore.ts's own conditional use of these two
-- columns, appended as an ADDITIONAL instruction block only when
-- dpe_generation_mode = 'layout_compression', never replacing the existing
-- prompt.
--
-- No DEFAULT (matches this project's established convention) - every
-- existing row, and every request that doesn't opt in, stays NULL and
-- behaves exactly as before this migration.
alter table public.applications
  add column if not exists dpe_generation_mode text,
  add column if not exists dpe_layout_constraints jsonb;

alter table public.applications
  add constraint applications_dpe_generation_mode_check
  check (dpe_generation_mode is null or dpe_generation_mode in ('standard', 'layout_compression'));

comment on column public.applications.dpe_generation_mode is
  'Optional Generate Package mode requested by the Document Preservation Engine. NULL/"standard" behaves exactly as before this column existed - only "layout_compression" appends the additional layout-constraint instruction block in generateCore.ts.';
comment on column public.applications.dpe_layout_constraints is
  'Optional structured layout constraint data (targetPageCount/maxRenderedHeightBySection/maxBulletCountByExperience/overflowSections/sectionCharacterBudgets/preserveProtectedClaims) - interpreted ONLY by Generate Package''s own existing prompt builder (generateCore.ts), never assembled into a prompt string by the Document Preservation Engine itself.';

-- claim_generate_package_worker must return these two new columns so the
-- worker (lib/generatePackage/generateCore.ts) can read them - additive to
-- the existing RETURNS TABLE column list, every existing column unchanged.
-- Postgres refuses `CREATE OR REPLACE FUNCTION` when a RETURNS TABLE
-- function's OUT-parameter list changes ("cannot change return type of
-- existing function" / SQLSTATE 42P13, confirmed via a real
-- `supabase db reset` in this phase) - the old signature must be dropped
-- first. Safe here: the function is SECURITY DEFINER with no other
-- dependents (no view/trigger references it), so dropping and
-- immediately recreating leaves only the tiny window of this single
-- migration transaction without the function - the caller
-- (generateCore.ts's runPackageGeneration) is a Node worker, never a
-- concurrent SQL statement inside this same migration.
drop function if exists public.claim_generate_package_worker(uuid);

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
