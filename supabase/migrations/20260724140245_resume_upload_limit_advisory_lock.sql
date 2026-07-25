-- Draft migration - NOT applied to Production by this change.
--
-- Closes a real race in enforce_resume_upload_limit()
-- (20260724125129_resumes_content_hash_and_limits.sql): a plain
-- BEFORE INSERT trigger that only does `SELECT count(*) ... >= 3` does NOT
-- serialize two concurrent transactions inserting for the same user - both
-- can run their SELECT before either commits its INSERT, both see
-- count = 2, and both pass, producing 4 uploaded resumes. Postgres does not
-- implicitly lock rows a SELECT merely reads, so the count check alone was
-- insufficient under a real race (verified: this is a genuine gap in the
-- previous migration, not a hypothetical one).
--
-- Fix: take a transaction-scoped advisory lock keyed on the row's own
-- user_id before counting. Advisory locks are strictly per-key, so it only
-- ever serializes concurrent uploads for the SAME user against each other -
-- different users' uploads are entirely unaffected. pg_advisory_xact_lock
-- blocks (does not error) until the lock is free and releases automatically
-- at transaction end (commit or rollback), so a second concurrent request
-- simply waits for the first to finish, then sees the now-current count.
--
-- hashtextextended(..., 0) maps the uuid to a single bigint key, matching
-- pg_advisory_xact_lock(bigint)'s signature - a hash collision between two
-- different users' ids would only cause them to serialize against each
-- other occasionally (harmless, just marginally less concurrency), never a
-- correctness issue.

CREATE OR REPLACE FUNCTION public.enforce_resume_upload_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_count integer;
BEGIN
  IF NEW.source_type = 'uploaded' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

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
