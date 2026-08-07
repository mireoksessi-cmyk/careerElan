-- Phase 6G - Canonical Generate Package production integration.
-- Additive only: new nullable columns, a new private Storage bucket +
-- RLS, and two new "system" RPCs. Never touches an existing column,
-- constraint, or RPC signature.
--
-- Why two NEW RPCs instead of reusing create_canonical_overlay /
-- create_canonical_generated_document: those are `security invoker` +
-- auth.uid()-based, designed for authenticated CLIENT routes
-- (withCanonicalAuth). Shadow-mode and canary canonical generation run
-- INSIDE the existing Generate Package background worker
-- (generateCore.ts), which uses the service-role client with NO user
-- session - auth.uid() would resolve to null there and every call
-- would fail AUTHENTICATION_REQUIRED. The EXISTING legacy RPCs
-- (claim_generate_package_worker, complete_generate_package_generation)
-- already solved this exact problem the same way: security definer,
-- explicit p_user_id parameter (trusted because it is only ever read
-- server-side from the applications row's own already-authenticated
-- user_id, never from client input), internal ownership check against
-- that parameter. These two new RPCs follow that same established
-- precedent, not a new pattern.

-- ============================================================
-- 1. applications - new nullable canonical-generation metadata columns
-- ============================================================
alter table public.applications
  add column if not exists canonical_profile_id uuid references public.career_profiles(id) on delete set null,
  add column if not exists canonical_resume_version_id uuid references public.career_resume_versions(id) on delete set null,
  add column if not exists tailored_resume_id uuid references public.career_tailored_resumes(id) on delete set null,
  add column if not exists selected_template_id text,
  add column if not exists generated_pdf_document_id uuid references public.generated_resume_documents(id) on delete set null,
  add column if not exists generated_docx_document_id uuid references public.generated_resume_documents(id) on delete set null,
  add column if not exists generation_engine text,
  add column if not exists generation_engine_version text,
  add column if not exists fallback_used boolean,
  add column if not exists fallback_reason text,
  add column if not exists canonical_input_manifest jsonb,
  add column if not exists protected_fact_validation_result jsonb;

alter table public.applications
  add constraint applications_selected_template_id_check
  check (selected_template_id is null or selected_template_id in
    ('professional-ats', 'modern-sidebar', 'executive-minimal', 'creative-timeline'));

alter table public.applications
  add constraint applications_generation_engine_check
  check (generation_engine is null or generation_engine in ('legacy', 'canonical'));

alter table public.applications
  add constraint applications_fallback_reason_check
  check (fallback_reason is null or fallback_reason in (
    'no_canonical_profile', 'no_canonical_version', 'deserialization_failure',
    'overlay_validation_failure', 'template_rendering_failure', 'generated_document_failure',
    'feature_flag_disabled', 'transient_failure'
  ));

comment on column public.applications.selected_template_id is 'Canonical template id namespace (professional-ats/modern-sidebar/executive-minimal/creative-timeline) - deliberately distinct from the legacy resume_template_id column (classic/professional/creative/modern), which is a different, disjoint id space.';

-- ============================================================
-- 2. Private Storage bucket for real generated PDF/DOCX bytes.
--    Mirrors the existing resumes/cover-letters bucket + RLS pattern
--    (see 20260721010219_storage_rls_owner_check.sql) exactly - private
--    bucket, owner-path-prefix ("${user.id}/...") RLS. Writes happen
--    via the service-role client (background worker), which bypasses
--    RLS by design; these policies govern future authenticated-client
--    reads (e.g. a signed-URL download from the browser).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('generated-documents', 'generated-documents', false)
on conflict (id) do nothing;

