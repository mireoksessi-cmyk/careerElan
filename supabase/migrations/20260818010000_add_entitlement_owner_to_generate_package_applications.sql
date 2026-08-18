-- ============================================================
-- Stage 2A: entitlement-owner READ compatibility for Generate Package.
--
-- PURPOSE
--   Stage 1 (20260818000000) added the entitlement claim store and the
--   entitlement-aware quota wrappers, all dormant. Before anything may start
--   RESERVING under a founding entitlement owner, every completion path must
--   first be able to READ that owner. This migration adds the storage and the
--   read channel. It does NOT switch any writer.
--
-- THE SEMANTIC THIS ESTABLISHES
--   applications.entitlement_owner_id IS NULL
--     -> legacy reservation model: the reservation was genuinely made under
--        applications.user_id, so completion/release must use user_id.
--   applications.entitlement_owner_id IS NOT NULL
--     -> entitlement reservation model (future Stage 2B): the reservation was
--        made under the founding entitlement owner, so completion/release must
--        use that value.
--
--   Completion therefore resolves the owner as
--     coalesce(entitlement_owner_id, user_id)
--   which is correct in both eras. This is a COMPLETION-time fallback onto the
--   id a row was actually reserved with - it is NOT, and must never become, a
--   reservation-time fallback onto a fresh auth uuid. That fallback is the
--   exact bypass the entitlement design exists to prevent.
--
-- WHY A COLUMN RATHER THAN A WORKER PAYLOAD FIELD
--   runPackageGeneration(applicationId) takes only an application id and
--   recovers user_id / generation_request_id from this row via
--   claim_generate_package_worker. Putting the owner in the same row means the
--   async payload contract, that function's signature, and all four of its
--   callers stay untouched. It also gives a queryable rollout marker: NULL
--   is inspectable in the database, an absent payload field is not.
--
-- NOTHING IN STAGE 2A WRITES THIS COLUMN. It stays NULL for every row until
-- Stage 2B, so runtime behaviour after this migration is byte-for-byte what it
-- is today - every existing row reads back as legacy, which is exactly what it
-- is. That is what makes this deploy free to roll back.
-- ============================================================

-- ============================================================
-- 1. The column.
--
--    Nullable with no default and no backfill: NULL is not "missing data", it
--    is the meaningful legacy marker described above.
--
--    No foreign key to auth.users and no cascade, matching the quota tables
--    and the Stage 1 claim store. A cascade would destroy the owner at exactly
--    the moment an in-flight worker still needs it.
--
--    No index: the only read is by application id, already served by the
--    primary key through claim_generate_package_worker's own lookup.
-- ============================================================
alter table public.applications
  add column if not exists entitlement_owner_id uuid;

comment on column public.applications.entitlement_owner_id is
  'Founding entitlement owner that this generation''s quota reservation was made under. NULL means the legacy model, where the reservation belongs to user_id - completion resolves coalesce(entitlement_owner_id, user_id), which is correct for both eras. Written only by the reservation path from Stage 2B onward; never written by Stage 2A, never client-supplied, and never used for plan/subscription/admin-override lookup, which remain keyed to the current auth user.';

-- ============================================================
-- 2. Surface the owner to the worker.
--
--    claim_generate_package_worker is the ONLY way the worker can read this
--    row: service_role holds no direct table grant on public.applications
--    (see lib/generatePackage/generateCore.ts's own comment at the claim call
--    site), so a separate select is not available to it.
--
--    PostgreSQL cannot change a function's RETURNS TABLE shape via CREATE OR
--    REPLACE - it raises "cannot change return type of existing function" - so
--    adding a column requires DROP then CREATE. That is done here for this one
--    function only, with its exact input signature, language, SECURITY DEFINER,
--    search_path and privileges restored, and with the body otherwise copied
--    verbatim from the authoritative definition in
--    20260730030000_dpe_execution_wiring.sql. No historical migration is edited.
--
--    Returning the owner from the CLAIM itself, rather than from a second RPC,
--    is deliberate: the worker then receives the owner atomically with the
--    claim, so there is no window in which it holds a claim but failed to learn
--    who owns the reservation.
--
--    entitlement_owner_id is appended LAST so that the position of every
--    pre-existing column is unchanged.
--
--    Claim semantics are untouched: same eligibility predicate
--    (generation_status = 'pending' AND generation_worker_claimed_at IS NULL),
--    same single atomic UPDATE ... RETURNING, same exactly-once guarantee that
--    makes a retried worker invocation safe.
-- ============================================================
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
  dpe_layout_constraints jsonb,
  entitlement_owner_id uuid
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
      public.applications.dpe_layout_constraints,
      public.applications.entitlement_owner_id;
end;
$$;

revoke all on function public.claim_generate_package_worker(uuid) from public;
grant execute on function public.claim_generate_package_worker(uuid) to service_role;
