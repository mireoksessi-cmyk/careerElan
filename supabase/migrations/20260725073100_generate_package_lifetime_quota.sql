/*
  Generate Package quota - configurable MONTHLY policy, replacing the
  lifetime (all-time, 5-forever) policy this file originally defined.

  Neither this file nor 20260725171800_generate_package_quota_state_reclaim.sql
  has ever been applied to Production (confirmed via the project's own
  supabase_migrations.schema_migrations history and a direct check for the
  objects below), so both are rewritten in place here rather than
  superseded by new migration files.

  Product policy (see public.quota_plans below for the actual seed row
  values - never hardcoded into a function body):
    - free: 3 successful package generations per UTC calendar month
    - pro:  50 successful package generations per UTC calendar month
    - future plans/limits: a config-table INSERT/UPDATE, never a schema
      or function change

  COMPATIBILITY - these four RPC names/signatures are called by
  unmodifiable application code (app/api/generate-package/route.ts,
  app/api/generate-package/usage/route.ts, and
  lib/generatePackage/generateCore.ts) and are kept exactly as-is:
    - reserve_generate_package_usage(p_user_id, p_request_id, p_limit default 5, p_stale_after_seconds default 180)
    - complete_generate_package_usage(p_user_id, p_request_id)
    - release_generate_package_usage(p_user_id, p_request_id)
    - get_generate_package_usage(p_user_id, p_limit default 5, p_stale_after_seconds default 180)

  p_limit is a LEGACY parameter now: app/api/generate-package/route.ts and
  app/api/generate-package/usage/route.ts both still pass
  p_limit: GENERATE_PACKAGE_LIFETIME_LIMIT (=3) on every call, and cannot
  be changed in this task. Its value is deliberately never read by any
  function body below - the effective limit always comes from
  resolve_generate_package_quota_limit(), which resolves the user's
  CURRENT plan from public.quota_plans. Keeping the parameter (rather
  than dropping it) is what lets the existing call sites keep working
  unchanged; it can be removed in a future migration once application
  code stops passing it. p_stale_after_seconds is NOT legacy - neither
  call site passes it, so its default value here remains the one place
  that timeout is actually configured (see the reclaim function below).

  HOW A USER'S PLAN IS RESOLVED (Stripe-ready architecture):

    User -> public.subscriptions -> plan_key -> public.quota_plans
         -> monthly_generation_limit -> quota functions

  public.subscriptions (new table, see section 2 below) is the single
  source of truth for "what is this user currently subscribed to" -
  public.profiles.plan is deliberately NOT used for this (an earlier
  version of this migration did; this rewrite moves off of it entirely,
  since Stripe subscription state does not naturally live on a generic
  profile row and would create a second, competing source of truth once
  real Stripe webhooks exist). A user with no subscriptions row at all -
  which is every existing user today, since this table starts empty and
  is never backfilled - is exactly and intentionally the "Free" case:
  resolve_generate_package_quota_limit() below treats "no row" the same
  as "found a row, but it doesn't grant a paid plan," so no seeding or
  migration of existing users is needed for them to correctly get the
  Free limit.

  Resolution fail-safe (see resolve_generate_package_quota_limit): no
  subscription row, a status that isn't currently plan-granting (see
  subscriptions.status below), or a plan_key that turns out disabled in
  quota_plans, all fail OPEN to the 'free' plan's own configured limit
  (never fail closed / block generation outright over a missing or
  ambiguous subscription state) - chosen to match this codebase's
  consistent preference elsewhere for graceful degradation over hard
  failure (OAuth consent recording, background-worker enqueue failures,
  etc. all follow the same pattern). Only if even the 'free' row itself
  is missing or disabled (operator error emptying the config table) does
  resolution fall back to a hardcoded 0 - denying rather than silently
  granting unlimited generations, as the one appropriate fail-closed
  case.

  STRIPE INTEGRATION SURFACE: a future Stripe webhook handler only ever
  needs to write to public.subscriptions - specifically plan_key, status,
  stripe_customer_id, stripe_subscription_id, and current_period_end.
  Nothing below (the period/ledger tables, or any of the 8 functions)
  needs to change to support that; resolve_generate_package_quota_limit()
  already reads subscriptions live on every quota check.

  MONTHLY RESET: UTC calendar-month boundaries, computed on every call by
  generate_package_current_period() - no cron job, no stored "current
  period" pointer anywhere. A user's first reserve/get-usage call in a
  new UTC month lazily creates that month's public.generate_package_quota_periods
  row (ensure_generate_package_quota_period()) with a fresh 0/0 count;
  nothing needs to "roll over" or be reset by an external process.

  DATA MODEL (two tables, replacing the prior single-table design):
    - public.generate_package_quota_periods: the "one record per user per
      month" aggregate this task's spec calls for - reserved_count/
      completed_count only, no monthly_limit column (the limit is always
      resolved live from plan config, so a mid-month plan
      upgrade/downgrade takes effect immediately with no data migration -
      see the functions' own comments for the exact behavior).
    - public.generate_package_quota_reservations: the per-request-id
      ledger (renamed from this file's prior generate_package_usage
      table, same (user_id, request_id) idempotency key and
      reserved/completed/released lifecycle) - this is what makes
      reserve/complete/release/reclaim safe against duplicate calls,
      retried worker callbacks, and complete-after-release/
      release-after-complete. An aggregate counter table alone cannot
      provide this; a per-request ledger is required and is kept exactly
      because the counters above are derived from it, not instead of it.

  CONCURRENCY: identical strategy to the design being replaced -
  pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1)) (seed 1,
  distinct from enforce_resume_upload_limit()'s seed 0), held for the
  full duration of each function so two simultaneous requests for the
  same user's last remaining slot cannot both see "under limit" and both
  succeed.

  SECURITY: every table below has RLS enabled with zero policies
  (default-deny) and ALL revoked from anon/authenticated - the only way
  in is through the SECURITY DEFINER functions, each with
  SET search_path = '' and fully schema-qualified references, granted to
  service_role only. auth.uid() is deliberately NOT used to derive the
  acting user in any function here: application code calls these
  exclusively via the service_role client with an explicitly passed
  p_user_id already taken from that request's own verified
  supabase.auth.getUser() session (never client-supplied) - matching the
  design this replaces. Switching to auth.uid() would silently break
  every call site, since service_role requests have no such session
  context to read it from.
*/

