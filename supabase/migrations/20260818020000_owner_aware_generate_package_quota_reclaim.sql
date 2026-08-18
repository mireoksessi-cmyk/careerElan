-- ============================================================
-- Owner-aware reconciliation for Generate Package quota reservations.
--
-- THE DEFECT THIS CLOSES
--   Since Stage 2B a reservation is keyed to the FOUNDING ENTITLEMENT OWNER
--   (generate_package_quota_reservations.user_id), while the application row
--   it belongs to is still owned by the CURRENT AUTH USER
--   (applications.user_id), with the owner recorded separately in
--   applications.entitlement_owner_id.
--
--   For the ordinary case those two ids are equal, so the previous
--   reconciliation logic (20260725171800) matched fine. For a RECREATED
--   ACCOUNT - the exact case the entitlement design exists to handle - they
--   differ:
--
--     reservation.user_id            = A  (founding owner)
--     application.user_id            = B  (new auth uuid)
--     application.entitlement_owner_id = A
--
--   Every branch below used to match on `a.user_id = r.user_id`, i.e. B = A,
--   which can never be true. The consequences were, in order of severity:
--
--     1. The orphan branch's NOT EXISTS found no application for owner A and
--        therefore classified a REAL, SUCCESSFUL generation as an orphaned
--        reservation, releasing it after the stale threshold - refunding the
--        generation. That is precisely the free-quota bypass the entitlement
--        work exists to prevent.
--     2. The heal branch could never mark a succeeded generation 'completed'.
--     3. The failed branch could never release a failed generation.
--
-- THE ONLY SEMANTIC CHANGE
--   Application ownership is now matched as
--
--     coalesce(a.entitlement_owner_id, a.user_id) = r.user_id
--
--   which is the SQL form of the completion-time fallback Stage 2A already
--   established in lib/generatePackage/generateCore.ts
--   (`row.entitlement_owner_id ?? userId`): resolve the id a row was actually
--   RESERVED under. NULL means the pre-Stage-2B legacy model, where the
--   reservation genuinely belongs to applications.user_id, so coalesce()
--   degrades to exactly the previous behaviour and no historical row changes
--   meaning. This is a completion-time fallback only - it is NOT, and must
--   never become, a reservation-time fallback onto a fresh auth uuid.
--
--   Everything else is copied verbatim from the authoritative definition in
--   20260725171800_generate_package_quota_state_reclaim.sql: the same three
--   branches, the same advisory lock, the same period scoping, the same
--   status semantics, the same stale-threshold rule, and the same counter
--   arithmetic. No opportunistic refactor.
--
--   The orphan branch's NOT EXISTS is the load-bearing one: leaving it
--   owner-blind while fixing only heal/release would still let a recreated
--   account's successful generation be released as an orphan, so all three
--   branches use the identical predicate.
--
-- WHY CREATE OR REPLACE
--   The signature (uuid, timestamptz, integer) and `returns void` are
--   unchanged, so PostgreSQL replaces the body in place - no DROP is needed
--   and no dependent grant is invalidated. SECURITY DEFINER, `search_path`
--   and the existing privileges are restated below exactly as they were.
--
-- No table, column, index, data or unrelated object is touched by this
-- migration, and no historical migration is edited.
-- ============================================================
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
      and coalesce(a.entitlement_owner_id, a.user_id) = r.user_id
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
      and coalesce(a.entitlement_owner_id, a.user_id) = r.user_id
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
  --
  -- The ownership predicate here must match the two branches above exactly:
  -- an application whose user_id differs from the reservation owner but
  -- whose entitlement_owner_id equals it DOES exist, and must never be
  -- treated as absent.
  with orphaned as (
    update public.generate_package_quota_reservations as r
      set status = 'released', updated_at = now()
    where r.user_id = p_user_id
      and r.period_start = p_period_start
      and r.status = 'reserved'
      and r.created_at <= now() - make_interval(secs => p_stale_after_seconds)
      and not exists (
        select 1 from public.applications as a
        where coalesce(a.entitlement_owner_id, a.user_id) = r.user_id
          and a.generation_request_id = r.request_id
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
