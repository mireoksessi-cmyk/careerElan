-- Adds nullable resume-design-preview fields to public.resumes.
-- No DEFAULT values: existing rows stay NULL across every new column,
-- which is exactly the "not processed yet" state the preview renderer
-- treats as a safe fallback to the current plain-text/template preview.

alter table public.resumes
  add column if not exists original_file_type text,
  add column if not exists conversion_status text,
  add column if not exists preview_mode text,
  add column if not exists conversion_error text,
  add column if not exists extracted_layout jsonb,
  add column if not exists extracted_styles jsonb,
  add column if not exists extracted_assets jsonb,
  add column if not exists selected_template text;

alter table public.resumes
  add constraint resumes_conversion_status_check
  check (conversion_status is null or conversion_status in
    ('pending', 'processing', 'succeeded', 'failed', 'unsupported'));

alter table public.resumes
  add constraint resumes_preview_mode_check
  check (preview_mode is null or preview_mode in
    ('template_fallback', 'docx_html', 'pdf_original', 'pdf_reconstructed'));
