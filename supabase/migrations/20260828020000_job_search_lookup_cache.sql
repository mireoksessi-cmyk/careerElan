/*
  A short-lived, shared cache for one thing only: the answer a job-search
  provider gave for a plain occupation query.

  The dashboard recommends occupations from a person's Career Memory, then
  looks up a live Canadian posting for each one so the card can link to a real
  job. Six recommendations meant six upstream requests on every cold load, for
  queries like "Program Coordinator" that are identical between one visit and
  the next and between one person and another. The provider started refusing
  them: 75 of the last 106 upstream calls came back 429.

  Only the provider's own answer is stored. The query key is an occupation
  title and a country - nothing that describes a person. No user id, no resume,
  no Career Memory, no profile field is written here or used to build a key,
  which is what makes a single row safe to serve to everybody who asks the same
  question. The personalised half of the feature - which occupations to
  recommend, why they match, what is missing - is decided before this cache is
  ever consulted and never passes through it.

  Deliberately its own table. analytics_cache is per-user analytics and
  recommended_job_cache holds one person's AI recommendations keyed to their
  resume content; storing a shared provider answer in either would make an
  existing column mean something it does not.
*/
create table if not exists public.job_search_lookup_cache (
  /*
    The full provider request identity, normalised: a version marker, the
    country, a literal 'root' marker and the lowercased trimmed query.
    Everything that changes the upstream request is in the key, so a hit can
    never answer a different question than the one asked.

    There is no page dimension. Only first pages are stored: the provider
    paginates by opaque cursor, and a cursor is a token issued to one
    request, so a continuation is never shared between people or reused
    later. Those requests bypass this table entirely.
  */
  lookup_key text primary key,
  /*
    Exactly what the provider returned, unmodified - which is what makes a
    cached first page behave like a fresh one. The provider's continuation
    cursor sits inside this payload, so serving from cache still lets the
    person page forward through the live cursor chain.
  */
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  /*
    Explicit rather than derived, so the reader is a plain comparison and the
    lifetime is visible in the row itself. Writers set this; nothing renews it
    in place, so an entry ages out and is replaced rather than drifting.
  */
  expires_at timestamptz not null
);

comment on table public.job_search_lookup_cache is
  'Short-lived shared cache of job-provider responses for plain occupation
   queries, first page only - cursor continuation requests are never cached.
   Contains provider result data only - never Career Memory, resume content,
   profile fields or any user identifier, and no user data is used to build a
   key. Service-role access only.';

alter table public.job_search_lookup_cache enable row level security;
revoke all on public.job_search_lookup_cache from anon, authenticated;
grant select, insert, update, delete on public.job_search_lookup_cache to service_role;

/*
  Supports the expiry sweep. Reads go through the primary key.
*/
create index if not exists job_search_lookup_cache_expires_at_idx
  on public.job_search_lookup_cache (expires_at);