create policy "generated_documents_storage_select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "generated_documents_storage_insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "generated_documents_storage_update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "generated_documents_storage_delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ============================================================
-- 3. system_create_canonical_overlay - service-role-safe overlay
--    creation, used only from inside the background worker (shadow
--    mode and canary canonical generation). Ownership is checked
--    against the explicit p_user_id, never auth.uid(). No idempotency
--    key of its own - the OUTER generation attempt is already
--    idempotent one layer up via applications.generation_request_id's
--    unique index and the atomic claim_generate_package_worker RPC, so
--    this function's own body only ever executes once per real attempt.
-- ============================================================
create or replace function public.system_create_canonical_overlay(
  p_user_id uuid,
  p_profile_id uuid,
  p_resume_version_id uuid,
  p_application_id uuid,
  p_template_id text,
  p_ai_model text,
  p_prompt_version text,
  p_overlay jsonb
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_profile public.career_profiles%rowtype;
  v_row public.career_tailored_resumes%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_profile from public.career_profiles where id = p_profile_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'profile');
  end if;

  if p_resume_version_id is not null then
    if not exists (select 1 from public.career_resume_versions where id = p_resume_version_id and profile_id = p_profile_id) then
      return jsonb_build_object('status', 'not_found', 'reason', 'resume_version');
    end if;
  end if;

  if p_application_id is not null then
    if not exists (select 1 from public.applications where id = p_application_id and user_id = p_user_id) then
      return jsonb_build_object('status', 'not_found', 'reason', 'application');
    end if;
  end if;

  insert into public.career_tailored_resumes (profile_id, application_id, resume_version_id, overlay, template_id, ai_model, prompt_version)
  values (p_profile_id, p_application_id, p_resume_version_id, p_overlay, p_template_id, p_ai_model, p_prompt_version)
  returning * into v_row;

  return jsonb_build_object('status', 'success', 'overlayId', v_row.id, 'createdAt', v_row.created_at);
end;
$$;

