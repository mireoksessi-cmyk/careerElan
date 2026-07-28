import type { Handler } from "@netlify/functions";

/*
  Netlify Scheduled Function - the "config.schedule" export below is what
  registers this as a cron-triggered function (Netlify's own scheduling
  mechanism, invoked automatically once deployed; there is no equivalent
  local-dev trigger, so this file is only ever exercised on a real Netlify
  deploy - locally, POST directly to /api/internal/refresh-career-fairs
  with the same bearer secret to test ingestion).

  This function does no ingestion work itself - it only makes one
  authenticated fetch back into the already-deployed Next.js app's own
  /api/internal/refresh-career-fairs route, which does the real work
  (fetch ICS feed(s), upsert, expire). Kept this thin deliberately: the
  ingestion logic then has exactly one implementation
  (lib/careerFairs/ingest.ts), reachable identically whether triggered by
  this schedule or by a manual operator POST - no separate scheduled-
  function-only code path to keep in sync.

  Deliberately no "@/..." alias imports (Netlify's function bundler is a
  separate build step from `next build` - see
  generate-package-background.ts's own docstring for why this codebase's
  convention is relative/npm-only imports in netlify/functions/*.ts).

  process.env.URL is Netlify's own site URL, confirmed available to a
  serverless/scheduled function's runtime (see
  lib/generatePackage/backgroundTarget.ts for the fuller investigation of
  this env var's availability). No local-dev fallback origin is needed
  here since this handler never runs outside a real Netlify deploy.
*/
export const config = {
  schedule: "0 8 * * *",
};

export const handler: Handler = async () => {
  const secret = process.env.CAREER_FAIR_REFRESH_SECRET;
  const siteUrl = process.env.URL;

  if (!secret) {
    console.error(
      JSON.stringify({
        event: "career_fair_scheduled_refresh_error",
        message: "CAREER_FAIR_REFRESH_SECRET is not set.",
      })
    );
    return { statusCode: 500, body: "CAREER_FAIR_REFRESH_SECRET is not set." };
  }

  if (!siteUrl) {
    console.error(
      JSON.stringify({
        event: "career_fair_scheduled_refresh_error",
        message: "process.env.URL is not available.",
      })
    );
    return { statusCode: 500, body: "process.env.URL is not available." };
  }

  try {
    const response = await fetch(
      `${siteUrl}/api/internal/refresh-career-fairs`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      }
    );

    const body = await response.text();

    console.log(
      JSON.stringify({
        event: "career_fair_scheduled_refresh_finished",
        status: response.status,
        body,
      })
    );

    return { statusCode: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        event: "career_fair_scheduled_refresh_error",
        message,
      })
    );

    return { statusCode: 500, body: message };
  }
};
