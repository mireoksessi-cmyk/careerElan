import type { Handler } from "@netlify/functions";
import { runPackageGeneration } from "../../lib/generatePackage/generateCore";
import { getRuntimeDiagnosticsSnapshot } from "../../lib/generatePackage/backgroundTarget";

/*
  Netlify Background Function - the "-background" filename suffix is what
  makes Netlify return 202 immediately on invocation and keep running this
  handler for up to 15 minutes afterward. This is the PRODUCTION trigger
  target; app/api/internal/generate-package-worker is the local-dev
  stand-in (see its own docstring for why the two can't be the same
  route).

  Deliberately imports lib/generatePackage/generateCore.ts via a RELATIVE
  path, not this codebase's usual "@/..." alias: Netlify's function
  bundler is a separate build step from the Next.js app build
  (`netlify.toml`'s [build].functions points it at this directory), and
  whether it resolves tsconfig.json's custom path alias the same way
  `next build` does is not something that can be confirmed without an
  actual Netlify deploy. generateCore.ts and everything it imports
  (./shared, ../supabaseAdmin, ../errors/publicError, ../config/aiModels)
  were deliberately written using only relative/npm-package imports for
  exactly this reason - this file inherits that same portability by
  importing generateCore.ts the same way. This removes the risk entirely
  rather than hoping the alias happens to work; it does not defer the
  long-running OpenAI work to a separate HTTP call, since that work must
  run inside *this* function's own execution context to get its 15-minute
  allowance in the first place - forwarding it to a normal Next.js API
  route would just move the 60s-class platform ceiling problem, not solve
  it.

  NOTE (unverified locally - requires an actual Netlify deploy to
  confirm): the reasoning above is believed correct but the relative-
  import approach itself has not been exercised against Netlify's real
  function bundler in this session (no Netlify deploy access). If it
  still fails to bundle/cold-start on an actual deploy, that is the next
  thing to diagnose - see the Phase 1 report's residual-risk section.

  Netlify's async (Lambda-style) invocation model can retry this handler
  on failure - runPackageGeneration() is safe to call more than once for
  the same applicationId because it performs its own atomic worker-claim
  (UPDATE ... WHERE generation_status='pending' AND
  generation_worker_claimed_at IS NULL) before doing any OpenAI work; a
  retried/duplicate invocation's claim affects 0 rows and it returns
  immediately.
*/
export const handler: Handler = async (event) => {
  /*
    Diagnostics-only (see the "package worker runtime diagnostics"
    investigation) - a best-effort, non-throwing pre-parse purely for
    correlating this handler's very first log line with the
    applicationId/generationRequestId the caller enqueued, without
    disturbing the real body-parsing logic below (which runs exactly as
    it did before, unchanged, using its own independent JSON.parse call).
    Never logs the secret, the Authorization header, or any resume/job/
    generated content.
  */
  let diagnosticApplicationId: string | null = null;
  let diagnosticGenerationRequestId: string | null = null;

  try {
    const parsedForLogging = JSON.parse(event.body || "{}");
    diagnosticApplicationId =
      typeof parsedForLogging.applicationId === "string"
        ? parsedForLogging.applicationId
        : null;
    diagnosticGenerationRequestId =
      typeof parsedForLogging.generationRequestId === "string"
        ? parsedForLogging.generationRequestId
        : null;
  } catch {
    // Best-effort only - diagnostic logging must never affect handling below.
  }

  console.log(
    JSON.stringify({
      event: "netlify_background_handler_started",
      applicationId: diagnosticApplicationId,
      generationRequestId: diagnosticGenerationRequestId,
      handlerStartedAt: new Date().toISOString(),
      ...getRuntimeDiagnosticsSnapshot(),
    })
  );

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization;
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    console.log(
      JSON.stringify({
        event: "netlify_background_auth_rejected",
        applicationId: diagnosticApplicationId,
        generationRequestId: diagnosticGenerationRequestId,
      })
    );

    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized." }),
    };
  }

  console.log(
    JSON.stringify({
      event: "netlify_background_auth_accepted",
      applicationId: diagnosticApplicationId,
      generationRequestId: diagnosticGenerationRequestId,
    })
  );

  let applicationId: string | null = null;

  try {
    const body = JSON.parse(event.body || "{}");
    applicationId =
      typeof body.applicationId === "string" ? body.applicationId : null;
  } catch {
    applicationId = null;
  }

  if (!applicationId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "applicationId is required." }),
    };
  }

  console.log(
    JSON.stringify({
      event: "netlify_background_generation_dispatched",
      applicationId,
      generationRequestId: diagnosticGenerationRequestId,
    })
  );

  const dispatchStartedAt = Date.now();
  let outcome: "completed" | "failed" = "completed";

  /*
    Awaiting the full generation here is correct, not a bug: Netlify's
    platform already sent the caller a 202 the moment this invocation
    started (that's what the "-background" filename suffix buys), before
    this handler even began running - the statusCode returned below never
    reaches the original caller, it just satisfies the Lambda handler
    contract. The caller's own fetch() to this URL already resolved.
  */
  try {
    await runPackageGeneration(applicationId);
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    console.log(
      JSON.stringify({
        event: "netlify_background_handler_finished",
        applicationId,
        generationRequestId: diagnosticGenerationRequestId,
        durationMs: Date.now() - dispatchStartedAt,
        outcome,
      })
    );
  }

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
