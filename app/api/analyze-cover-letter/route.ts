import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import { runCoverLetterAnalysis } from "@/lib/documentAnalysis/coverLetterAnalysisCore";

/*
  Synchronous again - identical rationale to app/api/analyze-resume/route.ts
  (see that file's own docstring): production DB evidence proved
  pdf-parse-new fails to load inside Netlify's classic Background Function
  bundle, which next.config.js's `serverExternalPackages` does not cover.
  lib/documentAnalysis/coverLetterAnalysisCore.ts's extraction/OCR/OpenAI
  logic is reused verbatim, just invoked directly and awaited here.

  maxDuration=60 restored (see app/api/analyze-resume/route.ts's own
  comment for the identical reasoning) - Cover Letter can run up to 4
  sequential OpenAI calls (including Vision OCR fallback), same timeout
  risk as before this whole investigation, not a new regression.
*/

export const maxDuration = 60;

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
    const coverLetterId = typeof body.coverLetterId === "string" ? body.coverLetterId : "";

    if (!coverLetterId) {
      return NextResponse.json(
        { success: false, message: "coverLetterId is required." },
        { status: 400 }
      );
    }

    const { data: coverLetter, error: fetchError } = await supabase
      .from("cover_letters")
      .select(
        "id, analysis_status, parsed_data, analysis_error_code, analysis_error_summary"
      )
      .eq("id", coverLetterId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !coverLetter) {
      return NextResponse.json(
        { success: false, message: "Cover letter not found." },
        { status: 404 }
      );
    }

    if (coverLetter.analysis_status === "succeeded") {
      return NextResponse.json({ success: true, data: coverLetter.parsed_data });
    }

    if (coverLetter.analysis_status === "failed") {
      return NextResponse.json({
        success: false,
        message: coverLetter.analysis_error_summary || "Failed to analyze cover letter.",
        code: coverLetter.analysis_error_code || "UNKNOWN",
      });
    }

    await runCoverLetterAnalysis(coverLetterId);

    const { data: finalRow, error: finalError } = await supabase
      .from("cover_letters")
      .select("analysis_status, parsed_data, analysis_error_code, analysis_error_summary")
      .eq("id", coverLetterId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (finalError || !finalRow) {
      return NextResponse.json(
        { success: false, message: "Failed to analyze cover letter. Please try again." },
        { status: 500 }
      );
    }

    if (finalRow.analysis_status === "succeeded") {
      return NextResponse.json({ success: true, data: finalRow.parsed_data });
    }

    return NextResponse.json({
      success: false,
      message: finalRow.analysis_error_summary || "Failed to analyze cover letter.",
      code: finalRow.analysis_error_code || "UNKNOWN",
    });
  } catch (error) {
    logSafeError(error, { requestId, route: "/api/analyze-cover-letter" });

    return NextResponse.json(
      { success: false, message: "Failed to analyze cover letter." },
      { status: 500 }
    );
  }
}
