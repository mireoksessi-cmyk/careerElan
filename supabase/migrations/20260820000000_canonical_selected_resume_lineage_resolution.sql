-- Selected-upload authority follows the version lineage, not just the
-- source document.
--
-- system_resolve_resume_version_by_hash() answered "which version came
-- from this uploaded file" by filtering on source_document_id. That was
-- the whole answer while the only way to get a version was to import
-- one. It stopped being the whole answer once a person could open an
-- imported resume, correct it, and save: a user-confirmed version
-- deliberately carries source_document_id = NULL (it was not produced
-- from a file), so the filter skipped every edit and handed back the
-- original import. Dashboard and Generate Package both went on showing
-- the parsed resume while the corrected one sat one row away.
--
-- The provenance column is not the problem and is not changed here.
-- source_document_id still means exactly what it meant: this version was
-- produced directly from that uploaded file. What changes is the
-- question asked of it. The import identifies where the lineage STARTS;
-- authority is its newest descendant.
--
-- The walk stops at the next version that carries a source_document_id
-- of its own, and that boundary is load-bearing rather than cosmetic.
-- Versions form one chain per profile - every new version, import or
-- edit, parents whatever was current - so a later upload is a descendant
-- of an earlier one. Without the boundary, selecting an older resume
-- would walk straight through the next import and return a different
-- document's edits. Only the NULL-source_document_id children belong to
-- the upload being asked about.
--
-- Only this one function changes. No table, column, index, or other RPC
-- is touched, and the returned shape is identical so every existing
-- caller keeps working.
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
  v_next public.career_resume_versions%rowtype;
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

  -- The lineage root: the most recent import of this exact file. Same
  -- selection as before, so a never-edited upload resolves exactly as it
  -- always did.
  select * into v_version from public.career_resume_versions
    where source_document_id = v_source_doc.id and profile_id = v_profile.id
    order by created_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('profileId', v_profile.id, 'sourceDocumentId', v_source_doc.id, 'versionId', null);
  end if;

  /*
    Walk forward to the newest user-confirmed descendant.

    Ordering is deterministic (created_at, then id) even though no fork
    exists today: save_canonical_runtime() serializes writers per profile
    with an advisory lock and checks the expected current version before
    inserting, so two siblings cannot be created. Picking deterministically
    anyway means a fork arriving from some future path degrades to a
    stable answer instead of an arbitrary one.

    Bounded by the row count so a cycle - which the concurrency rules
    above also forbid - cannot spin here.
  */
  for i in 1 .. (select count(*) from public.career_resume_versions where profile_id = v_profile.id) loop
    select * into v_next from public.career_resume_versions
      where parent_version_id = v_version.id
        and profile_id = v_profile.id
        and source_document_id is null
      order by created_at asc, id asc limit 1;
    exit when not found;
    v_version := v_next;
  end loop;

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
