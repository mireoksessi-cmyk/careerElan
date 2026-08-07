-- Phase 6G follow-up - concurrency fix for complete_canonical_generation.
-- A real-DB test (fixtures/scripts/phase6gCanonicalGeneratePackage.realdb.test.mjs,
-- "concurrent race for the same tailored_resume_id") exposed a genuine race
-- condition: two concurrent calls for the SAME p_tailored_resume_id could
-- both read v_app BEFORE either transaction committed its own write, so
-- both passed the "already completed" idempotency check and both inserted
-- their own pair of generated_resume_documents rows - 4 document rows
-- total instead of 2, with the applications row pointing at only the
-- last-committed pair (the other pair silently orphaned, never referenced,
-- never cleaned up).
--
-- Fix: `select ... for update` on the applications row before checking/
-- writing. This serializes concurrent calls for the same application - the
-- second call then blocks until the first commits, re-reads the
-- now-already-completed row, and correctly takes the idempotent replay
-- path instead of re-inserting. Single-line functional change
-- (`for update` added to the initial select); the rest of the function
-- body is unchanged from supabase/migrations/20260807000000's own
-- definition, reproduced in full here only because Postgres functions are
-- replaced wholesale via create or replace, not patched in place.
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

  select * into v_app from public.applications where id = p_application_id and user_id = p_user_id for update;
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
