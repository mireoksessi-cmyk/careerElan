/*
  Server-enforced, per-account LIFETIME quota (default 5, not monthly/
  daily) for Generate Package, enforced only in Netlify Production
  (see lib/config/packageQuota.ts's isNetlifyProductionRuntime()) - this
  migration itself does not know or care about environment; it is pure
  storage/atomicity plumbing, gated entirely from the application layer.

  Unrelated to the pre-existing profiles.package_limit column or the
  dashboard's FREE_PACKAGE_LIMIT/packagesThisMonth display - those are a
  separate, unenforced monthly concept and are not touched here.

  Rows are keyed by (user_id, request_id), where request_id is the same
  generationRequestId already used by applications.generation_request_id
  for Generate Package's own idempotent-claim logic. Reusing that same id
  as the quota idempotency key means a retry/double-click/recovery-poll
  naturally lands on the same row here too, so it can never be double-
  charged - no separate idempotency bookkeeping needed.

  status lifecycle: reserved -> completed (final generation succeeded) or
  reserved -> released (final generation failed; does not count toward
  the limit). A "used" slot is any row that is 'completed', or 'reserved'
  and still fresh (see GENERATE_PACKAGE_QUOTA_STALE_SECONDS below) - a
  reservation whose request died before ever calling complete/release
  stops counting once stale, so it can never permanently lock a slot.

  Follows the same security convention as public.api_rate_limits and
  public.enforce_resume_upload_limit(): RLS enabled with zero policies
  (default-deny), no direct GRANTs on the table, and the only access path
  is through SECURITY DEFINER functions whose EXECUTE is restricted to
  service_role, called only from server-only code
  (app/api/generate-package/route.ts) using an authenticated user.id that
  the client can never override.
*/

