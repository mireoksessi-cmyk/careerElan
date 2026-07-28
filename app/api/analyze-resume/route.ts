import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import { runResumeAnalysis } from "@/lib/documentAnalysis/resumeAnalysisCore";

/*
  Synchronous again - reverted from the Background Function enqueue
  pattern after production DB evidence (analysis_worker_claimed_at set,
  analysis_error_code='MODULE_LOAD_FAILED' at the exact
  `await import("pdf-parse-new")` line in resumeAnalysisCore.ts) proved
  pdf-parse-new fails to load inside Netlify's classic Background Function
  bundle (netlify/functions/*.ts), which - unlike this Next.js Route
  Handler's own bundle (___netlify-server-handler) - is not covered by
  next.config.js's `serverExternalPackages: ["pdf-parse-new", ...]`. The
  same extraction/OpenAI logic (lib/documentAnalysis/resumeAnalysisCore.ts)
  is reused verbatim, just invoked directly and awaited here instead of
  enqueued to a separate function - this is exactly the runtime commit
  cab8755 used, where pdf-parse-new was already proven to load correctly.

  maxDuration=60 restored (present in e2d9ad5, removed when this route
  became enqueue-only) - this route now does the same long-running
  synchronous work cab8755 did, so the same per-route execution-limit
  raise applies again. Real observed latency locally: ~15-30s for a
  short resume; real-world documents may run longer, which is the same
  timeout risk cab8755 always had - not a new regression introduced by
  this revert.
*/

export const maxDuration = 60;

/*
  The resumes row is still inserted client-side before this route is
  called (unchanged - needed for Dashboard-immediate-refresh and the
  content-hash duplicate check), so this route claims-and-runs rather than
  claims-and-enqueues: it awaits the full analysis in-process and returns
  the final {success, data} or {success, message, code} in one response,
  matching the original synchronous contract client code expects.
*/

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

    // Idempotent replay - a duplicate call here (double-click, retried
    // request) should never re-run analysis on an already-resolved row.
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

    // Runs the full extraction + 3 sequential OpenAI calls in-process,
    // writing analysis_status/parsed_data/original_text (or the failure
    // fields) via runResumeAnalysis's own atomic claim + RPC writes -
    // unchanged from the Background Function version, just awaited here
    // instead of dispatched over HTTP.
    await runResumeAnalysis(resumeId);

    const { data: finalRow, error: finalError } = await supabase
      .from("resumes")
      .select("analysis_status, parsed_data, analysis_error_code, analysis_error_summary")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (finalError || !finalRow) {
      return NextResponse.json(
        { success: false, message: "Failed to analyze resume. Please try again." },
        { status: 500 }
      );
    }

    if (finalRow.analysis_status === "succeeded") {
      return NextResponse.json({ success: true, data: finalRow.parsed_data });
    }

    return NextResponse.json({
      success: false,
      message: finalRow.analysis_error_summary || "Failed to analyze resume.",
      code: finalRow.analysis_error_code || "UNKNOWN",
    });
  } catch (error) {
    logSafeError(error, { requestId, route: "/api/analyze-resume" });

    return NextResponse.json(
      { success: false, message: "Failed to analyze resume." },
      { status: 500 }
    );
  }
}
