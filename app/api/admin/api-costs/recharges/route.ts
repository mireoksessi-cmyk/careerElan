/*
  Phase 6I.6.38A Operational Activation - manual OpenAI recharge
  recording endpoint. Follows the same manual-mutation pattern as
  app/api/admin/staff/route.ts's POST handler (requireAdminPermission +
  explicit validation + typed error response), not withAdminPermission,
  because a validation failure needs its own 400 rather than being
  wrapped into a 200 response body.
*/
import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { recordManualRecharge } from "@/lib/openai/recharges";
import { logAdminAction } from "@/lib/admin/auditLog";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminPermission("admin.api_costs.manage");
    const body = await req.json().catch(() => ({}));
    const amountUsd = typeof body.amountUsd === "number" ? body.amountUsd : Number(body.amountUsd);
    const note = typeof body.note === "string" ? body.note : null;

    const result = await recordManualRecharge({
      amountUsd,
      actorAdminUserId: ctx.userId,
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: result.message }, { status: 400 });
    }

    await logAdminAction({
      actorAdminUserId: ctx.userId,
      action: "OPENAI_RECHARGE_RECORDED",
      targetType: "openai_manual_recharges",
      targetId: result.id,
      result: "success",
      metadata: { amount_usd: result.amountUsd, recharge_id: result.id },
    });

    return NextResponse.json({ ok: true, id: result.id, amountUsd: result.amountUsd, createdAt: result.createdAt });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