create table if not exists public.generate_package_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  request_id uuid not null,
  status text not null check (status in ('reserved', 'completed', 'released')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists generate_package_usage_user_request_key
  on public.generate_package_usage (user_id, request_id);

create index if not exists generate_package_usage_user_status_idx
  on public.generate_package_usage (user_id, status);

alter table public.generate_package_usage enable row level security;

revoke all on public.generate_package_usage from anon, authenticated;

/*
  Atomically decides whether the caller may consume one more of their
  p_limit lifetime slots for p_request_id, and reserves it if so.

  A single pg_advisory_xact_lock keyed on the user (seed 1, distinct from
  enforce_resume_upload_limit()'s seed 0, so the two lock domains can
  never collide for the same user) serializes every reservation attempt
  for that user within this transaction - closing exactly the race a bare
  "SELECT count(*) ... then INSERT" would have under concurrent requests
  (verified pattern, same reasoning as the resume-upload-limit fix). The
  lock is transaction-scoped and always releases automatically at commit
  or rollback, even on error.

  Existing-row handling for p_request_id (idempotent retry of the same
  Generate Package click):
    - 'completed'          -> already done; report success, no re-charge.
    - 'reserved', fresh     -> still in flight; report success, no re-charge.
    - 'reserved', stale     -> abandoned attempt; revive it (refresh
                                created_at) rather than double-reserving.
    - 'released'            -> a prior attempt with this exact id failed
                                and was refunded; re-check the limit
                                (excluding this row, which currently
                                counts for nothing) and re-reserve only if
                                a slot is still free.
  No existing row -> a genuinely new request id; reserve only if the
  count of the caller's other 'completed' or fresh-'reserved' rows is
  below p_limit.
*/
create or replace function public.reserve_generate_package_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_limit integer default 5,
  p_stale_after_seconds integer default 180
)
returns table (
  reserved boolean,
  already_completed boolean,
  used integer,
  remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_created_at timestamptz;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  select status, created_at
    into v_status, v_created_at
  from public.generate_package_usage
  where user_id = p_user_id
    and request_id = p_request_id;

  if found then
    if v_status = 'completed' then
      select count(*) into v_used
      from public.generate_package_usage
      where user_id = p_user_id
        and (
          status = 'completed'
          or (
            status = 'reserved'
            and created_at > now() - make_interval(secs => p_stale_after_seconds)
          )
        );

      return query select true, true, v_used, greatest(p_limit - v_used, 0);
      return;
    end if;

    if v_status = 'reserved' then
      if v_created_at <= now() - make_interval(secs => p_stale_after_seconds) then
        update public.generate_package_usage
          set created_at = now(), updated_at = now()
        where user_id = p_user_id
          and request_id = p_request_id;
      end if;

      select count(*) into v_used
      from public.generate_package_usage
      where user_id = p_user_id
        and (
          status = 'completed'
          or (
            status = 'reserved'
            and created_at > now() - make_interval(secs => p_stale_after_seconds)
          )
        );

      return query select true, false, v_used, greatest(p_limit - v_used, 0);
      return;
    end if;

    -- v_status = 'released': this exact request_id was previously refunded.
    select count(*) into v_used
    from public.generate_package_usage
    where user_id = p_user_id
      and request_id <> p_request_id
      and (
        status = 'completed'
        or (
          status = 'reserved'
          and created_at > now() - make_interval(secs => p_stale_after_seconds)
        )
      );

    if v_used >= p_limit then
      return query select false, false, v_used, 0;
      return;
    end if;

    update public.generate_package_usage
      set status = 'reserved',
          created_at = now(),
          completed_at = null,
          updated_at = now()
    where user_id = p_user_id
      and request_id = p_request_id;

    return query select true, false, v_used + 1, greatest(p_limit - (v_used + 1), 0);
    return;
  end if;

  select count(*) into v_used
  from public.generate_package_usage
  where user_id = p_user_id
    and (
      status = 'completed'
      or (
        status = 'reserved'
        and created_at > now() - make_interval(secs => p_stale_after_seconds)
      )
    );

  if v_used >= p_limit then
    return query select false, false, v_used, 0;
    return;
  end if;

  insert into public.generate_package_usage (user_id, request_id, status)
  values (p_user_id, p_request_id, 'reserved');

  return query select true, false, v_used + 1, greatest(p_limit - (v_used + 1), 0);
end;
$$;

revoke all on function public.reserve_generate_package_usage(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_generate_package_usage(uuid, uuid, integer, integer) to service_role;

/*
  Confirms a reservation as finally, permanently used. Only flips a row
  that is still 'reserved' for this exact (user_id, request_id) - a
  no-op (zero rows affected) if the reservation was never made, already
  completed, or already released, so it is always safe to call.
*/
create or replace function public.complete_generate_package_usage(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.generate_package_usage
    set status = 'completed', completed_at = now(), updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and status = 'reserved';
$$;

revoke all on function public.complete_generate_package_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_generate_package_usage(uuid, uuid) to service_role;

/*
  Refunds a reservation after a final failure - the slot no longer counts
  toward the limit. Only flips a row that is still 'reserved' for this
  exact (user_id, request_id); a no-op otherwise, so always safe to call
  from a best-effort catch block.
*/
create or replace function public.release_generate_package_usage(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.generate_package_usage
    set status = 'released', updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and status = 'reserved';
$$;

revoke all on function public.release_generate_package_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_generate_package_usage(uuid, uuid) to service_role;

/*
  Read-only usage peek for the quota-status endpoint / UI "N remaining"
  display. Same counting rule as reserve_generate_package_usage's
  internal count, exposed without ever reserving anything.
*/
create or replace function public.get_generate_package_usage(
  p_user_id uuid,
  p_limit integer default 5,
  p_stale_after_seconds integer default 180
)
returns table (used integer, remaining integer)
language sql
security definer
set search_path = ''
as $$
  select
    count(*)::integer as used,
    greatest(p_limit - count(*)::integer, 0) as remaining
  from public.generate_package_usage
  where user_id = p_user_id
    and (
      status = 'completed'
      or (
        status = 'reserved'
        and created_at > now() - make_interval(secs => p_stale_after_seconds)
      )
    );
$$;

revoke all on function public.get_generate_package_usage(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_generate_package_usage(uuid, integer, integer) to service_role;