-- ============================================================
-- 1. Plan configuration - the ONLY place a plan's numeric limit lives.
-- ============================================================
create table if not exists public.quota_plans (
  plan_key text primary key,
  display_name text not null,
  monthly_generation_limit integer not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quota_plans_plan_key_lowercase_check check (plan_key = lower(plan_key)),
  constraint quota_plans_plan_key_nonempty_check check (btrim(plan_key) <> ''),
  constraint quota_plans_monthly_limit_check check (monthly_generation_limit >= 0)
);

comment on table public.quota_plans is
  'Configurable subscription-plan quota settings. Add a plan or change a limit by inserting/updating a row here - never by editing a function body. No direct grants to anon/authenticated (RLS enabled, zero policies) - readable only through the SECURITY DEFINER functions below, or via service_role/dashboard SQL.';

-- ON CONFLICT DO NOTHING, not DO UPDATE: seeding must never silently
-- clobber a limit an operator has since customized (e.g. free 3 -> 10).
insert into public.quota_plans (plan_key, display_name, monthly_generation_limit, enabled)
values
  ('free', 'Free', 3, true),
  ('pro', 'Pro', 50, true)
on conflict (plan_key) do nothing;

alter table public.quota_plans enable row level security;
revoke all on public.quota_plans from anon, authenticated;

