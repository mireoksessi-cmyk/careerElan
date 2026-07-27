/*
  Upgrades public.reclaim_generate_package_quota_reservations() (defined
  in 20260725073100_generate_package_lifetime_quota.sql, this migration's
  companion, rewritten alongside this file for the monthly/configurable
  quota redesign) from a purely time-based reclaim rule to one that
  reconciles against the linked public.applications row first. This file
  only needs to CREATE OR REPLACE that one helper - reserve_generate_
  package_usage() and get_generate_package_usage() already call it by
  name and need no changes of their own, which is the intended
  improvement over this pair's original relationship (which had to
  redefine both large functions in full just to change their reconcile
  logic inline).

  Two real gaps this closes in the companion migration's simple
  time-based rule:

  1. A 'reserved' row for a generation that actually succeeded (but whose
     complete_generate_package_usage() call failed to run or persist at
     generation time) would eventually be reclaimed by elapsed time alone
     - silently turning a real, successful generation into a free one
     instead of crediting it as completed.

  2. That same purely time-based rule could also reclaim a reservation
     that was still genuinely being processed (a slow request past the
     window), letting a new reservation take what should have been an
     already-occupied slot - allowing more generations than the plan
     limit to eventually reach 'completed'.

  Fix: before reclaiming anything by elapsed time, reconcile every
  'reserved' row for the caller IN THE GIVEN PERIOD against the linked
  public.applications row (same user_id + generation_request_id, the
  same idempotency key applications.generation_request_id already uses):
    - applications.generation_status = 'succeeded' -> heal to 'completed'
      (this is case 1 above, now self-correcting on the very next
      reserve/get-usage call for this user, not just on a manual retry).
    - applications.generation_status = 'failed'     -> reclaim as
      'released'.
    - applications.generation_status = 'pending', or no applications row
      yet but still within p_stale_after_seconds -> still active, kept
      as-is regardless of how long it's been (fixes case 2 - elapsed
      time alone is never sufficient to reclaim an actively-processing
      row).
    - no applications row at all, older than p_stale_after_seconds -> the
      request never even reached the applications claim step (crashed
      before it); confirmed dead by absence of any processing evidence,
      not by time on its own - reclaimed as 'released'.

  Every branch below only ever touches 'reserved' rows whose period_start
  equals the p_period_start this call was scoped to (passed in by
  reserve_generate_package_usage()/get_generate_package_usage() as the
  CURRENT UTC-month period) - a stale or abandoned reservation belonging
  to an earlier period is never reached by a call scoped to the current
  one, so reclaiming prior-month rows (were this function ever invoked
  for one) can never adjust the current month's aggregate counters, and
  vice versa. Each branch adjusts public.generate_package_quota_periods'
  reserved_count/completed_count by exactly the number of rows it just
  changed (captured via UPDATE ... RETURNING, never inferred after the
  fact), so the aggregate table never drifts from the ledger it is
  derived from. Runs under the same per-user pg_advisory_xact_lock as the
  reservation decision itself (re-acquired here too, safely re-entrant
  within one transaction), so reconciliation can never race a concurrent
  reservation/completion/release for the same user.
*/

create or replace function public.reclaim_generate_package_quota_reservations(
  p_user_id uuid,
  p_period_start timestamptz,
  p_stale_after_seconds integer default 180
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_healed_count integer;
  v_failed_count integer;
  v_orphaned_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  -- Heal: linked application actually succeeded.
  with healed as (
    update public.generate_package_quota_reservations as r
      set status = 'completed', completed_at = now(), updated_at = now()
    from public.applications as a
    where r.user_id = p_user_id
      and r.period_start = p_period_start
      and r.status = 'reserved'
      and a.user_id = r.user_id
      and a.generation_request_id = r.request_id
      and a.generation_status = 'succeeded'
    returning 1
  )
  select count(*) into v_healed_count from healed;

  if v_healed_count > 0 then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - v_healed_count, 0),
          completed_count = completed_count + v_healed_count,
          updated_at = now()
    where user_id = p_user_id and period_start = p_period_start;
  end if;

  -- Reclaim: linked application confirmedly failed.
  with failed as (
    update public.generate_package_quota_reservations as r
      set status = 'released', updated_at = now()
    from public.applications as a
    where r.user_id = p_user_id
      and r.period_start = p_period_start
      and r.status = 'reserved'
      and a.user_id = r.user_id
      and a.generation_request_id = r.request_id
      and a.generation_status = 'failed'
    returning 1
  )
  select count(*) into v_failed_count from failed;

  if v_failed_count > 0 then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - v_failed_count, 0),
          updated_at = now()
    where user_id = p_user_id and period_start = p_period_start;
  end if;

  -- Reclaim: no linked application row at all, and old enough that a
  -- still-live request certainly would have created one by now (a live
  -- request reaches the applications claim step within milliseconds of
  -- reserving, not minutes) - confirmed dead by absence of processing
  -- evidence, not by elapsed time alone.
  with orphaned as (
    update public.generate_package_quota_reservations as r
      set status = 'released', updated_at = now()
    where r.user_id = p_user_id
      and r.period_start = p_period_start
      and r.status = 'reserved'
      and r.created_at <= now() - make_interval(secs => p_stale_after_seconds)
      and not exists (
        select 1 from public.applications as a
        where a.user_id = r.user_id and a.generation_request_id = r.request_id
      )
    returning 1
  )
  select count(*) into v_orphaned_count from orphaned;

  if v_orphaned_count > 0 then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - v_orphaned_count, 0),
          updated_at = now()
    where user_id = p_user_id and period_start = p_period_start;
  end if;
end;
$$;

revoke all on function public.reclaim_generate_package_quota_reservations(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclaim_generate_package_quota_reservations(uuid, timestamptz, integer) to service_role;
