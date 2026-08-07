import type { Handler } from "@netlify/functions";
import { runCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerationWorker";

/*
  Phase 6I - Netlify Background Function, the PRODUCTION trigger target
  for canonical generation - mirrors
  netlify/functions/generate-package-background.ts's own structure and
  reasoning exactly (relative imports for the separate function-bundler
  build step, awaiting the full generation because the platform already
  sent 202 the moment this invocation started, safe-to-retry via the
  worker's own atomic claim). See that file's own docstring for the
  full rationale - not repeated here.
*/
export const handler: Handler = async (event) => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized." }) };
  }

  let applicationId: string | null = null;
  try {
    const body = JSON.parse(event.body || "{}");
    applicationId = typeof body.applicationId === "string" ? body.applicationId : null;
  } catch {
    applicationId = null;
  }

  if (!applicationId) {
    return { statusCode: 400, body: JSON.stringify({ error: "applicationId is required." }) };
  }

  await runCanonicalGeneration(applicationId);

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
