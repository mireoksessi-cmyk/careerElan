import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { suspendUser } from "@/lib/admin/queries/userControls";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireAdminPermission("admin.users.manage");
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

    const result = await suspendUser(ctx, id, reason);
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
