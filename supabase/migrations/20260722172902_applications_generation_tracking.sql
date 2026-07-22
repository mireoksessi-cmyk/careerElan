-- Tracks the status of an AI package-generation attempt on its own
-- applications row, and gives each attempt a stable client-generated id so
-- repeated "Generate Package" clicks for the same analyzed job are
-- idempotent instead of creating duplicate rows.
--
-- generation_status is intentionally separate from the existing `status`
-- column, which already means the user-facing application lifecycle
-- (applied/interview/etc., set by Job Tracker) - reusing it here would
-- collide with that meaning.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS generation_request_id uuid,
  ADD COLUMN IF NOT EXISTS generation_status text;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_generation_status_check
  CHECK (generation_status IS NULL OR generation_status IN ('pending', 'succeeded', 'failed'));

-- Partial: existing rows (and any future row created outside the
-- generation-tracking flow) keep generation_request_id NULL and are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS applications_user_generation_request_id_key
  ON public.applications (user_id, generation_request_id)
  WHERE generation_request_id IS NOT NULL;
