-- Phase 6I.6.16 - Generate Package Resume Selection Snapshot / Race Elimination.
--
-- Audit finding: the canonical background worker (generateCanonicalPackage(),
-- always invoked with the service-role client) resolves CONTENT via
-- resolveCanonicalResumeContext({mode:"service-role", userId}) with no
-- applicationId - it always re-reads career_memory.selected_resume_id at
-- generation time, even though applications.canonical_profile_id /
-- applications.canonical_resume_version_id already exist as columns
-- (added by 20260807000000) and the SESSION-mode resolver already has an
-- "application-binding" branch that prefers them permanently once set
-- (resolveCanonicalResumeContext.ts's own resolveSessionMode(), Branch A).
-- If the user switches their selected resume between Generate Package
-- click and worker execution, the application can silently generate from
-- a DIFFERENT resume than the one selected at click time.
--
-- The fix threads the SAME application-binding priority into service-role
-- mode too. Session mode can already read applications.canonical_resume_
-- version_id directly (service_role has an ordinary table grant on
-- `applications` - confirmed via existing supabaseAdmin.from("applications")
-- call sites, e.g. app/api/internal/canonical-generate-package/status/
-- route.ts), so the missing piece is not a new column - the application row
-- already has everywhere it needs to freeze the tuple - but a service-role-
-- safe way to load the FULL career_resume_versions row for an explicit
-- version id, since career_resume_versions has no service_role SELECT grant
-- (same restriction 20260808065057's own header comment documents for
-- career_memory/resumes/career_source_documents/career_resume_versions).
--
-- system_resolve_resume_version_by_id(p_user_id, p_version_id) mirrors
-- system_resolve_resume_version_by_hash() exactly (same migration's sibling
-- RPC) - SECURITY DEFINER, explicit ownership check via the version's own
-- profile.user_id (never trusts the id alone), returns the full row so the
-- existing careerResumeVersionRowToRuntime() mapper can build a runtime
-- without a second round-trip. Returns null fields (not an error) when the
-- version does not exist or is not owned by this user - the caller
-- (resolveCanonicalResumeContext.ts) treats that as "no application binding
-- available", falling through to the pre-existing selected-resume
-- resolution exactly as it does today for any application created before
-- this phase (whose canonical_resume_version_id is still null at claim
-- time) - no backfill, no rebinding of historical applications.
create or replace function public.system_resolve_resume_version_by_id(
  p_user_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_version public.career_resume_versions%rowtype;
  v_profile public.career_profiles%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_version_id is null then
    return jsonb_build_object('profileId', null, 'sourceDocumentId', null, 'versionId', null, 'version', null);
  end if;

  select * into v_version from public.career_resume_versions where id = p_version_id;
  if not found then
    return jsonb_build_object('profileId', null, 'sourceDocumentId', null, 'versionId', null, 'version', null);
  end if;

  select * into v_profile from public.career_profiles where id = v_version.profile_id and user_id = p_user_id;
  if not found then
    -- Exists, but not owned by this user - never returned, matching every
    -- other service-role RPC's explicit ownership boundary in this file.
    return jsonb_build_object('profileId', null, 'sourceDocumentId', null, 'versionId', null, 'version', null);
  end if;

  return jsonb_build_object(
    'profileId', v_profile.id,
    'sourceDocumentId', v_version.source_document_id,
    'versionId', v_version.id,
    'version', to_jsonb(v_version)
  );
end;
$$;

revoke all on function public.system_resolve_resume_version_by_id(uuid, uuid) from public;
grant execute on function public.system_resolve_resume_version_by_id(uuid, uuid) to service_role;
