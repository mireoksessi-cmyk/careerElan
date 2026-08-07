import { NextResponse } from "next/server";
import { runCanonicalGeneration } from "@/lib/careerMemory/orchestration/canonicalGenerationWorker";
import { resolveBackgroundFunctionSecret, isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  Phase 6I - LOCAL-DEV STAND-IN ONLY for
  netlify/functions/canonical-generate-package-background.ts, mirroring
  app/api/internal/generate-package-worker/route.ts's own exact
  structure and reasoning for legacy - see that file's own docstring
  for why a Netlify Background Function's execution guarantees cannot
  be reproduced by `next dev`/`next start`, and why firing
  runCanonicalGeneration() unawaited (rather than duplicating its
  logic) is sufficient for local end-to-end testing.
*/
export async function POST(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  const secret = resolveBackgroundFunctionSecret();

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : null;

  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  // Fire-and-forget - see docstring above.
  void runCanonicalGeneration(applicationId);

  return NextResponse.json({ accepted: true }, { status: 202 });
}