revoke all on function public.system_create_canonical_overlay(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public;
grant execute on function public.system_create_canonical_overlay(uuid, uuid, uuid, uuid, text, text, text, jsonb) to service_role;

-- ============================================================
-- 4. complete_canonical_generation - the single atomic write for
--    "application canonical metadata + generated-document metadata",
--    exactly the boundary the round's own Transaction requirement
--    names ("overlay 저장, application canonical metadata 연결,
--    generated-document metadata 저장 사이에 부분 성공 가능성이 있으면
--    PASS 금지"). Overlay creation (step 3 above) is its own prior,
--    already-atomic step - an overlay row that exists but never gets
--    linked to an application is harmless and orphan-tolerated by
--    design (career_tailored_resumes.application_id is nullable), the
--    same way an abandoned legacy `applications` row already is. This
--    function is what must never partially apply: both document rows
--    (pdf + docx) and the applications row update happen in ONE
--    transaction, or none of them do.
--
--    Idempotent by construction: if the applications row already has
--    generated_pdf_document_id set (a prior successful run), returns
--    the existing linkage without inserting new document rows or
--    creating duplicates - belt-and-suspenders on top of the outer
--    claim_generate_package_worker atomic claim, which already
--    guarantees this function's body runs at most once per real
--    generation attempt.
-- ============================================================
create or replace function public.complete_canonical_generation(
  p_user_id uuid,
  p_application_id uuid,
  p_tailored_resume_id uuid,
  p_canonical_profile_id uuid,
  p_canonical_resume_version_id uuid,
  p_template_id text,
  p_pdf_storage_bucket text,
  p_pdf_storage_path text,
  p_docx_storage_bucket text,
  p_docx_storage_path text,
  p_generation_engine text,
  p_generation_engine_version text,
  p_protected_fact_validation_result jsonb
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_app public.applications%rowtype;
  v_tailored public.career_tailored_resumes%rowtype;
  v_pdf_row public.generated_resume_documents%rowtype;
  v_docx_row public.generated_resume_documents%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_app from public.applications where id = p_application_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'application');
  end if;

  -- Idempotent replay: already completed for this application.
  if v_app.generated_pdf_document_id is not null and v_app.generated_docx_document_id is not null then
    return jsonb_build_object(
      'status', 'success',
      'alreadyCompleted', true,
      'pdfDocumentId', v_app.generated_pdf_document_id,
      'docxDocumentId', v_app.generated_docx_document_id
    );
  end if;

  select t.* into v_tailored
    from public.career_tailored_resumes t
    join public.career_profiles p on p.id = t.profile_id
    where t.id = p_tailored_resume_id and t.profile_id = p_canonical_profile_id and p.user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'tailored_resume');
  end if;

  insert into public.generated_resume_documents (tailored_resume_id, storage_bucket, storage_path, file_type)
  values (v_tailored.id, p_pdf_storage_bucket, p_pdf_storage_path, 'pdf')
  returning * into v_pdf_row;

  insert into public.generated_resume_documents (tailored_resume_id, storage_bucket, storage_path, file_type)
  values (v_tailored.id, p_docx_storage_bucket, p_docx_storage_path, 'docx')
  returning * into v_docx_row;

  update public.applications
  set
    canonical_profile_id = p_canonical_profile_id,
    canonical_resume_version_id = p_canonical_resume_version_id,
    tailored_resume_id = p_tailored_resume_id,
    selected_template_id = p_template_id,
    generated_pdf_document_id = v_pdf_row.id,
    generated_docx_document_id = v_docx_row.id,
    generation_engine = p_generation_engine,
    generation_engine_version = p_generation_engine_version,
    protected_fact_validation_result = p_protected_fact_validation_result,
    updated_at = now()
  where id = p_application_id and user_id = p_user_id;

  return jsonb_build_object(
    'status', 'success',
    'alreadyCompleted', false,
    'pdfDocumentId', v_pdf_row.id,
    'docxDocumentId', v_docx_row.id
  );
end;
$$;

revoke all on function public.complete_canonical_generation(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.complete_canonical_generation(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;

-- ============================================================
-- 5. mark_canonical_fallback - lightweight, service-role-safe write
--    for recording that a request fell back to legacy generation (or
--    that shadow mode ran), without needing the full document-write
--    transaction above. Always safe to call multiple times (last
--    write wins) - this is observability metadata, not a state
--    machine.
-- ============================================================
create or replace function public.mark_canonical_fallback(
  p_user_id uuid,
  p_application_id uuid,
  p_fallback_used boolean,
  p_fallback_reason text,
  p_generation_engine text
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  update public.applications
  set fallback_used = p_fallback_used, fallback_reason = p_fallback_reason, generation_engine = p_generation_engine, updated_at = now()
  where id = p_application_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'application');
  end if;

  return jsonb_build_object('status', 'success');
end;
$$;

revoke all on function public.mark_canonical_fallback(uuid, uuid, boolean, text, text) from public;
grant execute on function public.mark_canonical_fallback(uuid, uuid, boolean, text, text) to service_role;

-- ============================================================
-- 6. get_canonical_generation_status - read-only status for the
--    /api/internal/canonical-generate-package/status route. Same
--    reason as every other function in this file: service_role has NO
--    direct table GRANT on `applications` (confirmed via
--    information_schema.role_table_grants - only TRUNCATE/REFERENCES/
--    TRIGGER), so a plain `supabaseAdmin.from("applications").select()`
--    from that route would fail with a real Postgres permission error
--    in Production too, not just locally - this RPC is the fix,
--    following the exact same security-definer + explicit p_user_id +
--    internal ownership check pattern as every other function above.
-- ============================================================
create or replace function public.get_canonical_generation_status(
  p_user_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_app public.applications%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '28000', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_app from public.applications where id = p_application_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'application');
  end if;

  return jsonb_build_object(
    'status', 'success',
    'application', jsonb_build_object(
      'id', v_app.id,
      'canonical_profile_id', v_app.canonical_profile_id,
      'canonical_resume_version_id', v_app.canonical_resume_version_id,
      'tailored_resume_id', v_app.tailored_resume_id,
      'selected_template_id', v_app.selected_template_id,
      'generated_pdf_document_id', v_app.generated_pdf_document_id,
      'generated_docx_document_id', v_app.generated_docx_document_id,
      'generation_engine', v_app.generation_engine,
      'generation_engine_version', v_app.generation_engine_version,
      'fallback_used', v_app.fallback_used,
      'fallback_reason', v_app.fallback_reason
    )
  );
end;
$$;

revoke all on function public.get_canonical_generation_status(uuid, uuid) from public;
grant execute on function public.get_canonical_generation_status(uuid, uuid) to service_role;
