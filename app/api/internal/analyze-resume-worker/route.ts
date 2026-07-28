import { NextResponse } from "next/server";
import { runResumeAnalysis } from "@/lib/documentAnalysis/resumeAnalysisCore";
import {
  resolveBackgroundFunctionSecret,
  isNetlifyRuntime,
} from "@/lib/generatePackage/backgroundTarget";

/*
  LOCAL-DEV STAND-IN ONLY for netlify/functions/analyze-resume-background.ts -
  identical shape and rationale to app/api/internal/generate-package-worker/
  route.ts (see that route's own docstring for the full explanation of why
  Netlify Background Functions can't be reproduced by `next dev`/
  `next start`, and why this fire-and-forget approximation is good enough
  for local end-to-end testing).

  Uses the normal "@/..." alias - safe here, this file is only ever built
  by `next build`/`next dev`, never Netlify's separate function bundler.
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
  const resumeId = typeof body.resumeId === "string" ? body.resumeId : null;

  if (!resumeId) {
    return NextResponse.json({ error: "resumeId is required." }, { status: 400 });
  }

  // Fire-and-forget - see docstring above.
  void runResumeAnalysis(resumeId);

  return NextResponse.json({ accepted: true }, { status: 202 });
}
