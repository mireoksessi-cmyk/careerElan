-- Phase 6G follow-up - service-role-safe canonical career memory read
-- path.
--
-- A real-DB test (the new "shadow ENABLED real-failure" section in
-- fixtures/scripts/phase6gSchemaStorageShadowPii.realdb.test.mts) exposed
-- a genuine, severe defect: generateCanonicalPackage() - the function
-- BOTH the /generate canary route and shadow mode call, always with the
-- service-role client (supabaseAdmin), since neither runs inside a real
-- user session (shadow mode runs in a background worker; /generate is a
-- legitimate service-role-mediated write path, matching the existing
-- legacy Generate Package precedent) - reads career_profiles and 9 other
-- career-memory tables via the ordinary repository layer
-- (createCanonicalRepositories -> CanonicalCareerMemoryService.getCanonicalRuntime()).
-- That pre-existing Phase 6D repository layer issues plain PostgREST
-- queries with no table GRANT for service_role at all (confirmed via
-- information_schema.role_table_grants: only TRUNCATE/REFERENCES/TRIGGER,
-- matching this schema's own established "service-role table access goes
-- through a SECURITY DEFINER RPC, never a raw grant" convention already
-- used by every other function in this migration set).
--
-- Without this fix, EVERY canonical generation attempt - regardless of
-- whether the target user actually has a canonical profile - fails at the
-- very first read with a real Postgres permission error, wrapped as an
-- opaque PersistenceError. This makes the entire canary/shadow feature
-- non-functional as built, not just a "no profile" edge case.
--
-- Fix: a single new SECURITY DEFINER RPC that fetches the exact same
-- 10-table read set getCanonicalRuntime() already performs, scoped to
-- p_user_id via an explicit ownership check (profile.user_id = p_user_id,
-- everything else scoped to that profile's own id) - matching every
-- other RPC in this migration set. Uses to_jsonb()/jsonb_agg(to_jsonb())
-- so every column comes back under its own real column name, identical
-- to what `select("*")` already returns to the existing repository layer
-- - the JS side re-assembles the EXACT SAME CareerMemoryPersistenceBundle
-- shape and hands it to the pre-existing, UNMODIFIED
-- careerProfileToCanonicalRuntime() mapper (lib/careerMemory/persistence/mappers.ts).
-- Nothing about Runtime/Template Engine/Parser semantics changes - only
-- how the raw rows are FETCHED for a service-role caller.
create or replace function public.system_get_canonical_memory_bundle(
  p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_profile public.career_profiles%rowtype;
  v_version public.career_resume_versions%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_profile from public.career_profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'no_profile');
  end if;

  select * into v_version from public.career_resume_versions where profile_id = v_profile.id order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'no_version', 'profile', to_jsonb(v_profile));
  end if;

  return jsonb_build_object(
    'status', 'success',
    'profile', to_jsonb(v_profile),
    'latestVersion', to_jsonb(v_version),
    'sourceDocuments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at asc) from public.career_source_documents t where t.profile_id = v_profile.id), '[]'::jsonb),
    'experiences', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_experiences t where t.profile_id = v_profile.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_languages t where t.profile_id = v_profile.id), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_projects t where t.profile_id = v_profile.id), '[]'::jsonb),
    'credentials', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_credentials t where t.profile_id = v_profile.id), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_awards t where t.profile_id = v_profile.id), '[]'::jsonb),
    'publications', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order asc, t.created_at asc) from public.career_publications t where t.profile_id = v_profile.id), '[]'::jsonb),
    'tailoredResumes', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at asc) from public.career_tailored_resumes t where t.profile_id = v_profile.id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.system_get_canonical_memory_bundle(uuid) from public;
grant execute on function public.system_get_canonical_memory_bundle(uuid) to service_role;
