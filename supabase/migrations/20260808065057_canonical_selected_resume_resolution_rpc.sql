-- Phase 6I.6 - Selected Resume <-> Canonical Version Binding.
--
-- Audit finding: generateCanonicalPackage() (lib/careerMemory/orchestration/
-- canonicalGeneratePackageService.ts) and every caller of it
-- (app/api/internal/canonical-generate-package/generate/route.ts,
-- canonicalGenerationWorker.ts, canonicalShadowComparisonService.ts) is
-- ALWAYS invoked with the service-role client (supabaseAdmin) - none run
-- inside a real user session (same reason system_get_canonical_memory_bundle
-- exists, see 20260807000002's own header comment). That function resolves
-- "which resume version to generate from" via getCanonicalRuntimeViaServiceRole(),
-- which only ever returns the profile's globally-latest version - it has no
-- way to honor career_memory.selected_resume_id, because `career_memory` and
-- `resumes` have no service_role SELECT grant (confirmed via
-- information_schema.role_table_grants: only TRUNCATE/REFERENCES/TRIGGER),
-- and `career_source_documents`/`career_resume_versions` are the same
-- authenticated-only restriction already documented in
-- 20260807000002's own header comment.
--
-- Two new SECURITY DEFINER RPCs, following that exact same established
-- convention (explicit p_user_id ownership check, `revoke all from public`,
-- `grant execute to service_role` only - never callable by anon/authenticated,
-- so an ordinary signed-in user cannot use this to read another user's
-- selection or resume metadata):
--
-- 1. system_resolve_selected_resume(p_user_id) - reads career_memory's
--    selection columns and, only when the selection is an "uploaded" resume
--    still owned by that same user, the minimal resumes columns needed to
--    re-derive its content hash (storage_path/original_file_type/file_name).
--    Never returns resume text/content, only file-location metadata already
--    exposed elsewhere (e.g. CanonicalResumeImportService.loadOwnedResume()'s
--    own selected columns).
--
-- 2. system_resolve_resume_version_by_hash(p_user_id, p_content_hash) - a
--    pure, read-only lookup: given a content hash, finds that user's
--    canonical profile's source document with that hash (if any) and the
--    MOST RECENT career_resume_versions row referencing it (multiple
--    versions can reference one source document - see
--    canonicalResumeImportService.ts's own "already current" short-circuit
--    comment for why re-uploading unchanged-but-not-currently-latest
--    content still produces a new version row pointing at the same source
--    document). Returns null fields when no match exists - the caller
--    (resolveCanonicalResumeContext) treats that as SELECTED_RESUME_UNAVAILABLE,
--    never as a silent "fall back to latest".
create or replace function public.system_resolve_selected_resume(
  p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_memory public.career_memory%rowtype;
  v_resume public.resumes%rowtype;
  v_resume_found boolean := false;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_memory from public.career_memory where user_id = p_user_id;
  if not found then
    return jsonb_build_object('hasCareerMemory', false, 'selectedResumeType', null, 'selectedResumeId', null, 'resume', null);
  end if;

  if v_memory.selected_resume_type = 'uploaded' and v_memory.selected_resume_id is not null then
    select * into v_resume from public.resumes where id = v_memory.selected_resume_id and user_id = p_user_id;
    v_resume_found := found;
  end if;

  return jsonb_build_object(
    'hasCareerMemory', true,
    'selectedResumeType', v_memory.selected_resume_type,
    'selectedResumeId', v_memory.selected_resume_id,
    'resume', case when v_resume_found then jsonb_build_object(
      'id', v_resume.id,
      'fileName', v_resume.file_name,
      'storagePath', v_resume.storage_path,
      'originalFileType', v_resume.original_file_type,
      'sourceType', v_resume.source_type
    ) else null end
  );
end;
$$;

revoke all on function public.system_resolve_selected_resume(uuid) from public;
grant execute on function public.system_resolve_selected_resume(uuid) to service_role;

create or replace function public.system_resolve_resume_version_by_hash(
  p_user_id uuid,
  p_content_hash text
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_profile public.career_profiles%rowtype;
  v_source_doc public.career_source_documents%rowtype;
  v_version public.career_resume_versions%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_content_hash is null or length(p_content_hash) = 0 then
    raise exception using errcode = '22023', message = 'p_content_hash is required';
  end if;

  select * into v_profile from public.career_profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('profileId', null, 'sourceDocumentId', null, 'versionId', null);
  end if;

  select * into v_source_doc from public.career_source_documents where profile_id = v_profile.id and content_hash = p_content_hash;
  if not found then
    return jsonb_build_object('profileId', v_profile.id, 'sourceDocumentId', null, 'versionId', null);
  end if;

  select * into v_version from public.career_resume_versions where source_document_id = v_source_doc.id order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('profileId', v_profile.id, 'sourceDocumentId', v_source_doc.id, 'versionId', null);
  end if;

  /*
    Returns the FULL version row (not just its id) - the service-role
    caller (resolveCanonicalResumeContext.ts's resolveServiceRoleMode())
    has no other service-role-safe way to read career_resume_versions,
    and needs `snapshot`/`schema_version`/`serializer_version` to build a
    real CanonicalResumeRuntime via the existing, unmodified
    careerResumeVersionRowToRuntime() mapper - avoiding a third RPC
    round-trip for what is already a single-row read.
  */
  return jsonb_build_object('profileId', v_profile.id, 'sourceDocumentId', v_source_doc.id, 'versionId', v_version.id, 'version', to_jsonb(v_version));
end;
$$;

revoke all on function public.system_resolve_resume_version_by_hash(uuid, text) from public;
grant execute on function public.system_resolve_resume_version_by_hash(uuid, text) to service_role;
