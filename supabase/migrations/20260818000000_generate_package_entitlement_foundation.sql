-- ============================================================
-- Generate Package monthly entitlement foundation (Stage 1).
--
-- PURPOSE
--   Today a Generate Package free allowance is owned by auth.users.id, so
--   deleting an account and re-registering the same address inside the same
--   UTC month produces a brand-new uuid with no period row and therefore a
--   full fresh allowance. This migration adds the durable ownership layer
--   that closes that, WITHOUT touching anything the currently deployed
--   application calls.
--
-- ADDITIVE AND DORMANT
--   Every object here is new. No existing table, function, signature, grant
--   or row is altered or dropped. The deployed app keeps calling
--   reserve_generate_package_usage / get_generate_package_usage /
--   complete_generate_package_usage / release_generate_package_usage exactly
--   as it does now, and those keep behaving exactly as they do now. Nothing
--   below executes until Stage 2 wires the application to it, so this
--   migration is safe to apply well before that deploy.
--
-- THE ONE INVARIANT THAT MATTERS
--   PLAN LIMIT  is resolved from the CURRENT AUTH USER  (subscriptions,
--               admin_user_quota_overrides - both keyed by that user_id)
--   USAGE       is counted against the FOUNDING ENTITLEMENT OWNER
--               (period row, reservation ledger, advisory lock)
--
--   These two must never be conflated. resolve_generate_package_quota_limit()
--   reads admin_user_quota_overrides AND subscriptions by its p_user_id
--   argument, so passing a founding owner into it would silently strip a
--   paying user's plan and any operator override at once, downgrading them to
--   Free. That is why the wrappers below do NOT delegate to the existing
--   reserve_/get_ functions (each of those resolves the limit from whatever
--   id it is handed) and instead inline the reservation logic with the split
--   applied correctly.
--
-- WHAT IS DELIBERATELY NOT HERE
--   No email, normalized or otherwise. No HMAC secret - the application
--   computes the digest and this database only ever receives an opaque hex
--   string (see lib/security/generatePackageEntitlementIdentity.ts). No plan,
--   subscription or limit is stored on a claim. No auth.users foreign key, so
--   a claim survives the account deletion it exists to outlive. No scheduling
--   of the purge routine. No backfill of any kind.
--
--   The uploaded-resume cap (MAX_UPLOADED_RESUMES / enforce_resume_upload_limit)
--   is a completely separate, account-scoped feature and is untouched.
-- ============================================================

-- ============================================================
-- 1. Claim store.
--
--    One row per verified-email identity. founding_owner_id is the auth uuid
--    of the FIRST account to establish the claim; it stays fixed afterwards,
--    which is what lets a deleted-and-recreated account resolve back to the
--    original month's counters.
--
--    Choosing the founding account's own uuid as the owner - rather than
--    minting a fresh id space - is what makes rollout need no backfill: an
--    existing user's first claim points at their current uuid, and their
--    existing generate_package_quota_periods rows are already keyed that way,
--    so this month's usage carries over untouched.
--
--    No foreign key to auth.users, matching generate_package_quota_periods /
--    _reservations / subscriptions, all of which are deliberately FK-free.
--    A cascade here would delete the claim at exactly the moment it becomes
--    necessary.
-- ============================================================
create table if not exists public.generate_package_entitlement_claims (
  id bigint generated always as identity primary key,
  email_hmac text not null,
  founding_owner_id uuid not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint generate_package_entitlement_claims_email_hmac_key unique (email_hmac),
  constraint generate_package_entitlement_claims_email_hmac_shape_check
    check (email_hmac ~ '^[0-9a-f]{64}$')
);

comment on table public.generate_package_entitlement_claims is
  'Durable owner of a Generate Package monthly allowance. Maps an opaque keyed digest of a verified, normalized email to the auth uuid of the first account that claimed it. Deliberately survives account deletion so a same-month delete/recreate cannot reset the allowance; deliberately holds no email, no plan and no limit. Read/written only through SECURITY DEFINER functions in this file.';