-- ============================================================
-- 2. Subscriptions - the single source of truth for a user's current
--    plan, designed to be written directly by a future Stripe webhook
--    handler with no other schema/function change required.
--
--    One row per user (UNIQUE(user_id)): this product gives each user
--    exactly one active subscription at a time, so "the current plan"
--    never needs to pick among multiple rows - simpler and safer than
--    modeling subscription history here (Stripe itself remains the
--    historical record; this table only mirrors current state).
--
--    status uses Stripe's own subscription status vocabulary verbatim
--    (https://stripe.com/docs/api/subscriptions/object) so a webhook
--    handler can write Stripe's status string through unchanged, with no
--    translation layer. Only 'active' and 'trialing' are treated as
--    plan-granting by resolve_generate_package_quota_limit() below - a
--    trialing user gets their trial plan's limit, but 'past_due',
--    'unpaid', 'canceled', 'incomplete', 'incomplete_expired', and
--    'paused' all fall back to Free (payment uncertainty must never
--    silently grant paid quota - fail toward Free, never toward Pro).
--
--    plan_key has a normal (validating) FK to quota_plans, not NOT
--    VALID - this table starts empty, so there is no pre-existing-data
--    risk the way public.profiles carried in an earlier version of this
--    design.
--
--    provider records HOW a subscription came to exist (a real Stripe
--    subscription, a manually granted account, or a promotional grant),
--    for admin/audit/reporting purposes only. It is metadata, never an
--    input to quota eligibility: resolve_generate_package_quota_limit()
--    below reads only plan_key and status, exactly as before this
--    column was added - a 'manual' or 'promo' row grants quota through
--    the identical path a 'stripe' row does (same status vocabulary,
--    same active/trialing check), so support/ops can grant Pro access
--    (or run a promotion) by inserting a row with provider='manual' (or
--    'promo') and status='active', with no different code path and no
--    quota function change.
-- ============================================================
create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  plan_key text not null references public.quota_plans (plan_key),
  status text not null check (
    status in (
      'active', 'trialing', 'past_due', 'canceled',
      'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    )
  ),
  provider text not null default 'stripe'
    constraint subscriptions_provider_check check (
      provider in ('stripe', 'manual', 'promo')
    ),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_user_id_key unique (user_id)
);

comment on table public.subscriptions is
  'Current subscription state per user - the source of truth resolve_generate_package_quota_limit() reads to find a plan_key. Designed for a future Stripe webhook handler to write directly (plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end) with no quota function change required. Absence of a row for a user is a valid, common state (every user today) and is treated identically to a non-plan-granting status - both resolve to the Free plan.';

comment on column public.subscriptions.provider is
  'How this row came to exist: stripe (default - a real paid subscription), manual (support/ops granted access directly, no payment), or promo (a promotional/marketing grant). Audit/reporting metadata only - never read by resolve_generate_package_quota_limit() or any other quota function, which decide eligibility from plan_key/status alone regardless of provider.';

create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists subscriptions_plan_key_idx
  on public.subscriptions (plan_key);

-- Partial, not a plain index on the whole column: 'stripe' will be the
-- overwhelming majority of rows once real subscriptions exist, and
-- those are already looked up by stripe_customer_id/
-- stripe_subscription_id, never by provider. What this actually
-- supports is the realistic admin/audit query "list all
-- manually-granted or promotional access" - a small subset of rows -
-- so only non-stripe rows are indexed.
create index if not exists subscriptions_non_stripe_provider_idx
  on public.subscriptions (provider)
  where provider <> 'stripe';

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;

-- ============================================================
-- 3. Aggregate quota-period table: at most one row per (user, UTC
--    calendar month). This is what a quota check reads - an O(1) row
--    lookup, never a COUNT(*) over the reservation ledger.
-- ============================================================
create table if not exists public.generate_package_quota_periods (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  reserved_count integer not null default 0,
  completed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generate_package_quota_periods_user_period_key unique (user_id, period_start),
  constraint generate_package_quota_periods_counts_check check (reserved_count >= 0 and completed_count >= 0),
  constraint generate_package_quota_periods_period_order_check check (period_end > period_start)
);

comment on table public.generate_package_quota_periods is
  'One row per user per UTC calendar month. reserved_count is active, not-yet-resolved reservations; completed_count is successful generations. reserved_count + completed_count is compared, at check time, against resolve_generate_package_quota_limit() - the limit itself is never stored on this row, so a plan upgrade/downgrade takes effect immediately for the current period with no data migration. Rows are created lazily (see ensure_generate_package_quota_period) - there is no scheduled job that pre-creates or rolls over periods.';

create index if not exists generate_package_quota_periods_user_idx
  on public.generate_package_quota_periods (user_id);

alter table public.generate_package_quota_periods enable row level security;
revoke all on public.generate_package_quota_periods from anon, authenticated;

-- ============================================================
-- 4. Per-request reservation ledger - the idempotency/concurrency-safety
--    backbone, and the second half of the "one aggregate row per period"
--    design above. Renamed from this file's prior generate_package_usage
--    (never applied to Production, so this is a rename, not a
--    migration-compatibility break) to drop the misleading "usage" name
--    now that a distinct usage/aggregate table exists.
-- ============================================================
create table if not exists public.generate_package_quota_reservations (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  request_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null check (status in ('reserved', 'completed', 'released')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint generate_package_quota_reservations_user_request_key unique (user_id, request_id),
  constraint generate_package_quota_reservations_period_order_check check (period_end > period_start)
);

comment on table public.generate_package_quota_reservations is
  'One row per Generate Package attempt, keyed by the same generationRequestId applications.generation_request_id already uses. This is what makes reserve/complete/release/reclaim safe against duplicate calls, retried worker callbacks, and out-of-order complete/release - a counter alone cannot do this. period_start/period_end are copied from the period active at reservation time (or at revival time, for a request_id being re-reserved after a release - see reserve_generate_package_usage) so a row always unambiguously belongs to exactly one period even if read much later; complete/release always act on THIS stored period, never "the current period", so a generation that straddles a month boundary is still correctly attributed to the period it was reserved under.';

create index if not exists generate_package_quota_reservations_user_status_idx
  on public.generate_package_quota_reservations (user_id, status);

create index if not exists generate_package_quota_reservations_period_idx
  on public.generate_package_quota_reservations (user_id, period_start);

alter table public.generate_package_quota_reservations enable row level security;
revoke all on public.generate_package_quota_reservations from anon, authenticated;

-- ============================================================
-- 5. Period-boundary helper - the single place "what is the current UTC
--    calendar month" is computed, so every function below agrees.
-- ============================================================
create or replace function public.generate_package_current_period()
returns table (period_start timestamptz, period_end timestamptz)
language sql
stable
set search_path = ''
as $$
  select
    date_trunc('month', (now() at time zone 'utc')) at time zone 'utc',
    (date_trunc('month', (now() at time zone 'utc')) + interval '1 month') at time zone 'utc';
$$;

revoke all on function public.generate_package_current_period() from public, anon, authenticated;
grant execute on function public.generate_package_current_period() to service_role;

-- ============================================================
-- 6. Plan-limit resolution - the ONLY place a numeric limit is read by
--    the functions below; 5 and 50 never appear inside any of them.
--
--    Resolution order: User -> public.subscriptions -> plan_key ->
--    public.quota_plans -> monthly_generation_limit. Reads
--    subscriptions live on every call, so a Stripe webhook updating
--    subscriptions.plan_key/status takes effect on this user's very
--    next quota check with no cache to invalidate and no other object
--    to touch.
-- ============================================================
create or replace function public.resolve_generate_package_quota_limit(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_key text;
  v_limit integer;
begin
  -- Only a currently plan-granting subscription counts (see this file's
  -- top-of-file / section-2 comments for the exact status list and
  -- reasoning) - no row, an inactive/past-due/canceled/etc. status, or a
  -- status not recognized here all leave v_plan_key NULL and fall
  -- through to the Free fallback below exactly the same way.
  select s.plan_key into v_plan_key
  from public.subscriptions as s
  where s.user_id = p_user_id
    and s.status in ('active', 'trialing');

  if v_plan_key is not null then
    select qp.monthly_generation_limit into v_limit
    from public.quota_plans as qp
    where qp.plan_key = v_plan_key
      and qp.enabled = true;

    if v_limit is not null then
      return v_limit;
    end if;
  end if;

  -- No subscription, an inactive/non-plan-granting status, or a
  -- plan_key that resolved to a disabled quota_plans row: fail OPEN to
  -- the 'free' plan's own configured limit, never fail closed entirely
  -- - an unclear or absent subscription state must not be able to block
  -- a user from the Service outright. See this migration's top-level
  -- doc comment for the full reasoning.
  select qp.monthly_generation_limit into v_limit
  from public.quota_plans as qp
  where qp.plan_key = 'free'
    and qp.enabled = true;

  -- Ultimate fail-safe: even the 'free' plan row is missing/disabled
  -- (operator error emptying quota_plans entirely) - deny rather than
  -- silently grant unlimited generations. Not "hardcoding a limit" in
  -- the sense this task prohibits: it is a last-resort deny, not a
  -- normal-operation value, and only ever reached when quota_plans
  -- itself is misconfigured.
  return coalesce(v_limit, 0);
end;
$$;

revoke all on function public.resolve_generate_package_quota_limit(uuid) from public, anon, authenticated;
grant execute on function public.resolve_generate_package_quota_limit(uuid) to service_role;

-- ============================================================
-- 7. Lazily get-or-create the current period's aggregate row.
-- ============================================================
create or replace function public.ensure_generate_package_quota_period(
  p_user_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.generate_package_quota_periods (user_id, period_start, period_end)
  values (p_user_id, p_period_start, p_period_end)
  on conflict (user_id, period_start) do nothing;
$$;

revoke all on function public.ensure_generate_package_quota_period(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ensure_generate_package_quota_period(uuid, timestamptz, timestamptz) to service_role;

-- ============================================================
-- 8. Reclaim stale/abandoned reservations - defined here with a simple
--    time-based rule, replaced in full (CREATE OR REPLACE) by
--    20260725171800_generate_package_quota_state_reclaim.sql with an
--    applications-status-aware version. reserve_generate_package_usage
--    and get_generate_package_usage below both call this by name, so
--    that later replacement upgrades both of them without either
--    function's own body changing - see that file's own comment for why
--    this is a deliberate improvement on the two-migration relationship
--    this design replaces (which had to redefine both large functions
--    just to change their reconcile logic).
--
--    Scoped to a single (user, period) per call, and only ever reclaims
--    'reserved' rows in that exact period - a stale reservation from a
--    prior month is never touched by a call scoped to the current
--    period, so prior-month reclaim can never interfere with the
--    current month's counters (nor vice versa).
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
  v_reclaimed_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  with reclaimed as (
    update public.generate_package_quota_reservations as r
      set status = 'released', updated_at = now()
    where r.user_id = p_user_id
      and r.period_start = p_period_start
      and r.status = 'reserved'
      and r.created_at <= now() - make_interval(secs => p_stale_after_seconds)
    returning 1
  )
  select count(*) into v_reclaimed_count from reclaimed;

  if v_reclaimed_count > 0 then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - v_reclaimed_count, 0),
          updated_at = now()
    where user_id = p_user_id and period_start = p_period_start;
  end if;
end;
$$;

revoke all on function public.reclaim_generate_package_quota_reservations(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclaim_generate_package_quota_reservations(uuid, timestamptz, integer) to service_role;

-- ============================================================
-- 9. reserve_generate_package_usage - name/signature/return shape
--    unchanged from the design being replaced (app/api/generate-package/
--    route.ts's only caller passes p_user_id, p_request_id, and a legacy
--    p_limit - see this file's top comment for why p_limit is ignored).
-- ============================================================
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
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_limit integer;
  v_status text;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  select gp.period_start, gp.period_end
    into v_period_start, v_period_end
  from public.generate_package_current_period() as gp;

  -- p_limit is intentionally never referenced below - see this file's
  -- top-of-file compatibility note.
  v_limit := public.resolve_generate_package_quota_limit(p_user_id);

  perform public.ensure_generate_package_quota_period(p_user_id, v_period_start, v_period_end);
  perform public.reclaim_generate_package_quota_reservations(p_user_id, v_period_start, p_stale_after_seconds);

  -- Idempotency lookup is NOT period-scoped: request_id is a globally
  -- unique id minted once per generation attempt (never reused across
  -- unrelated attempts), so a duplicate call for the same request_id
  -- must find its row regardless of which period it currently belongs
  -- to.
  select r.status into v_status
  from public.generate_package_quota_reservations as r
  where r.user_id = p_user_id and r.request_id = p_request_id;

  if v_status = 'completed' then
    select (qp.reserved_count + qp.completed_count) into v_used
    from public.generate_package_quota_periods as qp
    where qp.user_id = p_user_id and qp.period_start = v_period_start;

    v_used := coalesce(v_used, 0);
    return query select true, true, v_used, greatest(v_limit - v_used, 0);
    return;
  end if;

  if v_status = 'reserved' then
    select (qp.reserved_count + qp.completed_count) into v_used
    from public.generate_package_quota_periods as qp
    where qp.user_id = p_user_id and qp.period_start = v_period_start;

    v_used := coalesce(v_used, 0);
    return query select true, false, v_used, greatest(v_limit - v_used, 0);
    return;
  end if;

  -- v_status = 'released', or NULL (a genuinely new request_id): this
  -- specific unit is not currently counted - check whether a slot is
  -- free before reserving (or re-reserving) it.
  select (qp.reserved_count + qp.completed_count) into v_used
  from public.generate_package_quota_periods as qp
  where qp.user_id = p_user_id and qp.period_start = v_period_start;

  v_used := coalesce(v_used, 0);

  if v_used >= v_limit then
    return query select false, false, v_used, 0;
    return;
  end if;

  if v_status is null then
    insert into public.generate_package_quota_reservations
      (user_id, request_id, period_start, period_end, status)
    values (p_user_id, p_request_id, v_period_start, v_period_end, 'reserved');
  else
    -- v_status = 'released': revive this exact request_id in place
    -- (never insert a second row for it - the UNIQUE(user_id,
    -- request_id) constraint above would reject that anyway, but
    -- updating is the correct semantic, not merely a fallback). If the
    -- prior reservation belonged to an earlier period, this correctly
    -- moves it into the CURRENT period, since a retried attempt is
    -- consuming a slot now, not back when it was first reserved.
    update public.generate_package_quota_reservations
      set status = 'reserved',
          period_start = v_period_start,
          period_end = v_period_end,
          created_at = now(),
          completed_at = null,
          updated_at = now()
    where user_id = p_user_id and request_id = p_request_id;
  end if;

  update public.generate_package_quota_periods
    set reserved_count = reserved_count + 1,
        updated_at = now()
  where user_id = p_user_id and period_start = v_period_start;

  return query select true, false, v_used + 1, greatest(v_limit - (v_used + 1), 0);
end;
$$;

revoke all on function public.reserve_generate_package_usage(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_generate_package_usage(uuid, uuid, integer, integer) to service_role;

-- ============================================================
-- 10. complete_generate_package_usage - unchanged name/signature. Acts
--     on the reservation's OWN stored period (via RETURNING), never
--     "the current period", so a generation that finishes after a month
--     boundary still correctly credits the period it was reserved in.
-- ============================================================
create or replace function public.complete_generate_package_usage(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  update public.generate_package_quota_reservations
    set status = 'completed', completed_at = now(), updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and status = 'reserved'
  returning period_start into v_period_start;

  -- No-op (by design, not an error) if the row was already 'completed'
  -- or 'released', or does not exist - v_period_start stays NULL and the
  -- aggregate is left untouched. This is what makes a duplicate/retried
  -- complete call, or a complete-after-release call, safe.
  if v_period_start is not null then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - 1, 0),
          completed_count = completed_count + 1,
          updated_at = now()
    where user_id = p_user_id and period_start = v_period_start;
  end if;
end;
$$;

revoke all on function public.complete_generate_package_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_generate_package_usage(uuid, uuid) to service_role;

-- ============================================================
-- 11. release_generate_package_usage - unchanged name/signature. Same
--     "act on the row's own period, no-op if not currently 'reserved'"
--     shape as complete_generate_package_usage above.
-- ============================================================
create or replace function public.release_generate_package_usage(
  p_user_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  update public.generate_package_quota_reservations
    set status = 'released', updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and status = 'reserved'
  returning period_start into v_period_start;

  if v_period_start is not null then
    update public.generate_package_quota_periods
      set reserved_count = greatest(reserved_count - 1, 0),
          updated_at = now()
    where user_id = p_user_id and period_start = v_period_start;
  end if;
end;
$$;

revoke all on function public.release_generate_package_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_generate_package_usage(uuid, uuid) to service_role;

-- ============================================================
-- 12. get_generate_package_usage - unchanged name/signature/read-only
--     contract (app/api/generate-package/usage/route.ts's display-only
--     "N remaining" endpoint).
-- ============================================================
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
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_limit integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  select gp.period_start, gp.period_end
    into v_period_start, v_period_end
  from public.generate_package_current_period() as gp;

  v_limit := public.resolve_generate_package_quota_limit(p_user_id);

  perform public.ensure_generate_package_quota_period(p_user_id, v_period_start, v_period_end);
  perform public.reclaim_generate_package_quota_reservations(p_user_id, v_period_start, p_stale_after_seconds);

  select (qp.reserved_count + qp.completed_count) into v_used
  from public.generate_package_quota_periods as qp
  where qp.user_id = p_user_id and qp.period_start = v_period_start;

  v_used := coalesce(v_used, 0);

  return query select v_used, greatest(v_limit - v_used, 0);
end;
$$;

revoke all on function public.get_generate_package_usage(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_generate_package_usage(uuid, integer, integer) to service_role;
