-- Adds a nullable snapshot of the resume template used when a given
-- application's resume_text was generated. career_memory.resume_template
-- remains the single "current selection" source of truth (unchanged by
-- this migration); this column exists because a template change in
-- Career Memory must not retroactively alter how an already-generated
-- application renders in Job Tracker / PDF / DOCX - each application
-- keeps the template that was active at generation time, the same
-- snapshot pattern already used for generation_model/prompt_version/
-- resume_source. No DEFAULT: existing rows stay NULL, which every
-- consumer (see lib/brand/render/templateId.ts) already treats as
-- "use DEFAULT_RESUME_TEMPLATE."
--
-- Values are the lowercase canonical ids used throughout lib/brand/render
-- (normalizeResumeTemplateId()), not the capitalized display labels
-- career_memory.resume_template stores - the snapshot is normalized at
-- write time in app/api/generate-package/route.ts and
-- app/paste-job/page.tsx's savePackage().

alter table public.applications
  add column if not exists resume_template_id text;

alter table public.applications
  add constraint applications_resume_template_id_check
  check (resume_template_id is null or resume_template_id in
    ('classic', 'professional', 'creative', 'modern'));
