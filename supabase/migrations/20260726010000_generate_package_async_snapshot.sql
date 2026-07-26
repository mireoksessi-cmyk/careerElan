-- Generate Package async (Background Function) architecture, Phase 1:
-- adds columns to freeze an immutable "source snapshot" onto the
-- applications row at claim time (in the synchronous route), so the
-- background worker never re-reads the user's live Dashboard selection
-- (which could change mid-generation) and never re-queries career_memory/
-- resumes/cover_letters directly - it only ever reads this one row.
--
-- resume_id and cover_letter_id are NOT duplicated here - both already
-- exist on this table and already mean "the input resume/cover letter id
-- used for this application" - the sync route's claim step continues to
-- set them as it does today.
--
-- All nullable, no backfill - existing rows (and any row created outside
-- the async generation flow) keep these NULL indefinitely, which is
-- unambiguous: "no async generation snapshot was ever taken for this row."
--
-- Column names/types checked against every prior migration touching
-- public.applications (20260722172902_applications_generation_tracking.sql,
-- 20260722182225_applications_generation_observability.sql) - no overlap
-- with generation_request_id/generation_status/generation_error_code/
-- generation_error_summary/generation_model/prompt_version/resume_source/
-- generation_started_at/generation_completed_at/job_description_normalized,
-- all of which are preserved and reused as-is by the worker.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_input_resume_text text,
  ADD COLUMN IF NOT EXISTS generation_input_resume_name text,
  ADD COLUMN IF NOT EXISTS generation_input_manifest_source jsonb,
  ADD COLUMN IF NOT EXISTS generation_input_cover_letter_text text,
  ADD COLUMN IF NOT EXISTS generation_worker_claimed_at timestamptz;

COMMENT ON COLUMN public.applications.generation_input_resume_text IS
  'Snapshot of the exact resume text fed to the main package-generation AI call, frozen at claim time by the synchronous /api/generate-package route (uploaded: resumes.original_text; career_memory: deterministic, non-AI draft text - see lib/resume-builder.ts buildCareerMemoryDraftText). Distinct from resume_text, which holds the AI-generated output.';

COMMENT ON COLUMN public.applications.generation_input_resume_name IS
  'Snapshot of the display name for the selected resume at claim time (uploaded: file_name; career_memory: fixed label).';

COMMENT ON COLUMN public.applications.generation_input_manifest_source IS
  'Snapshot of the raw structured source object needed to rebuild the SourceManifest (fact-checking data) at generation time without re-querying career_memory/resumes: the full career_memory row for career_memory sources, or the uploaded resume row (original_text + parsed_data) for uploaded sources.';

COMMENT ON COLUMN public.applications.generation_input_cover_letter_text IS
  'Snapshot of the selected saved cover letter''s text at claim time, used only as a style/tone reference for the AI-generated cover letter - never copied into the final output. NULL if no cover letter was selected.';

COMMENT ON COLUMN public.applications.generation_worker_claimed_at IS
  'Set atomically by the background worker (UPDATE ... WHERE generation_status = ''pending'' AND generation_worker_claimed_at IS NULL) the instant it starts processing - a second concurrent or platform-retried invocation for the same applications row sees a non-NULL value and exits immediately without calling OpenAI again. Reset to NULL by the sync route only when it deliberately reclaims a failed/stale-pending row for a retry with the same generation_request_id.';
