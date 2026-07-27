/*
  Mirrors 20260721010218_resume_preview_fields.sql for public.cover_letters -
  additive, backward-compatible columns for the same "preserve and preview
  the original uploaded file" pipeline resumes already have. Existing
  cover_letters rows (all of which predate this migration, so every one of
  these new columns is NULL for them) keep working exactly as before: NULL
  conversion_status is not "succeeded", so CoverLetterPreviewRenderer's
  fallback path (the existing original_text/parsed_data render, unchanged)
  is what legacy rows continue to show - see components/coverLetter/
  CoverLetterPreviewRenderer.tsx.

  Deliberately NOT added (kept out of scope - this migration is only about
  the original-file preview bug, not full schema parity):
    - content_hash / an upload-count trigger (resumes'
      20260724125129_resumes_content_hash_and_limits.sql equivalent) - a
      distinct feature (dedup/limit enforcement), not requested here.
    - extracted_styles / selected_template - present on resumes but
      confirmed unused there too; no reason to add unused columns here.
    - source_type - resumes uses it to distinguish "uploaded" from other
      creation methods; cover_letters has no such second creation path
      (AI-generated cover letters are never written to this table at all,
      only to applications.cover_letter_text), so it has nothing to
      distinguish.
*/

alter table public.cover_letters
  add column if not exists original_file_type text,
  add column if not exists conversion_status text,
  add column if not exists preview_mode text,
  add column if not exists conversion_error text,
  add column if not exists extracted_layout jsonb,
  add column if not exists extracted_assets jsonb;

alter table public.cover_letters
  drop constraint if exists cover_letters_conversion_status_check;

alter table public.cover_letters
  add constraint cover_letters_conversion_status_check
  check (
    conversion_status is null
    or conversion_status in ('pending', 'processing', 'succeeded', 'failed', 'unsupported')
  );

alter table public.cover_letters
  drop constraint if exists cover_letters_preview_mode_check;

alter table public.cover_letters
  add constraint cover_letters_preview_mode_check
  check (
    preview_mode is null
    or preview_mode in ('template_fallback', 'docx_html', 'pdf_original', 'pdf_reconstructed')
  );
