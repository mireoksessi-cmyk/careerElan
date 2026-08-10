/*
  Phase 6I.6.37 - server-component counterpart to
  lib/admin/routeHelpers.ts's withAdminPermission(), for pages instead
  of API routes. Unauthenticated -> redirect("/") (matches every other
  protected page's behavior). Authenticated-but-wrong-permission ->
  returns a denied result so the page can render a real "Access
  Denied" view (never a silent blank page, and never just "hide the
  nav link" - Part AI's "hidden UI is not relied upon as security"
  test targets exactly this).
*/
import { redirect } from "next/navigation";
import { requireAdminPermission, AdminAuthError, type AdminContext } from "./auth";
import type { AdminPermission } from "./permissions";

export type AdminPageGuardResult = { denied: false; ctx: AdminContext } | { denied: true; message: string };

export async function guardAdminPage(permission: AdminPermission): Promise<AdminPageGuardResult> {
  try {
    const ctx = await requireAdminPermission(permission);
    return { denied: false, ctx };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      if (error.status === 401) redirect("/");
      return { denied: true, message: error.message };
    }
    return { denied: true, message: "Internal error." };
  }
}
