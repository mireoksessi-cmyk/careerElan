import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { changeUserQuotaOverride } from "@/lib/admin/queries/userControls";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireAdminPermission("admin.users.manage");
    const body = await req.json().catch(() => ({}));

    // limit: null (or omitted) clears the override; otherwise must be a number.
    const rawLimit = body.limit;
    const limit = rawLimit === null || rawLimit === undefined ? null : Number(rawLimit);
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    const result = await changeUserQuotaOverride(ctx, id, limit, note);
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
