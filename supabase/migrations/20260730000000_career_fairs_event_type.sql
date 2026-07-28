-- Career Opportunity Event Type Expansion: classifies WHICH KIND of
-- career-opportunity event a row represents (career_fair, job_fair,
-- hiring_event, ...), independent of the existing audience/eligibility
-- columns. No DEFAULT and no backfill statement here on purpose - the
-- very next full ingestion run (already required by this feature's own
-- spec) re-writes every active row's full field set via ingest.ts's
-- upsert path, which now includes these two columns, so every existing
-- row backfills itself organically through the real classifier rather
-- than a blanket SQL guess. Existing rows stay NULL until that run.

alter table public.career_fairs
  add column if not exists event_type text,
  add column if not exists event_type_confidence text;

alter table public.career_fairs
  add constraint career_fairs_event_type_check
  check (
    event_type is null or event_type in (
      'career_fair',
      'job_fair',
      'hiring_event',
      'recruitment_event',
      'career_expo',
      'employer_information_session',
      'networking_event',
      'industry_night',
      'graduate_fair',
      'volunteer_fair',
      'career_workshop',
      'interview_event',
      'open_house',
      'other'
    )
  );

alter table public.career_fairs
  add constraint career_fairs_event_type_confidence_check
  check (
    event_type_confidence is null
    or event_type_confidence in ('high', 'medium', 'low')
  );
