import { schedule } from "@netlify/functions";
import type { Handler } from "@netlify/functions";

/*
  Netlify Scheduled Function for critical system alert email delivery - the
  same "schedule(cron, handler)" registration as the existing
  netlify/functions/followup-scheduled.ts and refresh-career-fairs-
  scheduled.ts, which this file mirrors. See refresh-career-fairs-
  scheduled.ts's own header for why the classic `Handler`-typed `schedule()`
  wrapper is used rather than a bare `export const config = { schedule }`
  (the latter was confirmed by this repo's own investigation to silently fail
  to register).

  This is the whole reason the feature works when nobody is looking. Every
  alert the Admin console shows is computed on page view, which is enough for
  a spike - the evidence is still in the table an hour later - but not for a
  stuck generation, which becomes critical because time passed and no request
  need ever be made. Without a clock, that alert can only be seen by someone
  who was already watching.

  Every fifteen minutes, matching the 15-minute window the canonical alert
  evaluation itself uses (lib/admin/alertThresholds.ts): checking faster would
  re-read the same window, and checking slower could let a window's evidence
  age out of view between runs. Sending is idempotent regardless - delivery
  state is claimed before any email - so the schedule controls detection
  latency, not how many emails arrive.

  Does no alert logic itself: one authenticated fetch into the deployed app's
  own POST /api/internal/system-alerts, which does the real work. Kept thin
  deliberately, exactly like the other two, so the logic has one
  implementation reachable identically from the schedule or from a manual
  authenticated call.

  Deliberately no "@/..." alias imports - Netlify's classic Functions bundler
  is a separate build step from `next build` (same convention as this repo's
  other netlify/functions/*.ts files).

  Never logs CRON_SECRET, any recipient address, or any user data - only
  whether the secret and site URL are present, and the route's own JSON
  response, which is counts and alert keys.
*/
export const handler: Handler = schedule("*/15 * * * *", async () => {
  const secret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL;

  if (!secret) {
    console.error(
      JSON.stringify({
        event: "system_alerts_scheduled_error",
        message: "CRON_SECRET is not set.",
      })
    );
    return { statusCode: 500, body: "CRON_SECRET is not set." };
  }

  if (!siteUrl) {
    console.error(
      JSON.stringify({
        event: "system_alerts_scheduled_error",
        message: "process.env.URL is not available.",
      })
    );
    return { statusCode: 500, body: "process.env.URL is not available." };
  }

  try {
    const response = await fetch(`${siteUrl}/api/internal/system-alerts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });

    const body = await response.text();

    console.log(
      JSON.stringify({
        event: "system_alerts_scheduled_finished",
        status: response.status,
        body,
      })
    );

    return { statusCode: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        event: "system_alerts_scheduled_error",
        message,
      })
    );

    return { statusCode: 500, body: message };
  }
});
