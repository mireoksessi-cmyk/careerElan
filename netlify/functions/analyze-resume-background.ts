import type { Handler } from "@netlify/functions";
import { runResumeAnalysis } from "../../lib/documentAnalysis/resumeAnalysisCore";

/*
  Netlify Background Function - the "-background" filename suffix is what
  makes Netlify return 202 immediately on invocation and keep running this
  handler for up to 15 minutes afterward, independent of the original
  caller's own connection. This is the officially platform-guaranteed
  "response returned, execution continues" mechanism this project uses
  elsewhere (generate-package-background.ts).

  This exact architecture was tried once before for Resume analysis and
  failed with analysis_error_code=MODULE_LOAD_FAILED at the
  `await import("pdf-parse-new")` line inside runResumeAnalysis - proven
  via direct production DB row inspection, not log inference (netlify
  logs function showed empty content for every invocation of this
  function, a log-capture limitation of this invocation mode confirmed
  separately with a zero-dependency probe function). Root cause: Netlify's
  classic Functions bundler (zip-it-and-ship-it/esbuild) - a separate
  pipeline from the Next.js Runtime - tried to statically bundle
  pdf-parse-new/mammoth and broke on their internal dynamic
  requires/native bits, unlike the Next.js Runtime's own bundle, which
  next.config.js's serverExternalPackages already protects. That specific
  gap is what netlify.toml's `external_node_modules` now closes for this
  bundler too - see netlify.toml's own comment. runResumeAnalysis itself
  is reused completely unchanged; only the runtime it executes in and the
  packaging of its dependencies were the actual problem.

  Relative import (not "@/..." alias): this file is built by Netlify's own
  function bundler, a separate build step from `next build`, and
  resumeAnalysisCore.ts + everything it imports were deliberately written
  with only relative/npm imports so this file's own import stays portable
  without needing to hope the alias resolves the same way.

  Reuses BACKGROUND_FUNCTION_SECRET - the same shared secret already
  configured for generate-package-background - so no new Netlify env var
  needs to be provisioned.
*/
export const handler: Handler = async (event) => {
  let diagnosticResumeId: string | null = null;

  try {
    const parsedForLogging = JSON.parse(event.body || "{}");
    diagnosticResumeId =
      typeof parsedForLogging.resumeId === "string" ? parsedForLogging.resumeId : null;
  } catch {
    // Best-effort only.
  }

  console.log(
    JSON.stringify({
      event: "netlify_resume_analysis_handler_started",
      resumeId: diagnosticResumeId,
      handlerStartedAt: new Date().toISOString(),
    })
  );

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    console.log(
      JSON.stringify({
        event: "netlify_resume_analysis_auth_rejected",
        resumeId: diagnosticResumeId,
      })
    );

    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized." }) };
  }

  let resumeId: string | null = null;

  try {
    const body = JSON.parse(event.body || "{}");
    resumeId = typeof body.resumeId === "string" ? body.resumeId : null;
  } catch {
    resumeId = null;
  }

  if (!resumeId) {
    return { statusCode: 400, body: JSON.stringify({ error: "resumeId is required." }) };
  }

  const dispatchStartedAt = Date.now();
  let outcome: "completed" | "failed" = "completed";

  /*
    Awaiting the full analysis here is correct, not a bug: Netlify already
    sent the caller a 202 the moment this invocation started (that's what
    the "-background" filename suffix buys), before this handler even
    began running. runResumeAnalysis's own internal try/catch already
    converts any failure into a terminal analysis_status='failed' DB write
    via fail_resume_analysis - it never rejects - so this outer try/catch
    exists only to log an unexpected throw, not to change behavior.
  */
  try {
    await runResumeAnalysis(resumeId);
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    console.log(
      JSON.stringify({
        event: "netlify_resume_analysis_handler_finished",
        resumeId,
        durationMs: Date.now() - dispatchStartedAt,
        outcome,
      })
    );
  }

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
