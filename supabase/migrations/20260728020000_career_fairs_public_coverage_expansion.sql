/*
  Public Career Fair Coverage Expansion - the audience taxonomy from the
  prior migration (public/students_only only) can't represent the real
  variety of eligibility this pass's sources actually publish: alumni-
  eligible fairs, newcomer/settlement-agency fairs, and employer-invite-
  only sessions all exist and need their own honest category rather than
  being forced into "public" or "students_only". "unknown" stays a first-
  class value (not just "whatever isn't public/students_only") for events
  whose real eligibility genuinely can't be determined from what the
  source publishes - never guessed into "public".
*/

alter table public.career_fairs
  drop constraint if exists career_fairs_audience_check;

alter table public.career_fairs
  add constraint career_fairs_audience_check
  check (audience is null or audience in (
    'public', 'students_only', 'alumni', 'newcomers',
    'employer_invite_only', 'unknown'
  ));

alter table public.career_fairs
  drop constraint if exists career_fairs_source_category_check;

alter table public.career_fairs
  add constraint career_fairs_source_category_check
  check (source_category is null or source_category in (
    'university', 'college', 'government', 'city', 'newcomer_agency',
    'chamber_of_commerce', 'library', 'healthcare', 'public_sector', 'other'
  ));

/*
  eligibility_text: the actual sentence/phrase from the source that drove
  the audience classification (or a neutral excerpt) - lets the UI show a
  real quote instead of asking a job seeker to trust a bare badge.
  registration_required / cost_type: best-effort, regex-detected from the
  event's own description - null (not false/'free') when the source is
  silent on either, since silence isn't evidence.
*/
alter table public.career_fairs
  add column if not exists eligibility_text text,
  add column if not exists registration_required boolean,
  add column if not exists cost_type text
    check (cost_type is null or cost_type in ('free', 'paid'));

/*
  Link-verification safeguard (section 6 of this pass's spec): a single
  failed HTTP check must never delete/hide an event outright - only after
  several consecutive failed checks does link_check_failures cross a
  threshold the API can use to deprioritize (not hard-delete) a row.
  link_last_checked_at is separate from last_verified_at (which tracks
  "still present in the source feed", not "the link itself resolves").
*/
alter table public.career_fairs
  add column if not exists link_check_failures integer not null default 0,
  add column if not exists link_last_checked_at timestamptz;
