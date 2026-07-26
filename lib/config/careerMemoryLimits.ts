/*
  Single source of truth for Career Memory's upload/creation caps - both the
  displayed copy (app/career-memory/page.tsx) and the actual enforcement
  read from these, so the UI can never drift from what the backend allows.

  Verified against the real enforcement, not assumed:
  - MAX_UPLOADED_RESUMES: DB-enforced by the enforce_resume_upload_limit()
    trigger on public.resumes (supabase/migrations/
    20260724125129_resumes_content_hash_and_limits.sql, hardened against a
    race in 20260724140245_resume_upload_limit_advisory_lock.sql) - counts
    only source_type = 'uploaded' rows, independent of created resumes.
    The trigger's own "3" literal must stay in sync with this constant by
    hand (Postgres can't import a TS constant); if this value ever changes,
    the trigger needs a matching migration.
  - MAX_CREATED_RESUMES: not a counter at all - public.career_memory has a
    UNIQUE(user_id) constraint (career_memory_user_unique), so exactly one
    "created" resume profile can ever exist per user, structurally. Always
    1, not configurable at this layer.
  - MAX_COVER_LETTERS: enforced client-side only in
    app/career-memory/page.tsx's upload handler (count check before
    insert) - unlike resumes, there is no DB trigger backing this, so it is
    theoretically racy, but the displayed number itself is accurate to the
    check that exists today.
*/
export const MAX_UPLOADED_RESUMES = 3;
export const MAX_CREATED_RESUMES = 1;
export const MAX_COVER_LETTERS = 3;
