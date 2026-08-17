/*
  Admin User Controls Phase 2 - additive schema for Suspend/Reactivate,
  per-user Quota Override, and the Stripe-safe deletion fix.

  ============================================================
  1. Suspension state - lives on public.profiles (the existing
     app-owned per-user row), not a new table, since this is a single
     piece of per-user state with no independent lifecycle of its own.
     All three columns nullable, no default - every existing row is
     implicitly "not suspended" (suspended_at is null) with zero
     backfill needed.
  ============================================================
*/
alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null,
  add column if not exists suspended_reason text;

comment on column public.profiles.suspended_at is
  'NULL = not suspended (the default/normal state for every existing and new row). Set by an OWNER/ADMIN via admin.users.manage; enforced server-side in middleware.ts on every request for an authenticated user, not merely hidden in the UI.';
comment on column public.profiles.suspended_by is
  'The admin (auth.users.id) who most recently suspended this account. NULL once reactivated is not required (kept as history of the last action) - reactivation only clears suspended_at.';
comment on column public.profiles.suspended_reason is
  'Optional short operator-entered note (e.g. "abuse report"). Never populated from user-supplied content - always admin-typed.';

/*
  ============================================================
  2. Per-user quota override - distinct from the plan-based
     public.subscriptions/public.quota_plans model (Admin API Usage
     Phase 2's sibling document already established that pattern for
     CAD accounting: an explicit override table, checked first,
     falling through to existing resolution). One row per user
     (primary key = user_id): a user has at most one active override.
  ============================================================
*/
create table if not exists public.admin_user_quota_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_generate_limit integer not null check (monthly_generate_limit >= 0),
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  note text
);

comment on table public.admin_user_quota_overrides is
  'Per-user Generate Package monthly limit override, checked FIRST by resolve_generate_package_quota_limit() before it falls through to the existing subscriptions/quota_plans resolution. A row here does not expire at a UTC month boundary - it persists until an admin explicitly removes it (deletes the row) or changes it, matching this task''s "must survive month boundaries unless explicitly designed as temporary" requirement. Never read by reserve/complete/release_generate_package_usage directly - only by the single resolver function, so no other function needed to change.';

alter table public.admin_user_quota_overrides enable row level security;
revoke all on public.admin_user_quota_overrides from anon, authenticated;
grant select, insert, update, delete on public.admin_user_quota_overrides to service_role;

/*
  ============================================================
  3. resolve_generate_package_quota_limit() - CREATE OR REPLACE, same
     name/signature/security/search_path as the version this replaces
     (supabase/migrations/20260725073100_generate_package_lifetime_quota.sql),
     matching this codebase's own established pattern for evolving this
     exact function (see that file's own section 8 comment on
     reclaim_generate_package_quota_reservations for the identical
     "CREATE OR REPLACE, unchanged callers" approach). The ONLY change:
     a per-user override lookup is now the very first check, before the
     existing subscriptions -> quota_plans resolution - which is
     otherwise byte-for-byte unchanged below. Every call site
     (reserve/complete/release/get_generate_package_usage, and by
     extension every TypeScript caller of those RPCs) needs zero
     changes, exactly per this migration's own file-level design
     philosophy ("a plan upgrade/downgrade takes effect immediately...
     no data migration").
  ============================================================
*/
create or replace function public.resolve_generate_package_quota_limit(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override integer;
  v_plan_key text;
  v_limit integer;
begin
  -- Admin per-user override takes priority over plan-based resolution.
  select o.monthly_generate_limit into v_override
  from public.admin_user_quota_overrides as o
  where o.user_id = p_user_id;

  if v_override is not null then
    return v_override;
  end if;

  -- Unchanged from the version this replaces: subscriptions -> quota_plans.
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

  select qp.monthly_generation_limit into v_limit
  from public.quota_plans as qp
  where qp.plan_key = 'free'
    and qp.enabled = true;

  return coalesce(v_limit, 0);
end;
$$;

revoke all on function public.resolve_generate_package_quota_limit(uuid) from public, anon, authenticated;
grant execute on function public.resolve_generate_package_quota_limit(uuid) to service_role;

/*
  ============================================================
  4. Stripe-safe deletion fix - the confirmed orphan issue: prior to
     this migration, public.subscriptions.user_id had NO foreign key to
     auth.users at all, so deleting a user's auth identity (self-service
     or, after this task, admin-initiated) left an orphaned subscription
     row behind with zero automatic cleanup, DB-level or code-level.

     Adding this FK is additive/safe: public.subscriptions is confirmed
     empty in every real environment this session has read (its own
     creating migration's header states "this table starts empty" and
     is "never backfilled" - no existing row can violate this
     constraint). on delete cascade means ANY future deletion of an
     auth.users row - through this task's new admin-delete path, the
     existing self-service path, or any future code path that doesn't
     even know about this table - correctly removes that user's
     subscription record at the database level, not merely by
     applications remembering to do so.

     public.admin_user_quota_overrides (section 2 above) already
     carries on delete cascade from its own creation - no separate fix
     needed there.
  ============================================================
*/
alter table public.subscriptions
  add constraint subscriptions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

/*
  ============================================================
  5. Minimum service_role table grants required by this task's own
     new code paths (lib/admin/queries/userControls.ts,
     lib/accountDeletion.ts, and the Phase 2 fields added to
     lib/admin/queries/users.ts). Confirmed by a dedicated read-only
     audit: a database built solely from committed migrations never
     grants service_role real data-access privileges on these tables -
     only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN (see
     20260720153937_remote_schema.sql's own "ALTER DEFAULT PRIVILEGES
     FOR ROLE postgres" clause, which set that restrictive default for
     every table created afterward - the same gap
     20260728000000_career_fairs.sql's own comment already documented
     and worked around for its own new tables). service_role bypassing
     RLS does not bypass ordinary SQL table GRANTs - RLS stays enabled,
     unchanged, on every table below; only data-access privileges for
     the service_role Postgres role are added here.

     Least-privilege, verified against the actual current code (not
     assumed): each line grants only the exact operation(s) that
     table's real Phase 2 read/write path performs, nothing broader.
     public.admin_user_quota_overrides already has sufficient grants
     from section 2 above and is intentionally not repeated here.
  ============================================================
*/
grant select, update, delete
on table public.profiles
to service_role;

grant select, insert, update, delete
on table public.subscriptions
to service_role;

grant select
on table public.quota_plans
to service_role;

grant select, delete
on table public.resumes
to service_role;

grant select, delete
on table public.applications
to service_role;

grant delete
on table public.analytics_cache
to service_role;

grant select, delete
on table public.career_memory
to service_role;

grant select, delete
on table public.cover_letters
to service_role;
