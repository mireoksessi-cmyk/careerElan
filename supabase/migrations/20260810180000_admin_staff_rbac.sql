/*
  Phase 6I.6.37 - Admin Dashboard RBAC foundation. This codebase has no
  existing role/permission mechanism anywhere (confirmed via full
  migration + grep audit before this migration was written - see
  docs/PRODUCTION_MONITORING_RUNBOOK.md's own admin-auth-gap note from
  Phase 6I.6.36). One table, no per-role permission rows: the role ->
  permission mapping is a small, fixed taxonomy (OWNER/ADMIN/SUPPORT/
  OPERATIONS/ANALYST/VIEWER) and lives in application code
  (lib/admin/permissions.ts), not the database - there is no product
  requirement for staff to configure custom per-role permissions in
  this phase.

  Locked down identically to public.subscriptions/public.quota_plans
  (20260725073100_generate_package_lifetime_quota.sql): RLS enabled,
  ALL revoked from anon/authenticated, reachable only via the
  service-role client (lib/supabaseAdmin.ts), itself only ever called
  from server-only code (API routes under app/api, and other server
  modules under lib). No policy is added for the "authenticated" role
  - a staff member's own admin session still resolves permissions
  through the service-role-backed server helper (lib/admin/auth.ts),
  never a direct client-side query against this table.
*/

create table if not exists public.admin_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'SUPPORT', 'OPERATIONS', 'ANALYST', 'VIEWER')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ON DELETE SET NULL, not the default NO ACTION: these are bookkeeping
  -- (who granted/changed this row), not the row's own identity (user_id
  -- above already cascades). A grantor's auth account being deleted later
  -- must never block deleting THEIR account, or corrupt an unrelated
  -- staff member's row.
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.admin_staff is
  'Phase 6I.6.37 - staff RBAC. Service-role access only; the app''s own
   admin authorization helper (lib/admin/auth.ts) is the sole
   sanctioned reader/writer. Never queried directly from client code.';

alter table public.admin_staff enable row level security;
revoke all on public.admin_staff from anon, authenticated;
grant all on public.admin_staff to service_role;

create index if not exists admin_staff_status_idx on public.admin_staff (status);
