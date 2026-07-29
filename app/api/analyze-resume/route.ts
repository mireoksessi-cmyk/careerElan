import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import {
  resolveBackgroundFunctionSecret,
  resolveNamedBackgroundFunctionUrl,
} from "@/lib/generatePackage/backgroundTarget";

/*
  Async again - production reproduction (real /api/analyze-resume Netlify
  Function log + Supabase row/RPC timeline, cross-referenced) proved the
  synchronous version's own request took 30-40+ seconds for real-world
  resumes, well past whatever intermediate layer sits in front of the
  Next.js Runtime function and returns its own HTML response to the
  browser before the origin function finishes - the origin function
  itself always completed cleanly and within its own maxDuration=60
  budget, so raising that number further would not have helped. This
  route's own job shrinks back to what it briefly was before:
  auth + ownership check + claim-by-enqueue, returning fast.

  The actual extraction/OpenAI work still runs in
  lib/documentAnalysis/resumeAnalysisCore.ts (runResumeAnalysis),
  completely unchanged, now executed by
  netlify/functions/analyze-resume-background.ts (Production) or
  app/api/internal/analyze-resume-worker/route.ts (local dev) - see
  netlify.toml's own comment for why that Background Function should
  actually load pdf-parse-new/mammoth correctly this time
  (external_node_modules), unlike the earlier attempt at this same
  architecture.

  This route is deliberately NOT `runResumeAnalysis(resumeId); return
  response;` (fire-and-forget from a plain Next.js Route Handler) -
  nothing on this platform guarantees a dangling await here keeps running
  after the response is sent. Dispatch instead goes to the Background
  Function, whose "-background" filename suffix is Netlify's own
  documented mechanism for "caller gets 202 immediately, handler keeps
  running for up to 15 minutes regardless of the original connection."
*/

const DISPATCH_FETCH_TIMEOUT_MS = 10 * 1000;

// [RESUME_TRACE] instrumentation-only - logs right before every return in
// POST() below. Does not construct or alter the returned NextResponse.
function traceResumeReturn(status: number, success: boolean, message?: string) {
  console.log("[RESUME_TRACE] ANALYZE_RESUME_RETURN", {
    status,
    success,
    message,
    timestamp: new Date().toISOString(),
    performanceNow: performance.now(),
  });
}

async function dispatchResumeAnalysisWorker(params: {
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
      ? AbortSignal.timeout(DISPATCH_FETCH_TIMEOUT_MS)
      : (() => {
          const controller = new AbortController();
          setTimeout(
            () => controller.abort(new Error("Dispatch fetch timed out.")),
            DISPATCH_FETCH_TIMEOUT_MS
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
      traceResumeReturn(401, false, "Unauthorized.");
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const resumeId = typeof body.resumeId === "string" ? body.resumeId : "";

    if (!resumeId) {
      traceResumeReturn(400, false, "resumeId is required.");
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
      traceResumeReturn(404, false, "Resume not found.");
      return NextResponse.json(
        { success: false, message: "Resume not found." },
        { status: 404 }
      );
    }

    // Idempotent replay - a duplicate call here (double-click, retried
    // request) should never re-run analysis on an already-resolved row.
    if (resume.analysis_status === "succeeded") {
      traceResumeReturn(200, true);
      return NextResponse.json({ success: true, data: resume.parsed_data });
    }

    if (resume.analysis_status === "failed") {
      traceResumeReturn(
        200,
        false,
        resume.analysis_error_summary || "Failed to analyze resume."
      );
      return NextResponse.json({
        success: false,
        message: resume.analysis_error_summary || "Failed to analyze resume.",
        code: resume.analysis_error_code || "UNKNOWN",
      });
    }

    // Already claimed by an in-flight background invocation
    // (claim_resume_analysis_worker already flipped pending -> processing
    // and set analysis_worker_claimed_at/analysis_started_at, inside
    // runResumeAnalysis, unchanged) - report status instead of dispatching
    // a second worker for the same row.
    if (resume.analysis_status === "processing") {
      traceResumeReturn(202, true, "processing");
      return NextResponse.json(
        { success: true, accepted: true, resumeId, analysisStatus: "processing" },
        { status: 202 }
      );
    }

    // status === "pending" - not yet claimed by any worker. Dispatch the
    // Background Function; runResumeAnalysis's own atomic claim RPC
    // (unchanged) is what actually guarantees only one worker ever runs
    // the analysis for this row, even if this dispatch call somehow
    // duplicates.
    try {
      await dispatchResumeAnalysisWorker({
        requestOrigin: new URL(req.url).origin,
        resumeId,
      });
    } catch (dispatchError) {
      logSafeError(dispatchError, {
        requestId,
        route: "/api/analyze-resume#dispatch",
        userId: user.id,
      });

      // Dispatch itself is confirmed to have never reached the worker -
      // this is a genuine terminal condition (no background job exists
      // for this row), not an ambiguous gateway/parse error on the
      // client's side of this same request, so recording it as a real
      // failure here is correct and lets the client's existing terminal-
      // failure handling apply.
      await supabase
        .from("resumes")
        .update({
          analysis_status: "failed",
          analysis_error_code: "DISPATCH_FAILED",
          analysis_error_summary: "Failed to start resume analysis.",
        })
        .eq("id", resumeId)
        .eq("user_id", user.id);

      traceResumeReturn(502, false, "Failed to start resume analysis.");
      return NextResponse.json(
        { success: false, message: "Failed to start resume analysis. Please try again." },
        { status: 502 }
      );
    }

    traceResumeReturn(202, true, "pending");
    return NextResponse.json(
      { success: true, accepted: true, resumeId, analysisStatus: "pending" },
      { status: 202 }
    );
  } catch (error) {
    logSafeError(error, { requestId, route: "/api/analyze-resume" });

    traceResumeReturn(500, false, "Failed to analyze resume.");
    return NextResponse.json(
      { success: false, message: "Failed to analyze resume." },
      { status: 500 }
    );
  }
}
