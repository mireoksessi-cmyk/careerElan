import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { withAdminPermission } from "@/lib/admin/routeHelpers";
import { getStaffList, grantOrUpdateStaffRole } from "@/lib/admin/queries/staff";
import { ADMIN_ROLES, type AdminRole } from "@/lib/admin/permissions";

export async function GET() {
  return withAdminPermission("admin.staff.read", () => getStaffList());
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminPermission("admin.staff.manage");
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = typeof body.role === "string" ? (body.role as AdminRole) : null;

    if (!email || !role || !ADMIN_ROLES.includes(role)) {
      return NextResponse.json({ error: "email and a valid role are required." }, { status: 400 });
    }

    const result = await grantOrUpdateStaffRole(ctx, email, role);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
