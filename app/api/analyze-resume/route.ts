import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import {
  resolveBackgroundFunctionSecret,
  resolveNamedBackgroundFunctionUrl,
} from "@/lib/generatePackage/backgroundTarget";

/*
  Async rewrite: this route no longer receives the file or runs any text
  extraction/OpenAI call itself - production reproduction confirmed the old
  synchronous version (3 sequential OpenAI calls in one request handler)
  was being killed by Netlify's own gateway timeout on real-world documents
  (504, HTML body, "Unexpected token '<'" on the client - the request never
  even reached the point of returning JSON). The file is already in
  Supabase Storage and the resumes row already exists (both done client-side
  before this route is called, unchanged from before) - this route's only
  job now is to claim-by-enqueue: verify ownership, hand off to the
  background worker, and return 202 immediately. The actual work now lives
  in lib/documentAnalysis/resumeAnalysisCore.ts, run by
  netlify/functions/analyze-resume-background.ts (Production) or
  app/api/internal/analyze-resume-worker/route.ts (local dev) - exactly
  mirroring the Generate Package Phase 1 async pattern
  (app/api/generate-package/route.ts / lib/generatePackage/generateCore.ts).
*/

const ENQUEUE_FETCH_TIMEOUT_MS = 10 * 1000;

async function enqueueResumeAnalysisWorker(params: {
  requestOrigin: string;
  resumeId: string;
}): Promise<void> {
  const { requestOrigin, resumeId } = params;

  const secret = resolveBackgroundFunctionSecret();

  if (!secret) {
    throw new Error("Background analysis is not configured.");
  }

  const { url: backgroundUrl } = resolveNamedBackgroundFunctionUrl(
    requestOrigin,
    "analyze-resume-background",
    "/api/internal/analyze-resume-worker"
  );

  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ENQUEUE_FETCH_TIMEOUT_MS)
      : (() => {
          const controller = new AbortController();
          setTimeout(
            () => controller.abort(new Error("Enqueue fetch timed out.")),
            ENQUEUE_FETCH_TIMEOUT_MS
          );
          return controller.signal;
        })();

  const res = await fetch(backgroundUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ resumeId }),
    signal: timeoutSignal,
  });

  if (res.status !== 202) {
    throw new Error(`Background function returned ${res.status}, expected 202.`);
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const resumeId = typeof body.resumeId === "string" ? body.resumeId : "";

    if (!resumeId) {
      return NextResponse.json(
        { success: false, message: "resumeId is required." },
        { status: 400 }
      );
    }

    const { data: resume, error: fetchError } = await supabase
      .from("resumes")
      .select("id, analysis_status, parsed_data, analysis_error_code, analysis_error_summary")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !resume) {
      return NextResponse.json(
        { success: false, message: "Resume not found." },
        { status: 404 }
      );
    }

    // Idempotent replay - the client polls its own status route once
    // enqueued, but a duplicate call here (double-click, retried request)
    // should never re-run analysis on an already-resolved row.
    if (resume.analysis_status === "succeeded") {
      return NextResponse.json({ success: true, data: resume.parsed_data });
    }

    if (resume.analysis_status === "failed") {
      return NextResponse.json({
        success: false,
        message: resume.analysis_error_summary || "Failed to analyze resume.",
        code: resume.analysis_error_code || "UNKNOWN",
      });
    }

    try {
      await enqueueResumeAnalysisWorker({
        requestOrigin: new URL(req.url).origin,
        resumeId,
      });
    } catch (enqueueError) {
      logSafeError(enqueueError, {
        requestId,
        route: "/api/analyze-resume#enqueue",
        userId: user.id,
      });

      await supabase
        .from("resumes")
        .update({
          analysis_status: "failed",
          analysis_error_code: "ENQUEUE_FAILED",
          analysis_error_summary: "Failed to start resume analysis.",
        })
        .eq("id", resumeId)
        .eq("user_id", user.id);

      return NextResponse.json(
        { success: false, message: "Failed to start resume analysis. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { success: true, status: "processing", resumeId },
      { status: 202 }
    );
  } catch (error) {
    logSafeError(error, { requestId, route: "/api/analyze-resume" });

    return NextResponse.json(
      { success: false, message: "Failed to analyze resume." },
      { status: 500 }
    );
  }
}
