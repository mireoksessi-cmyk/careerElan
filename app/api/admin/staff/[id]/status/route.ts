import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { setStaffStatus } from "@/lib/admin/queries/staff";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireAdminPermission("admin.staff.manage");
    const body = await req.json().catch(() => ({}));
    const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null;

    if (!status) {
      return NextResponse.json({ error: "status must be 'active' or 'disabled'." }, { status: 400 });
    }

    const result = await setStaffStatus(ctx, id, status);
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
