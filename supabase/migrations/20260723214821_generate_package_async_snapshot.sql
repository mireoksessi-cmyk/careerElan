-- Generate Package async (Background Function) architecture: adds columns
-- to freeze a "source snapshot" onto the applications row at claim time, so
-- the background worker never re-reads the user's live Dashboard selection
-- (which could change mid-generation) and never re-queries career_memory/
-- resumes/cover_letters directly - it only reads this row.
--
-- resume_id and cover_letter_id are NOT duplicated here - both already mean
-- "the input resume/cover letter id used for this application" (confirmed
-- by their existing use in the Apply-with-Saved-Resume path), so Generate
-- Package's claim step reuses them as-is.
--
-- All nullable, no backfill - existing rows keep these NULL.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_input_resume_text text,
  ADD COLUMN IF NOT EXISTS generation_input_resume_name text,
  ADD COLUMN IF NOT EXISTS generation_input_manifest_source jsonb,
  ADD COLUMN IF NOT EXISTS generation_input_cover_letter_text text,
  ADD COLUMN IF NOT EXISTS generation_worker_claimed_at timestamptz;

COMMENT ON COLUMN public.applications.generation_input_resume_text IS
  'Snapshot of the exact resume text fed to the main package-generation AI call, frozen at claim time (uploaded: resumes.original_text; career_memory: deterministic, non-AI text builder output). Distinct from resume_text, which holds the AI-generated output.';

COMMENT ON COLUMN public.applications.generation_input_resume_name IS
  'Snapshot of the display name for the selected resume at claim time (uploaded: file_name; career_memory: fixed label).';

COMMENT ON COLUMN public.applications.generation_input_manifest_source IS
  'Snapshot of the raw structured source object needed to rebuild the SourceManifest (fact-checking data) at generation time without re-querying career_memory/resumes: the full career_memory row for career_memory sources, or {original_text, parsed_data} for uploaded sources.';

COMMENT ON COLUMN public.applications.generation_input_cover_letter_text IS
  'Snapshot of the selected saved cover letter''s text at claim time, used only as a style/tone reference for the AI-generated cover letter - never copied into the final output. NULL if no cover letter was selected.';

COMMENT ON COLUMN public.applications.generation_worker_claimed_at IS
  'Set atomically by the background worker (UPDATE ... WHERE generation_worker_claimed_at IS NULL) the moment it starts processing - a second concurrent or retried invocation of the same worker sees a non-NULL value and exits immediately without calling OpenAI again.';
