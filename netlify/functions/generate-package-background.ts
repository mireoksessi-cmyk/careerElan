import type { Handler } from "@netlify/functions";
import { runPackageGeneration } from "../../lib/generatePackage/generateCore";

/*
  Netlify Background Function - the "-background" filename suffix is what
  makes Netlify return 202 immediately on invocation and keep running this
  handler for up to 15 minutes afterward. This is the PRODUCTION trigger
  target for BACKGROUND_FUNCTION_URL; app/api/internal/generate-package-worker
  is the local-dev stand-in (see its own docstring for why the two can't be
  the same route).

  NOTE (unverified locally - requires an actual Netlify deploy to confirm):
  this file imports lib/generatePackage/generateCore.ts via a relative path
  specifically because Netlify's function bundler is a separate build step
  from the Next.js app build, and it is not confirmed whether it resolves
  this repo's "@/..." TypeScript path alias the same way `next build` does.
  generateCore.ts itself still uses "@/..." imports internally (consistent
  with the rest of the codebase) - if Netlify's bundler does NOT resolve
  those, this function will fail to deploy/cold-start, and generateCore.ts's
  internal imports would need to switch to relative paths too. This can
  only be confirmed by an actual Deploy Preview, not by local `next build`.

  Netlify's async (Lambda) invocation model can retry this handler on
  failure - runPackageGeneration() is safe to call more than once for the
  same applicationId because it performs its own atomic worker-claim
  (UPDATE ... WHERE generation_worker_claimed_at IS NULL) before doing any
  OpenAI work; a retried/duplicate invocation's claim affects 0 rows and it
  returns immediately.
*/
export const handler: Handler = async (event) => {
  const authHeader =
    event.headers?.authorization || event.headers?.Authorization;
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized." }) };
  }

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

  /*
    Awaiting the full generation here is correct, not a bug: Netlify's
    platform already sent the caller a 202 the moment this invocation
    started (that's what the "-background" filename suffix buys), before
    this handler even began running - the statusCode returned below never
    reaches the original caller, it just satisfies the Lambda handler
    contract. The caller's own fetch() to this URL already resolved.
  */
  await runPackageGeneration(applicationId);

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
