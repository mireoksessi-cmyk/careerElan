/*
  Phase 6I.6.37 - shared wrapper for every /api/admin/** route handler.
  Every route calls this instead of hand-rolling its own try/catch -
  the ONE place that turns AdminAuthError into the right HTTP status,
  so no route can accidentally forget the permission check or return
  the wrong status code for "not staff" vs "wrong role" (Part E's own
  "critical: the same permission must be checked" requirement).
*/
import { NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError, type AdminContext } from "./auth";
import type { AdminPermission } from "./permissions";

export async function withAdminPermission<T>(
  permission: AdminPermission,
  handler: (ctx: AdminContext) => Promise<T>
): Promise<NextResponse> {
  try {
    const ctx = await requireAdminPermission(permission);
    const result = await handler(ctx);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
