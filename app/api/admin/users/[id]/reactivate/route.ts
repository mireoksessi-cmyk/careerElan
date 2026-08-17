import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { reactivateUser } from "@/lib/admin/queries/userControls";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireAdminPermission("admin.users.manage");
    const result = await reactivateUser(ctx, id);
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
