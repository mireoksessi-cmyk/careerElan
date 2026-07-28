import { NextResponse } from "next/server";
import { refreshAllCareerFairSources } from "@/lib/careerFairs/ingest";

/*
  Server-only ingestion trigger for Career Fair Search. Mirrors this
  repo's existing internal-endpoint convention exactly
  (app/api/internal/stripe-reconcile/route.ts's STRIPE_RECONCILE_SECRET
  Bearer check, app/api/followup/route.ts's CRON_SECRET Bearer check) - a
  shared secret only an operator or a Netlify Scheduled Function knows,
  no Supabase session involved, never callable from the browser.

  Triggered by netlify/functions/refresh-career-fairs-scheduled.ts once
  daily. Safe to call more often than that (e.g. a manual operator
  re-run): ingestion is a pure upsert keyed on (source_name,
  source_event_id), so re-running never creates duplicates.
*/
function resolveRefreshSecret(): string | null {
  return process.env.CAREER_FAIR_REFRESH_SECRET || null;
}

export async function POST(req: Request) {
  const secret = resolveRefreshSecret();
  const authHeader = req.headers.get("authorization");

  /*
    A missing env var and a wrong caller-supplied secret both have to
    return the same generic 401 to the caller (never reveal which one it
    was), but they need to be distinguishable in server logs - otherwise
    an operator debugging "the scheduled refresh always 401s" has no way
    to tell "CAREER_FAIR_REFRESH_SECRET was never set in this
    environment" apart from "the caller sent the wrong value" from the
    logs alone.
  */
  if (!secret) {
    console.error(
      JSON.stringify({
        event: "career_fair_refresh_misconfigured",
        message: "CAREER_FAIR_REFRESH_SECRET is not set in this environment.",
      })
    );
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  console.log(JSON.stringify({ event: "career_fair_refresh_started" }));

  try {
    const summary = await refreshAllCareerFairSources();

    /*
      Three distinct outcomes, each with its own HTTP status so a
      monitoring/alerting layer (or an operator reading Netlify's own
      function-invocation success tracking) can tell them apart without
      parsing the body: skipped (another run was already in progress -
      not an error), success/partial_success (at least one source
      succeeded - existing data is safe either way), and failed (every
      active source failed - a real incident, likely infra-wide rather
      than one broken feed).
    */
    if (summary.skipped) {
      console.log(
        JSON.stringify({ event: "career_fair_refresh_skipped", runId: summary.runId })
      );
      return NextResponse.json(
        { ok: true, status: "skipped", runId: summary.runId },
        { status: 200 }
      );
    }

    const allFailed =
      summary.totalSources > 0 && summary.succeededSources === 0;
    const status = allFailed
      ? "failed"
      : summary.failedSources > 0
        ? "partial_success"
        : "success";

    console.log(
      JSON.stringify({
        event: "career_fair_refresh_finished",
        runId: summary.runId,
        status,
        durationMs: summary.durationMs,
        succeededSources: summary.succeededSources,
        failedSources: summary.failedSources,
      })
    );

    return NextResponse.json(
      { ok: !allFailed, status, ...summary },
      { status: allFailed ? 502 : 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);

    console.error(
      JSON.stringify({ event: "career_fair_refresh_error", message })
    );

    return NextResponse.json(
      { ok: false, status: "failed", error: message },
      { status: 500 }
    );
  }
}
