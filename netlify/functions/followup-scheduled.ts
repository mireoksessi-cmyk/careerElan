import { schedule } from "@netlify/functions";
import type { Handler } from "@netlify/functions";

/*
  Netlify Scheduled Function for Email Notifications Phase 1 (Job Tracker
  follow-up reminders) - same "schedule(cron, handler)" registration
  mechanism as the existing netlify/functions/refresh-career-fairs-
  scheduled.ts, which this file mirrors closely. See that file's own
  header comment for why the classic `Handler`-typed `schedule()` wrapper
  is used here rather than a bare `export const config = { schedule }`
  object (the latter was confirmed, via this repo's own prior
  investigation, to silently fail to register at all).

  This function does no reminder logic itself - it only makes one
  authenticated fetch back into the already-deployed Next.js app's own
  GET /api/followup route, which does the real work (eligibility, atomic
  claim, send, persistence). Kept thin deliberately, exactly like the
  career-fairs scheduled function: the follow-up logic then has exactly
  one implementation, reachable identically whether triggered by this
  schedule or by a manual authenticated call with the same CRON_SECRET.

  Deliberately no "@/..." alias imports - Netlify's classic Functions
  bundler is a separate build step from `next build` (see this repo's
  other netlify/functions/*.ts files for the same convention).

  process.env.URL is Netlify's own site URL, confirmed available to a
  serverless/scheduled function's runtime by the existing career-fairs
  scheduled function and by lib/generatePackage/backgroundTarget.ts's own
  investigation of this env var. No local-dev fallback origin is needed
  here since this handler never runs outside a real Netlify deploy.

  Never logs the CRON_SECRET value itself, the Resend API key, or any
  user data - only whether the secret/site URL are present, and the
  follow-up route's own JSON response (counts and generic error strings,
  never PII/secrets - see app/api/followup/route.ts).
*/
export const handler: Handler = schedule("0 8 * * *", async () => {
  const secret = process.env.CRON_SECRET;
  const siteUrl = process.env.URL;

  if (!secret) {
    console.error(
      JSON.stringify({
        event: "followup_scheduled_error",
        message: "CRON_SECRET is not set.",
      })
    );
    return { statusCode: 500, body: "CRON_SECRET is not set." };
  }

  if (!siteUrl) {
    console.error(
      JSON.stringify({
        event: "followup_scheduled_error",
        message: "process.env.URL is not available.",
      })
    );
    return { statusCode: 500, body: "process.env.URL is not available." };
  }

  try {
    const response = await fetch(`${siteUrl}/api/followup`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
    });

    const body = await response.text();

    console.log(
      JSON.stringify({
        event: "followup_scheduled_finished",
        status: response.status,
        body,
      })
    );

    return { statusCode: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        event: "followup_scheduled_error",
        message,
      })
    );

    return { statusCode: 500, body: message };
  }
});
