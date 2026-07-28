import type { Handler } from "@netlify/functions";
import { runCoverLetterAnalysis } from "../../lib/documentAnalysis/coverLetterAnalysisCore";

/*
  Netlify Background Function for the async Cover Letter analysis flow -
  identical shape to analyze-resume-background.ts (see that file's own
  docstring for the full rationale); only the imported worker differs.
*/
export const handler: Handler = async (event) => {
  let diagnosticCoverLetterId: string | null = null;

  try {
    const parsedForLogging = JSON.parse(event.body || "{}");
    diagnosticCoverLetterId =
      typeof parsedForLogging.coverLetterId === "string"
        ? parsedForLogging.coverLetterId
        : null;
  } catch {
    // Best-effort only.
  }

  console.log(
    JSON.stringify({
      event: "netlify_cover_letter_analysis_handler_started",
      coverLetterId: diagnosticCoverLetterId,
      handlerStartedAt: new Date().toISOString(),
    })
  );

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    console.log(
      JSON.stringify({
        event: "netlify_cover_letter_analysis_auth_rejected",
        coverLetterId: diagnosticCoverLetterId,
      })
    );

    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized." }) };
  }

  let coverLetterId: string | null = null;

  try {
    const body = JSON.parse(event.body || "{}");
    coverLetterId = typeof body.coverLetterId === "string" ? body.coverLetterId : null;
  } catch {
    coverLetterId = null;
  }

  if (!coverLetterId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "coverLetterId is required." }),
    };
  }

  const dispatchStartedAt = Date.now();
  let outcome: "completed" | "failed" = "completed";

  try {
    await runCoverLetterAnalysis(coverLetterId);
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    console.log(
      JSON.stringify({
        event: "netlify_cover_letter_analysis_handler_finished",
        coverLetterId,
        durationMs: Date.now() - dispatchStartedAt,
        outcome,
      })
    );
  }

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
