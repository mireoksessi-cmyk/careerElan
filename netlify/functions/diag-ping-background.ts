import type { Handler } from "@netlify/functions";

/*
  TEMPORARY DIAGNOSTIC - NOT PART OF THE PRODUCT. To be reverted immediately
  after use. Purpose: determine whether Netlify's classic Background
  Function invocation mode ever surfaces console.log content via
  `netlify logs function`, independent of any application code, imports,
  or Supabase/OpenAI dependencies. analyze-resume-background/
  analyze-cover-letter-background show zero log content (confirmed via
  --json: message: "") for every invocation so far, and this probe exists
  to determine whether that is a real module-load crash or a log-capture
  limitation specific to this invocation mode.

  Deliberately zero imports beyond the type-only Handler (erased at
  compile time) - if this ALSO shows empty logs, the blank-log symptom is
  proven to be a Netlify tooling/log-capture characteristic of "background"
  invocation-mode functions in general, not evidence of a crash in
  resumeAnalysisCore.ts's own import chain.
*/
export const handler: Handler = async () => {
  console.log(
    JSON.stringify({
      event: "diag_ping_background_reached",
      timestamp: new Date().toISOString(),
    })
  );

  return { statusCode: 202, body: "pong" };
};
