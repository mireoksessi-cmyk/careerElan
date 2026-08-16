/*
  Admin Marketing Email Sender - extends admin_staff's role CHECK
  constraint to allow a new 'MARKETING' role, so a future marketing hire
  can be granted a genuinely isolated permission (admin.marketing.send,
  added in lib/admin/permissions.ts) without also holding
  admin.users.manage or any other admin capability.

  This is the ONLY change in this migration: the role CHECK constraint
  gains one additional allowed value. No other table, RLS policy,
  function, RPC, trigger, or auth/storage setting is touched. The
  constraint name (admin_staff_role_check) was confirmed via
  pg_constraint against the live schema before writing this migration -
  it is the default Postgres-generated name for the original inline,
  unnamed CHECK clause in supabase/migrations/20260810180000_admin_staff_
  rbac.sql, not an assumption.

  No existing admin_staff row is affected: no row currently has
  role = 'MARKETING' (the value did not exist before this migration), so
  this is purely additive to the constraint's allowed set.
*/

alter table public.admin_staff
  drop constraint admin_staff_role_check;

alter table public.admin_staff
  add constraint admin_staff_role_check
  check (role in ('OWNER', 'ADMIN', 'SUPPORT', 'OPERATIONS', 'ANALYST', 'VIEWER', 'MARKETING'));
