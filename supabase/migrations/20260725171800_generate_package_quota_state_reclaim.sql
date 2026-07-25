/*
  Fixes two real gaps in reserve_generate_package_usage()/
  get_generate_package_usage() from 20260725073100_generate_package_
  lifetime_quota.sql:

  1. A 'reserved' row for a generation that actually succeeded (but whose
     complete_generate_package_usage() call failed to run at generation
     time) would eventually stop counting once it crossed the old purely
     time-based staleness window - silently turning a real, successful
     generation into a free one.

  2. That same purely time-based staleness window could also exclude a
     reservation that was still genuinely being processed (a slow
     request past the window), letting a new reservation take what
     should have been an already-occupied slot - allowing more than
     p_limit generations to eventually reach 'completed'.

  Fix: never exclude a 'reserved' row from the used-count by elapsed time
  alone. Instead, reconcile every 'reserved' row for the caller against
  the linked public.applications row (same user_id + generation_request_id,
  the same idempotency key applications.generation_request_id already
  uses) before counting anything:
    - applications.generation_status = 'succeeded' -> heal to 'completed'
      (this is exactly case 1 above, now self-correcting on the very next
      reservation/peek call for this user, not just on a manual retry).
    - applications.generation_status = 'failed'     -> reclaim as 'released'.
    - applications.generation_status = 'pending', or no applications row
      yet but still within p_stale_after_seconds -> still active, keeps
      counting, regardless of how long it's been (fixes case 2).
    - no applications row at all, older than p_stale_after_seconds -> the
      request never even reached the applications claim step (crashed
      before it); confirmed dead by absence of any processing evidence,
      not by time on its own - reclaim as 'released'.

  This reconcile step runs under the same per-user pg_advisory_xact_lock
  as the reservation decision itself, so it can never race against a
  concurrent reservation/completion/release for the same user.
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
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  -- Reconcile: heal rows whose linked application actually succeeded.
  update public.generate_package_usage as gpu
    set status = 'completed', completed_at = now(), updated_at = now()
  from public.applications as a
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and a.user_id = gpu.user_id
    and a.generation_request_id = gpu.request_id
    and a.generation_status = 'succeeded';

  -- Reconcile: reclaim rows whose linked application confirmedly failed.
  update public.generate_package_usage as gpu
    set status = 'released', updated_at = now()
  from public.applications as a
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and a.user_id = gpu.user_id
    and a.generation_request_id = gpu.request_id
    and a.generation_status = 'failed';

  -- Reconcile: reclaim rows that never even reached the applications
  -- claim step, once enough time has passed that they certainly should
  -- have (a live request creates that row within milliseconds of
  -- reserving, not minutes).
  update public.generate_package_usage as gpu
    set status = 'released', updated_at = now()
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and gpu.created_at <= now() - make_interval(secs => p_stale_after_seconds)
    and not exists (
      select 1
      from public.applications as a
      where a.user_id = gpu.user_id
        and a.generation_request_id = gpu.request_id
    );

  select status
    into v_status
  from public.generate_package_usage
  where user_id = p_user_id
    and request_id = p_request_id;

  if found then
    if v_status = 'completed' then
      select count(*) into v_used
      from public.generate_package_usage
      where user_id = p_user_id
        and status in ('completed', 'reserved');

      return query select true, true, v_used, greatest(p_limit - v_used, 0);
      return;
    end if;

    if v_status = 'reserved' then
      select count(*) into v_used
      from public.generate_package_usage
      where user_id = p_user_id
        and status in ('completed', 'reserved');

      return query select true, false, v_used, greatest(p_limit - v_used, 0);
      return;
    end if;

    -- v_status = 'released': this exact request_id was previously refunded.
    select count(*) into v_used
    from public.generate_package_usage
    where user_id = p_user_id
      and request_id <> p_request_id
      and status in ('completed', 'reserved');

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
    and status in ('completed', 'reserved');

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
  Same reconcile step, then a read-only count - kept in lockstep with
  reserve_generate_package_usage() so the displayed "N remaining" always
  matches what an actual reservation attempt would compute.
*/
create or replace function public.get_generate_package_usage(
  p_user_id uuid,
  p_limit integer default 5,
  p_stale_after_seconds integer default 180
)
returns table (used integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  update public.generate_package_usage as gpu
    set status = 'completed', completed_at = now(), updated_at = now()
  from public.applications as a
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and a.user_id = gpu.user_id
    and a.generation_request_id = gpu.request_id
    and a.generation_status = 'succeeded';

  update public.generate_package_usage as gpu
    set status = 'released', updated_at = now()
  from public.applications as a
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and a.user_id = gpu.user_id
    and a.generation_request_id = gpu.request_id
    and a.generation_status = 'failed';

  update public.generate_package_usage as gpu
    set status = 'released', updated_at = now()
  where gpu.user_id = p_user_id
    and gpu.status = 'reserved'
    and gpu.created_at <= now() - make_interval(secs => p_stale_after_seconds)
    and not exists (
      select 1
      from public.applications as a
      where a.user_id = gpu.user_id
        and a.generation_request_id = gpu.request_id
    );

  select count(*) into v_used
  from public.generate_package_usage
  where user_id = p_user_id
    and status in ('completed', 'reserved');

  return query select v_used, greatest(p_limit - v_used, 0);
end;
$$;

revoke all on function public.get_generate_package_usage(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_generate_package_usage(uuid, integer, integer) to service_role;