comment on column public.generate_package_entitlement_claims.email_hmac is
  'HMAC-SHA256 hex digest computed by the application (lib/security/generatePackageEntitlementIdentity.ts). The database never sees the address or the key, and the check constraint only enforces the digest shape.';

comment on column public.generate_package_entitlement_claims.founding_owner_id is
  'auth uuid of the first account to establish this claim. Never reassigned. Usage periods, reservations and the advisory lock all key on this, never on the current auth user.';

comment on column public.generate_package_entitlement_claims.last_used_at is
  'Stamped by the column DEFAULT when the claim is first created - which happens on the first quota-ENFORCEMENT attempt, including one denied for being already at the limit - and advanced thereafter only when a reservation actually succeeds. Never advanced by a claim lookup, a usage read, login, signup or a page view. Monotonic: a later release/refund never rolls it backward, since it records that the entitlement was active during that UTC month, not how many slots survived. Drives purge eligibility. The default matters for correctness: a legacy account already at 3/3 whose first enforced attempt is denied must still record the current month here, or the claim could be purged mid-month and a delete/recreate would hand out a fresh allowance.';

create index if not exists generate_package_entitlement_claims_last_used_idx
  on public.generate_package_entitlement_claims (last_used_at);

alter table public.generate_package_entitlement_claims enable row level security;
revoke all on public.generate_package_entitlement_claims from anon, authenticated;

