import { NextResponse } from "next/server";
import { runPackageGeneration } from "@/lib/generatePackage/generateCore";

/*
  LOCAL-DEV STAND-IN ONLY for netlify/functions/generate-package-background.ts.

  Netlify Background Functions are a platform feature (return 202
  immediately, keep running up to 15 minutes, retried by the platform on
  failure) that cannot be reproduced by `next dev`/`next start` - there is
  no local server that gives a plain Next.js API route the same "detached,
  survives after the response" execution guarantee a real deployment gets.
  This route approximates it well enough for local testing (verifying the
  claim/enqueue/worker logic end-to-end, exactly-once OpenAI call, snapshot
  correctness) by firing the same runPackageGeneration() core - shared
  verbatim with the real background function - without awaiting it, since
  `next start` keeps the same long-lived Node process alive between
  requests. This guarantee does NOT hold for a real serverless deployment,
  which is exactly why the genuine Netlify Function exists as the
  production trigger target - BACKGROUND_FUNCTION_URL must point at that,
  not at this route, once deployed.
*/
export async function POST(req: Request) {
  /*
    Never reachable on an actual Netlify deployment (Production or Deploy
    Preview alike) - only on `next dev`/`next start` run directly, where
    process.env.NETLIFY is never set. NODE_ENV alone can't distinguish
    this: `next start` sets NODE_ENV=production even when run purely
    locally, which is exactly how this route was tested all along - the
    NETLIFY var (set by Netlify's own build/runtime environment) is the
    only reliable signal for "this is actually deployed."
  */
  if (process.env.NETLIFY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  const secret = process.env.BACKGROUND_FUNCTION_SECRET;

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
