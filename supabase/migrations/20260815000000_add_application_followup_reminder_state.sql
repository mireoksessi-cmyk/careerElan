/*
  Email Notifications Phase 1 (Job Tracker follow-up reminders) - adds the
  persistent state needed to time and deduplicate the two automated
  follow-up reminder emails. This migration ONLY adds/corrects columns on
  the existing public.applications table - no new table, RPC, trigger, or
  extension. gen_random_uuid() is already relied on elsewhere in this
  schema (see applications.id's own default in the base schema
  migration), so no new extension is needed for the uuid column below.

  status_applied_at: the authoritative "entered Applied state" timestamp.
  applications.applied_date (pre-existing) is NOT this - it is set once at
  package-creation time in app/paste-job/page.tsx's savePackage(), before
  the user has necessarily ever marked the row "Applied" via the Job
  Tracker status dropdown, and is never touched again. status_applied_at
  is instead set (only in app/job-tracker/page.tsx's saveStatus()) at the
  moment status first transitions into "Applied", and is deliberately
  never overwritten by a later re-save of the same "Applied" value.

  last_followup_email_at: corrected from its previous "integer DEFAULT 0
  NOT NULL" type to timestamptz. The prior integer type could never
  actually hold the ISO-8601 timestamp string the existing
  app/api/followup/route.ts already attempted to write into it - that
  write was silently failing. Existing values (always the integer literal
  0, since no real timestamp could ever have been successfully stored)
  carry no reconstructable date information, so they are intentionally
  discarded (cast to NULL) rather than reinterpreted as a real date.

  followup_claimed_at / followup_claim_token: persistent claim fields so
  the follow-up scheduler can atomically claim a single application before
  sending, and release (or let expire) that claim afterward - see
  app/api/followup/route.ts for the conditional-UPDATE claim logic that
  uses these two columns as a compare-and-swap guard against concurrent/
  duplicate scheduler invocations. No new RPC/function is needed for this:
  a plain conditional UPDATE (matching only currently-unclaimed-or-stale
  rows) is atomic at the Postgres row-lock level.

  applications.followup_email_count (pre-existing, unchanged) remains the
  authoritative successful-send counter: 0 = no reminder sent yet,
  1 = Reminder #1 succeeded, 2 = Reminder #1 and #2 both succeeded (the
  maximum - this migration does not change its type, default, or name).
*/

alter table public.applications
  add column if not exists status_applied_at timestamptz,
  add column if not exists followup_claimed_at timestamptz,
  add column if not exists followup_claim_token uuid;

alter table public.applications
  alter column last_followup_email_at drop not null,
  alter column last_followup_email_at drop default,
  alter column last_followup_email_at type timestamptz using null;

comment on column public.applications.status_applied_at is
  'Timestamp of the first real transition of status into ''Applied'' (set only by app/job-tracker/page.tsx saveStatus()); never reset by re-saving an already-Applied status. Authoritative basis for Reminder #1 timing - do not confuse with applied_date (package-creation date).';

comment on column public.applications.last_followup_email_at is
  'Timestamp of the most recent SUCCESSFUL follow-up reminder send (set only after a confirmed non-error Resend response). Corrected from an unusable integer type - see migration header comment. Basis for Reminder #2 timing (last_followup_email_at + 3 days), never status_applied_at + 8 days.';

comment on column public.applications.followup_claimed_at is
  'Set by the follow-up scheduler at claim time to reserve this application for one in-flight send attempt; cleared on success or safe failure-path release. A claim older than the scheduler''s stale-claim threshold may be atomically reclaimed by a later invocation.';

comment on column public.applications.followup_claim_token is
  'Opaque token minted per claim attempt (crypto.randomUUID()) so a given invocation can verify it still owns a claim before finalizing a send; not a secret, purely a compare-and-swap guard.';
