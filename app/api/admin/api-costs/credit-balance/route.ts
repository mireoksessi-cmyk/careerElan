/*
  API-D2 - records an operator-confirmed OpenAI credit balance checkpoint.

  Same authorization contract as the recharge endpoint beside it
  (requireAdminPermission + explicit validation), and the same permission -
  admin.api_costs.manage. Nothing new is introduced to the role model.

  Unlike that endpoint this one answers a plain form post rather than a fetch,
  and replies with a redirect back to the console. That is what lets the
  confirmation checkbox required by the form be the whole of the client side:
  no component, no JavaScript, and nothing the browser can submit except the
  balance and its acknowledgement.
*/
import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/admin/auth";
import { recordCreditBalanceCheckpoint } from "@/lib/openai/creditBalance";
import { logAdminAction } from "@/lib/admin/auditLog";

const ADMIN_PAGE = "/admin/api-costs";

/*
  303 so the browser follows with a GET. Without it a refresh would repost the
  form, and a repost here is not a harmless duplicate - it would open a second
  checkpoint and silently re-arm the alert cycle.
*/
function redirectBack(req: NextRequest, status: string): NextResponse {
  const url = new URL(`${ADMIN_PAGE}?checkpoint=${status}`, req.nextUrl.origin);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminPermission("admin.api_costs.manage");

    const form = await req.formData();

    /*
      The checkbox is required in the markup, but the markup is not the
      guard - a post that skips it is rejected here. Confirming a balance
      resets the 80/90/100 cycle, and that must not be possible by accident.
    */
    if (form.get("acknowledge") !== "yes") {
      return redirectBack(req, "not-acknowledged");
    }

    const raw = form.get("confirmedBalanceUsd");
    const parsed = typeof raw === "string" && raw.trim() ? Number(raw.trim()) : Number.NaN;

    /*
      Only the balance comes from the browser. The timestamp is the database's
      own now(), the actor is resolved from the session above, and the spend
      baseline and threshold state are derived - none of them are accepted
      from the request.
    */
    const result = await recordCreditBalanceCheckpoint({
      confirmedBalanceUsd: parsed,
      actorAdminUserId: ctx.userId,
    });

    if (!result.ok) {
      return redirectBack(req, result.error === "INSERT_FAILED" ? "failed" : "invalid");
    }

    await logAdminAction({
      actorAdminUserId: ctx.userId,
      action: "OPENAI_CREDIT_BALANCE_CONFIRMED",
      targetType: "openai_credit_balance_checkpoints",
      targetId: result.id,
      result: "success",
      metadata: {
        confirmed_balance_usd: result.confirmedBalanceUsd,
        checkpoint_id: result.id,
      },
    });

    return redirectBack(req, "recorded");
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
