/*
  Phase 6I.6.37 - durable admin audit log. Append-only from server-only
  code (lib/admin/auditLog.ts), same service-role-only lockdown pattern
  as admin_staff. Never stores resume/job/cover-letter/Career Memory
  content, passwords, tokens, or secrets - `metadata` is a small,
  explicitly-constructed jsonb object at each call site, never a raw
  request/response body.
*/

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  -- Nullable + ON DELETE SET NULL (not NOT NULL / no-action): this is an
  -- append-only audit trail, so deleting a staff member's auth account later
  -- (disabled-then-removed, or a self-service account deletion) must never
  -- fail or silently destroy past audit rows - the action record survives,
  -- just loses its actor link. actorEmail (resolved at read time from
  -- auth.users, see auditLogList.ts) is looked up live, so once the actor
  -- is gone the row still shows action/result/timestamp with a null actor.
  actor_admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  result text not null check (result in ('success', 'denied', 'error')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Phase 6I.6.37 - append-only admin action audit trail. Service-role
   access only, written exclusively via lib/admin/auditLog.ts. Never
   contains resume/job/cover-letter/Career Memory text, passwords,
   tokens, or secrets - metadata is a small explicit object per call
   site.';

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select, insert on public.admin_audit_log to service_role;

create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor_admin_user_id, created_at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action, created_at desc);
