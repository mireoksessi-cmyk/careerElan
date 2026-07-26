import { NextResponse } from "next/server";
import { runPackageGeneration } from "@/lib/generatePackage/generateCore";
import { resolveBackgroundFunctionSecret } from "@/lib/generatePackage/backgroundTarget";

/*
  LOCAL-DEV STAND-IN ONLY for netlify/functions/generate-package-background.ts.

  Netlify Background Functions are a platform feature (return 202
  immediately, keep running up to 15 minutes, may be retried by the
  platform on failure) that cannot be reproduced by `next dev`/
  `next start` - there is no local server that gives a plain Next.js API
  route the same "detached, survives after the response" execution
  guarantee a real deployment gets. This route approximates it well
  enough for local testing (verifying the claim/enqueue/worker logic
  end-to-end, exactly-once OpenAI call, snapshot correctness) by firing
  the same runPackageGeneration() core - imported verbatim, not
  duplicated - without awaiting it, since `next start`/`next dev` keep the
  same long-lived Node process alive between requests. This guarantee
  does NOT hold for a real serverless deployment, which is exactly why the
  genuine Netlify Function exists as the Production trigger target -
  resolveBackgroundFunctionUrl() must point at that, not at this route,
  once deployed.

  Uses the normal "@/..." alias (safe here - this file is only ever built
  by `next build`/`next dev`, never by Netlify's separate function
  bundler).
*/
export async function POST(req: Request) {
  /*
    Never reachable on an actual Netlify deployment (Production or Deploy
    Preview alike) - only on `next dev`/`next start` run directly, where
    process.env.NETLIFY is never set. NODE_ENV alone can't distinguish
    this: `next start` sets NODE_ENV=production even when run purely
    locally. NETLIFY is set only by Netlify's own build/runtime
    environment - see lib/generatePackage/backgroundTarget.ts.
  */
  if (process.env.NETLIFY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  const secret = resolveBackgroundFunctionSecret();

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const applicationId =
    typeof body.applicationId === "string" ? body.applicationId : null;

  if (!applicationId) {
    return NextResponse.json(
      { error: "applicationId is required." },
      { status: 400 }
    );
  }

  // Fire-and-forget - see docstring above.
  void runPackageGeneration(applicationId);

  return NextResponse.json({ accepted: true }, { status: 202 });
}
