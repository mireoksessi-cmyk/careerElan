-- Draft migration - NOT applied to Production by this change.
--
-- Closes two gaps in the "max 3 uploaded resumes, no duplicate content"
-- policy that were previously enforced only by a client-side pre-check
-- (app/career-memory/page.tsx), which cannot prevent two concurrent
-- uploads from both passing the same pre-check before either INSERT
-- commits.
--
-- 1. content_hash: a SHA-256 hex digest of the uploaded file's bytes,
--    computed client-side before upload. A partial unique index on
--    (user_id, content_hash) makes re-uploading the exact same file bytes
--    fail at the database level (23505), even under a race, while leaving
--    every existing row (content_hash IS NULL) and every genuinely
--    different file untouched.
-- 2. A BEFORE INSERT trigger enforcing the "max 3 uploaded resumes per
--    user" rule at the database level, closing the same class of race for
--    the count limit itself. Raises a distinguishable message
--    ('RESUME_LIMIT_REACHED') so the client can show the correct copy
--    instead of a generic insert-failed error.
--
-- Existing rows are unaffected: content_hash defaults to NULL (excluded
-- from the unique index by its WHERE clause), and the trigger only runs
-- on new inserts, never on rows already present.

ALTER TABLE public.resumes
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.resumes.content_hash IS
  'SHA-256 hex digest of the uploaded file bytes, computed client-side. NULL for rows created before this column existed.';

CREATE UNIQUE INDEX IF NOT EXISTS resumes_user_content_hash_uidx
  ON public.resumes (user_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- Defensive: is_default is currently only ever set at insert time
-- (app/career-memory/page.tsx, `is_default: count === 0`), with no later
-- toggle, but two concurrent first-ever uploads could both observe
-- count === 0 before either commits. This index makes that race fail at
-- the database level instead of silently producing two default rows.
CREATE UNIQUE INDEX IF NOT EXISTS resumes_user_default_uidx
  ON public.resumes (user_id)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.enforce_resume_upload_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_count integer;
BEGIN
  IF NEW.source_type = 'uploaded' THEN
    SELECT count(*) INTO existing_count
    FROM public.resumes
    WHERE user_id = NEW.user_id
      AND source_type = 'uploaded';

    IF existing_count >= 3 THEN
      RAISE EXCEPTION 'RESUME_LIMIT_REACHED'
        USING HINT = 'A user may have at most 3 uploaded resumes.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resumes_enforce_upload_limit ON public.resumes;

CREATE TRIGGER resumes_enforce_upload_limit
  BEFORE INSERT ON public.resumes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_resume_upload_limit();
