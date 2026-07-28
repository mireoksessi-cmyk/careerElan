import type { Handler } from "@netlify/functions";
import { runResumeAnalysis } from "../../lib/documentAnalysis/resumeAnalysisCore";

/*
  Netlify Background Function - the "-background" filename suffix is what
  makes Netlify return 202 immediately on invocation and keep running this
  handler for up to 15 minutes afterward. This is the PRODUCTION trigger
  target for the async Resume analysis flow; app/api/internal/
  analyze-resume-worker is the local-dev stand-in - see that route's own
  docstring, and generate-package-background.ts (the proven original of
  this exact pattern) for the fuller rationale.

  Relative import (not "@/..." alias) for the same reason as
  generate-package-background.ts: Netlify's function bundler is a separate
  build step from `next build`, and resumeAnalysisCore.ts + everything it
  imports were deliberately written with only relative/npm imports so this
  file's own import stays portable without needing to hope the alias
  resolves the same way.

  Reuses BACKGROUND_FUNCTION_SECRET - the same shared secret already
  configured for generate-package-background, per the instruction to reuse
  existing background infrastructure rather than inventing new
  per-job secrets/env vars.
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
    Awaiting the full analysis here is correct, not a bug: Netlify's
    platform already sent the caller a 202 the moment this invocation
    started (that's what the "-background" filename suffix buys), before
    this handler even began running - see
    generate-package-background.ts's own docstring for the identical
    reasoning.
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
