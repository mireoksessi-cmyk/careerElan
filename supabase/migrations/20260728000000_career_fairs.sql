/*
  Career Fair Search feature - real, source-backed Canadian career fair
  listings. This is the first publicly-readable table in this codebase
  (every other table is auth.uid()-scoped) since career fair listings are
  not user data - anonymous visitors and logged-out users can browse them.
  Writes are restricted to the service-role client only (the ingestion
  route), never to authenticated/anon users - there are deliberately no
  INSERT/UPDATE/DELETE policies below.
*/

create table if not exists public.career_fairs (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  organizer text,
  description text,

  start_at timestamptz not null,
  end_at timestamptz,
  timezone text,

  city text,
  province_or_territory text,
  country text not null default 'Canada',
  venue text,

  event_mode text not null default 'in_person'
    check (event_mode in ('in_person', 'online', 'hybrid')),

  official_url text not null,
  registration_url text,

  source_name text not null,
  source_event_id text not null,
  last_verified_at timestamptz not null default now(),

  status text not null default 'active'
    check (status in ('active', 'expired', 'removed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source_name, source_event_id)
);

create index if not exists career_fairs_start_at_idx
  on public.career_fairs (start_at);

create index if not exists career_fairs_status_start_at_idx
  on public.career_fairs (status, start_at);

create index if not exists career_fairs_province_idx
  on public.career_fairs (province_or_territory);

create index if not exists career_fairs_city_idx
  on public.career_fairs (city);

create index if not exists career_fairs_event_mode_idx
  on public.career_fairs (event_mode);

alter table public.career_fairs enable row level security;

create policy "career_fairs_public_read"
  on public.career_fairs
  for select
  using (status = 'active');

/*
  Ingestion audit log - lets us see collection results/failure reasons in
  server logs (per requirement) without exposing anything publicly. RLS is
  enabled with zero policies, so only the service-role client (which
  bypasses RLS) can read or write this table.
*/
create table if not exists public.career_fair_ingest_runs (
  id uuid primary key default gen_random_uuid(),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  source_name text,
  fetched_count integer,
  inserted_count integer,
  updated_count integer,
  expired_count integer,

  error text,

  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed'))
);

alter table public.career_fair_ingest_runs enable row level security;

/*
  This local Supabase project's "ALTER DEFAULT PRIVILEGES FOR ROLE
  postgres" clause (see remote_schema.sql) only grants
  REFERENCES/TRIGGER/TRUNCATE/MAINTAIN to anon/authenticated/service_role
  on newly created tables - never the actual data privileges
  (SELECT/INSERT/UPDATE/DELETE). Confirmed locally: without the grants
  below, supabaseAdmin (the service_role client) fails ingestion with
  "permission denied for table career_fairs" even though RLS itself is
  configured correctly - RLS and SQL-level GRANTs are two independent
  gates, and default privileges here only cover the former's supporting
  grants, not the latter. anon/authenticated get SELECT only (RLS's
  "status = 'active'" policy still filters what that SELECT can see);
  only service_role (the ingestion route) can write.
*/
grant select on table public.career_fairs to anon, authenticated;
grant select, insert, update, delete on table public.career_fairs to service_role;
grant select, insert, update, delete on table public.career_fair_ingest_runs to service_role;