-- ============================================================
-- 2. Atomic claim resolution.
--
--    The race this closes: two accounts sharing one verified address both
--    reach their first generation, both see no claim, and both elect
--    themselves founder - yielding two full allowances. A read-then-write in
--    application code cannot prevent that.
--
--    The unique constraint on email_hmac is the serialization point. The
--    loser of the insert race falls through to the select and adopts the
--    winner's founding owner, so exactly one founder exists either way.
-- ============================================================
create or replace function public.resolve_generate_package_entitlement_owner(
  p_email_hmac text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if p_email_hmac is null or p_user_id is null then
    raise exception 'entitlement owner resolution requires both an email hmac and a user id';
  end if;

  insert into public.generate_package_entitlement_claims (email_hmac, founding_owner_id)
  values (p_email_hmac, p_user_id)
  on conflict (email_hmac) do nothing
  returning founding_owner_id into v_owner;

  if v_owner is null then
    -- Either a pre-existing claim, or this transaction lost the insert race.
    select c.founding_owner_id into v_owner
    from public.generate_package_entitlement_claims as c
    where c.email_hmac = p_email_hmac;
  end if;

  if v_owner is null then
    -- Unreachable in practice; fail closed rather than let the caller
    -- proceed with a null owner and fall back to a fresh allowance.
    raise exception 'entitlement owner could not be resolved';
  end if;

  return v_owner;
end;
$$;

revoke all on function public.resolve_generate_package_entitlement_owner(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_generate_package_entitlement_owner(text, uuid) to service_role;

-- ============================================================
-- 3. Entitlement-aware reservation.
--
--    Mirrors reserve_generate_package_usage's semantics exactly - same
--    idempotency by request_id, same 'released' revival, same reserved+
--    completed comparison, same advisory lock discipline - with two
--    differences:
--
--      the limit comes from p_user_id      (current auth account)
--      everything else keys on v_owner     (founding entitlement owner)
--
--    Not implemented by calling reserve_generate_package_usage(v_owner, ...):
--    that function resolves the limit from the id it is given, so delegating
--    would resolve the FOUNDING OWNER's plan and silently downgrade a paying
--    user whose subscription sits on their current account.
--
--    p_limit is accepted and ignored, exactly as the existing function does,
--    so a Stage 2 caller can pass the same display constant without meaning.
-- ============================================================
create or replace function public.reserve_generate_package_usage_for_entitlement(
  p_user_id uuid,
  p_email_hmac text,
  p_request_id uuid,
  p_limit integer default 5,
  p_stale_after_seconds integer default 180
)
returns table (
  reserved boolean,
  already_completed boolean,
  used integer,
  remaining integer,
  entitlement_owner_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_limit integer;
  v_status text;
  v_used integer;
begin
  -- Fail closed: any inability to establish the durable owner must stop the
  -- request, never continue under the current auth uuid - that fallback is
  -- exactly the fresh-allowance bypass this whole design exists to prevent.
  v_owner := public.resolve_generate_package_entitlement_owner(p_email_hmac, p_user_id);

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 1));

  select gp.period_start, gp.period_end
    into v_period_start, v_period_end
  from public.generate_package_current_period() as gp;

  -- CURRENT AUTH USER - never v_owner. See this file's header.
  v_limit := public.resolve_generate_package_quota_limit(p_user_id);

  perform public.ensure_generate_package_quota_period(v_owner, v_period_start, v_period_end);
  perform public.reclaim_generate_package_quota_reservations(v_owner, v_period_start, p_stale_after_seconds);

  -- Not period-scoped, matching the existing function: request_id is minted
  -- once per generation attempt, so a duplicate call must find its row
  -- whichever period that row currently belongs to.
  select r.status into v_status
  from public.generate_package_quota_reservations as r
  where r.user_id = v_owner and r.request_id = p_request_id;

  if v_status = 'completed' then
    select (qp.reserved_count + qp.completed_count) into v_used
    from public.generate_package_quota_periods as qp
    where qp.user_id = v_owner and qp.period_start = v_period_start;

    v_used := coalesce(v_used, 0);
    return query select true, true, v_used, greatest(v_limit - v_used, 0), v_owner;
    return;
  end if;

  if v_status = 'reserved' then
    select (qp.reserved_count + qp.completed_count) into v_used
    from public.generate_package_quota_periods as qp
    where qp.user_id = v_owner and qp.period_start = v_period_start;

    v_used := coalesce(v_used, 0);
    return query select true, false, v_used, greatest(v_limit - v_used, 0), v_owner;
    return;
  end if;

  -- 'released', or NULL for a genuinely new request_id.
  select (qp.reserved_count + qp.completed_count) into v_used
  from public.generate_package_quota_periods as qp
  where qp.user_id = v_owner and qp.period_start = v_period_start;

  v_used := coalesce(v_used, 0);

  if v_used >= v_limit then
    return query select false, false, v_used, 0, v_owner;
    return;
  end if;

  if v_status is null then
    insert into public.generate_package_quota_reservations
      (user_id, request_id, period_start, period_end, status)
    values (v_owner, p_request_id, v_period_start, v_period_end, 'reserved');
  else
    update public.generate_package_quota_reservations
      set status = 'reserved',
          period_start = v_period_start,
          period_end = v_period_end,
          created_at = now(),
          completed_at = null,
          updated_at = now()
    where user_id = v_owner and request_id = p_request_id;
  end if;

  update public.generate_package_quota_periods
    set reserved_count = reserved_count + 1,
        updated_at = now()
  where user_id = v_owner and period_start = v_period_start;

  -- Only on a genuine reservation. Monotonic - never moved backward by a
  -- later release, and never advanced by a lookup or a usage read.
  update public.generate_package_entitlement_claims
    set last_used_at = now()
  where email_hmac = p_email_hmac;

  return query select true, false, v_used + 1, greatest(v_limit - (v_used + 1), 0), v_owner;
end;
$$;

revoke all on function public.reserve_generate_package_usage_for_entitlement(uuid, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_generate_package_usage_for_entitlement(uuid, text, uuid, integer, integer) to service_role;

-- ============================================================
-- 4. Entitlement-aware usage read (display only).
--
--    Same split as the reservation path: limit from the current auth user,
--    counters from the founding owner. Inlined for the same reason as above -
--    get_generate_package_usage() resolves the limit from the id it is handed.
--
--    STRICTLY READ-ONLY WITH RESPECT TO IDENTITY. An earlier draft called
--    resolve_generate_package_entitlement_owner() here, which inserts a claim
--    when none exists - so merely loading the dashboard's "N remaining" hint
--    would have minted an anti-abuse record for every user, including users who
--    never touch the metered feature. That contradicts this design's rule that
--    a claim is created only by an actual quota-enforcement attempt, and its
--    whole privacy rationale. The lookup below is a plain select: it can find a
--    claim, never create one, and never advances last_used_at.
--
--    ensure_generate_package_quota_period() is deliberately NOT called here
--    either, unlike the legacy get_generate_package_usage(). Creating a
--    current-month period row for the owner would block that claim's purge (see
--    section 6's NOT EXISTS predicate), so a passive status read could extend
--    retention by a month. The read does not need the row: a missing period
--    coalesces to 0. reclaim_generate_package_quota_reservations() IS still
--    called, because it only ever UPDATEs existing rows - it never inserts a
--    period - so it keeps the displayed number honest without creating anything.
--
--    FALLBACK WHEN NO CLAIM EXISTS: report against the current auth user's own
--    period. This is truthful for a legacy or pre-first-use account, whose
--    usage today is keyed to their own uuid, and it grants nothing - it is a
--    display number only. This fallback is valid EXCLUSIVELY for reads.
--    The reservation path must never fall back this way: doing so is precisely
--    the fresh-allowance bypass this whole design exists to prevent.
-- ============================================================
create or replace function public.get_generate_package_usage_for_entitlement(
  p_user_id uuid,
  p_email_hmac text,
  p_limit integer default 5,
  p_stale_after_seconds integer default 180
)
returns table (
  used integer,
  remaining integer,
  entitlement_owner_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_period_start timestamptz;
  v_limit integer;
  v_used integer;
begin
  -- Read-only lookup. No insert, no update: a status read must never create
  -- or touch an entitlement claim.
  select c.founding_owner_id into v_owner
  from public.generate_package_entitlement_claims as c
  where c.email_hmac = p_email_hmac;

  -- Display-only fallback; never used for a reservation decision.
  v_owner := coalesce(v_owner, p_user_id);

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 1));

  select gp.period_start into v_period_start
  from public.generate_package_current_period() as gp;

  -- CURRENT AUTH USER - never v_owner. See this file's header.
  v_limit := public.resolve_generate_package_quota_limit(p_user_id);

  perform public.reclaim_generate_package_quota_reservations(v_owner, v_period_start, p_stale_after_seconds);

  select (qp.reserved_count + qp.completed_count) into v_used
  from public.generate_package_quota_periods as qp
  where qp.user_id = v_owner and qp.period_start = v_period_start;

  v_used := coalesce(v_used, 0);

  return query select v_used, greatest(v_limit - v_used, 0), v_owner;
end;
$$;

revoke all on function public.get_generate_package_usage_for_entitlement(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_generate_package_usage_for_entitlement(uuid, text, integer, integer) to service_role;

-- ============================================================
-- 5. Completion / release: DELIBERATELY NO NEW FUNCTION.
--
--    An earlier draft of this migration added
--    complete_/release_generate_package_usage_by_request(p_request_id), which
--    located the reservation by request_id ALONE and took the owner from the
--    matched row. That was unsafe and has been removed rather than shipped.
--
--    WHY IT WAS UNSAFE: request_id is not globally unique, in the database or
--    in the application. The table's constraint is UNIQUE(user_id, request_id),
--    so two owners may legitimately hold the same request_id - and
--    app/api/generate-package/route.ts takes generationRequestId straight from
--    the client request body, validating only its UUID *shape*. A caller can
--    therefore choose the value freely. With duplicates present, plpgsql
--    SELECT ... INTO (non-STRICT, no ORDER BY) silently takes an arbitrary row,
--    so such a helper could decrement one owner's reserved_count while
--    crediting another's completed_count.
--
--    WHAT STAGE 2 MUST DO INSTEAD: call the EXISTING, unchanged
--        public.complete_generate_package_usage(p_user_id, p_request_id)
--        public.release_generate_package_usage(p_user_id, p_request_id)
--    passing the ENTITLEMENT OWNER as the first argument - the value
--    reserve_generate_package_usage_for_entitlement() returns as
--    entitlement_owner_id. Those functions already scope every statement by
--    (user_id, request_id), already take the advisory lock on that same id, and
--    already act on the reservation row's OWN stored period_start rather than
--    the current period. Passing the owner therefore gives a deterministic,
--    single-row operation with correct counter arithmetic.
--
--    That reuse also keeps every property the removed helpers were meant to
--    provide: no email is re-resolved, no live auth account is required, no
--    surviving claim is needed and no current-month assumption is made - so
--    completion still works across account deletion, address change, month
--    rollover, claim purge and worker retries.
--
--    Deliberately NOT re-implemented under a safer name: doing so would
--    duplicate the counter arithmetic that already exists and is exercised in
--    production, creating two copies that must stay in sync. Reuse is the
--    smaller and safer correction.
--
--    A global UNIQUE(request_id) was also considered and rejected for Stage 1:
--    it would alter a live existing table and could fail outright on
--    pre-existing duplicate rows, which is neither additive nor backward
--    compatible.
-- ============================================================

-- ============================================================
-- 6. Purge routine. DEFINED ONLY - never scheduled, never run here.
--
--    THE INVARIANT: a claim must never be purged while it still anchors
--    CURRENT-month usage. The naive rule "month-end + 24h" fails this. If a
--    claim last used on Aug 31 is reused on Sep 1 and then purged on Sep 2,
--    September's usage stays attributed to the old founding owner while the
--    next generation creates a fresh claim under the current uuid with a zero
--    counter - handing out a fourth generation that month.
--
--    So eligibility is measured from the last month of USE, and the decisive
--    condition is the direct check that no current-month period row exists for
--    the owner. The two timestamp conditions are cheap pre-filters; the NOT
--    EXISTS is the actual invariant, and it still holds even if last_used_at
--    were ever left stale by a bug - a failure mode that would otherwise
--    inflate quota silently.
--
--    Worked examples:
--      last used August only        -> eligible from Sep 2 00:00 UTC
--      used again on Sep 1          -> a September period exists -> retained
--                                      through September -> eligible Oct 2
--
--    The 24h grace governs purge eligibility ONLY. It does not touch
--    generate_package_current_period(), so the monthly allowance still resets
--    at 00:00 UTC on the 1st regardless.
--
--    Quota period/reservation rows are intentionally NOT purged here. Once a
--    claim is gone those rows are inert - nothing looks them up - and their
--    cleanup is a separate privacy/hygiene decision, not a correctness one.
-- ============================================================
create or replace function public.purge_generate_package_entitlement_claims(
  p_grace_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start timestamptz;
  v_deleted integer;
begin
  select gp.period_start into v_month_start
  from public.generate_package_current_period() as gp;

  if now() < v_month_start + make_interval(hours => p_grace_hours) then
    return 0;
  end if;

  delete from public.generate_package_entitlement_claims as c
  where c.last_used_at < v_month_start
    and not exists (
      select 1
      from public.generate_package_quota_periods as qp
      where qp.user_id = c.founding_owner_id
        and qp.period_start = v_month_start
    );

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke all on function public.purge_generate_package_entitlement_claims(integer) from public, anon, authenticated;
grant execute on function public.purge_generate_package_entitlement_claims(integer) to service_role;
