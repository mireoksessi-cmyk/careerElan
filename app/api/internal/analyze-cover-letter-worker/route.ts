import { NextResponse } from "next/server";
import { runCoverLetterAnalysis } from "@/lib/documentAnalysis/coverLetterAnalysisCore";
import {
  resolveBackgroundFunctionSecret,
  isNetlifyRuntime,
} from "@/lib/generatePackage/backgroundTarget";

/*
  LOCAL-DEV STAND-IN ONLY for netlify/functions/analyze-cover-letter-background.ts -
  see app/api/internal/analyze-resume-worker/route.ts's own docstring for
  the full rationale (identical pattern, different worker).
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
  const coverLetterId = typeof body.coverLetterId === "string" ? body.coverLetterId : null;

  if (!coverLetterId) {
    return NextResponse.json({ error: "coverLetterId is required." }, { status: 400 });
  }

  void runCoverLetterAnalysis(coverLetterId);

  return NextResponse.json({ accepted: true }, { status: 202 });
}
