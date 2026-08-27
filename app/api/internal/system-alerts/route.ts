/*
  Server-only trigger for critical system alert email delivery. Mirrors this
  repo's existing internal-endpoint convention exactly
  (app/api/internal/refresh-career-fairs/route.ts and app/api/followup/
  route.ts): a shared CRON_SECRET Bearer that only an operator or a Netlify
  Scheduled Function knows, no Supabase session involved, never callable from
  a browser.

  Triggered by netlify/functions/system-alerts-scheduled.ts. Safe to call more
  often than its schedule, and safe to call by hand: the delivery state is
  claimed before any send, so a second call during an ongoing incident sends
  nothing.
*/
import { NextResponse } from "next/server";
import { runCriticalAlertDelivery } from "@/lib/admin/alerts/criticalAlertDelivery";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET || null;
  const authHeader = req.headers.get("authorization");

  /*
    A missing env var and a wrong caller-supplied secret return the same
    generic 401 - never reveal to a caller which it was - but they are
    distinguishable in the server log, so an operator debugging "the alert
    sweep always 401s" can tell an unset secret from a wrong one. Same
    reasoning, and same shape, as the career-fairs refresh endpoint.
  */
  if (!secret) {
    console.error(
      JSON.stringify({
        event: "system_alerts_misconfigured",
        message: "CRON_SECRET is not set in this environment.",
      })
    );
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  /*
    Never throws - see runCriticalAlertDelivery's own header. The summary is
    counts and alert keys only; no user data and no recipient address, so it
    is safe in a function log.
  */
  const summary = await runCriticalAlertDelivery();

  console.log(JSON.stringify({ event: "system_alerts_evaluated", ...summary }));

  return NextResponse.json({ ok: true, ...summary });
}
