/*
  Career Fair Source Expansion - schema additions to support a multi-source
  registry (was a single hardcoded UBC ICS feed), cross-source
  deduplication, and safe multi-strike expiry.

  No backfill of existing rows - the one pre-existing UBC row simply gets
  NULL in every new column until the next ingestion run repopulates it via
  a normal upsert (source_name/source_event_id is unchanged, so that row's
  identity is preserved, not recreated).
*/

alter table public.career_fairs
  add column if not exists institution text,
  add column if not exists source_category text
    check (source_category in ('university', 'college', 'government', 'city', 'other')),
  add column if not exists audience text
    check (audience in ('public', 'students_only')),
  add column if not exists dedup_key text,
  add column if not exists missed_fetch_count integer not null default 0;

/*
  Used two ways: (a) cross-source duplicate lookup during ingestion (find
  an existing active row with the same key from a different source before
  inserting a new one), (b) nothing else reads this outside ingest.ts.
  Partial index (status = 'active') keeps it cheap and keeps expired/
  removed rows from ever being treated as a live duplicate target.
*/
create index if not exists career_fairs_dedup_key_idx
  on public.career_fairs (dedup_key)
  where status = 'active';

create index if not exists career_fairs_institution_idx
  on public.career_fairs (institution);
