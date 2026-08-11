/*
  Phase 6I.6.37 - the fixed RBAC taxonomy. Deliberately NOT stored in the
  database (see supabase/migrations/20260810180000_admin_staff_rbac.sql's
  own header comment) - six roles, thirteen permissions, both closed
  sets defined here as the single source of truth every admin route/page
  checks against via lib/admin/auth.ts's requireAdminPermission(). No
  component or route may hardcode a role check directly against
  AdminRole - always go through hasPermission()/requireAdminPermission().
*/

export type AdminRole =
  | "OWNER"
  | "ADMIN"
  | "SUPPORT"
  | "OPERATIONS"
  | "ANALYST"
  | "VIEWER";

export const ADMIN_ROLES: AdminRole[] = [
  "OWNER",
  "ADMIN",
  "SUPPORT",
  "OPERATIONS",
  "ANALYST",
  "VIEWER",
];

export type AdminPermission =
  | "admin.overview.read"
  | "admin.users.read"
  | "admin.users.manage"
  | "admin.subscriptions.read"
  | "admin.subscriptions.manage"
  | "admin.product_usage.read"
  | "admin.api_costs.read"
  | "admin.api_costs.manage"
  | "admin.system_health.read"
  | "admin.alerts.read"
  | "admin.alerts.manage"
  | "admin.staff.read"
  | "admin.staff.manage"
  | "admin.audit.read";

/*
  Role -> permission grants. OWNER implicitly has everything ADMIN has
  plus staff/audit management; ADMIN has everything except staff role
  mutation (staff.manage) and cannot be used to self-escalate to OWNER
  (enforced separately in lib/admin/auth.ts's updateStaffRole, not here
  - this table only decides "can this role open this tab/call this
  read", not the OWNER-only mutation rules layered on top).
*/
const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  OWNER: new Set<AdminPermission>([
    "admin.overview.read",
    "admin.users.read",
    "admin.users.manage",
    "admin.subscriptions.read",
    "admin.subscriptions.manage",
    "admin.product_usage.read",
    "admin.api_costs.read",
    "admin.api_costs.manage",
    "admin.system_health.read",
    "admin.alerts.read",
    "admin.alerts.manage",
    "admin.staff.read",
    "admin.staff.manage",
    "admin.audit.read",
  ]),
  ADMIN: new Set<AdminPermission>([
    "admin.overview.read",
    "admin.users.read",
    "admin.users.manage",
    "admin.subscriptions.read",
    "admin.subscriptions.manage",
    "admin.product_usage.read",
    "admin.api_costs.read",
    "admin.api_costs.manage",
    "admin.system_health.read",
    "admin.alerts.read",
    "admin.alerts.manage",
    "admin.staff.read",
    "admin.audit.read",
  ]),
  SUPPORT: new Set<AdminPermission>([
    "admin.overview.read",
    "admin.users.read",
  ]),
  OPERATIONS: new Set<AdminPermission>([
    "admin.overview.read",
    "admin.system_health.read",
    "admin.alerts.read",
    "admin.alerts.manage",
    "admin.api_costs.read",
  ]),
  ANALYST: new Set<AdminPermission>([
    "admin.overview.read",
    "admin.product_usage.read",
    "admin.api_costs.read",
  ]),
  VIEWER: new Set<AdminPermission>(["admin.overview.read"]),
};

export function hasPermission(
  role: AdminRole,
  permission: AdminPermission
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return Array.from(ROLE_PERMISSIONS[role]);
}
