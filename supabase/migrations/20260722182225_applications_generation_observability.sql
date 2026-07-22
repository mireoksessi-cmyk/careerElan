-- Phase 4: operational traceability and failure recovery for package
-- generation, building on Phase 3's generation_request_id/generation_status.
--
-- generation_error is split into two plain text columns (not a single jsonb
-- {code, summary} object) specifically so an eventual admin page can
-- GROUP BY generation_error_code directly without a jsonb ->> extraction -
-- simpler query, simpler code, and the "code" is always a small closed set
-- of safe values (never a stack trace, raw AI response, resume text, full
-- prompt, or env/API-key value - see classifyGenerationError() in
-- app/api/generate-package/route.ts).
--
-- job_description_normalized is a plain text column, not jsonb: it holds
-- only the AI's already-produced prose job summary (the same
-- jobAnalysis.summary the client already has from the earlier analyze-job
-- step) - the structured analysis data this would otherwise duplicate
-- already lives in the existing job_analysis jsonb column.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_error_code text,
  ADD COLUMN IF NOT EXISTS generation_error_summary text,
  ADD COLUMN IF NOT EXISTS generation_model text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS resume_source text,
  ADD COLUMN IF NOT EXISTS generation_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS generation_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS job_description_normalized text;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_resume_source_check
  CHECK (resume_source IS NULL OR resume_source IN ('uploaded', 'career_memory'));
