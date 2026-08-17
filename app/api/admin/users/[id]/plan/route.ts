import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { changeUserPlan } from "@/lib/admin/queries/userControls";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireAdminPermission("admin.users.manage");
    const body = await req.json().catch(() => ({}));
    const planKey = typeof body.planKey === "string" ? body.planKey.trim().toLowerCase() : "";

    if (!planKey) {
      return NextResponse.json({ error: "planKey is required." }, { status: 400 });
    }

    const result = await changeUserPlan(ctx, id, planKey);
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
