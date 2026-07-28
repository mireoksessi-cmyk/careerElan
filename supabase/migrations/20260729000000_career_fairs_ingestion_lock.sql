/*
  Production Launch QA - prevents two ingestion cycles from running at the
  same time (a manual operator POST overlapping the daily Netlify
  Scheduled Function, or Netlify retrying/duplicating an invocation).

  A Postgres advisory lock was considered and rejected: pg_advisory_lock
  is session-scoped, but this app talks to Postgres through Supabase's
  pooled REST/PostgREST connections, which don't guarantee the same
  underlying session across separate calls (transaction-mode pooling can
  return a connection to the pool - releasing any session-held advisory
  lock - between the acquire and release calls). A single-row,
  conditional-UPDATE lock works correctly over stateless pooled
  connections instead: the UPDATE's WHERE clause only matches when the
  lock is free or stale, and Postgres's own row-level locking under
  READ COMMITTED guarantees only one concurrent UPDATE can win that
  match, with no session persistence required.
*/
create table if not exists public.career_fair_ingestion_lock (
  id text primary key default 'singleton',
  locked_at timestamptz
);

insert into public.career_fair_ingestion_lock (id, locked_at)
values ('singleton', null)
on conflict (id) do nothing;

alter table public.career_fair_ingestion_lock enable row level security;

/*
  No policies for anon/authenticated (same pattern as
  career_fair_ingest_runs) - this is purely an internal operational
  primitive, never read or written by user-facing code.
*/
grant select, update on table public.career_fair_ingestion_lock to service_role;
