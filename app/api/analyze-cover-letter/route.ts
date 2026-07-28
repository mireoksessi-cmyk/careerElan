import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import {
  resolveBackgroundFunctionSecret,
  resolveNamedBackgroundFunctionUrl,
} from "@/lib/generatePackage/backgroundTarget";

/*
  Async rewrite, identical shape and rationale to
  app/api/analyze-resume/route.ts (see that file's own docstring) - claim-
  by-enqueue only, no file/OpenAI work in this request. Actual work lives in
  lib/documentAnalysis/coverLetterAnalysisCore.ts, run by
  netlify/functions/analyze-cover-letter-background.ts (Production) or
  app/api/internal/analyze-cover-letter-worker/route.ts (local dev).
*/

const ENQUEUE_FETCH_TIMEOUT_MS = 10 * 1000;

async function enqueueCoverLetterAnalysisWorker(params: {
  requestOrigin: string;
  coverLetterId: string;
}): Promise<void> {
  const { requestOrigin, coverLetterId } = params;

  const secret = resolveBackgroundFunctionSecret();

  if (!secret) {
    throw new Error("Background analysis is not configured.");
  }

  const { url: backgroundUrl } = resolveNamedBackgroundFunctionUrl(
    requestOrigin,
    "analyze-cover-letter-background",
    "/api/internal/analyze-cover-letter-worker"
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
    body: JSON.stringify({ coverLetterId }),
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

    try {
      await enqueueCoverLetterAnalysisWorker({
        requestOrigin: new URL(req.url).origin,
        coverLetterId,
      });
    } catch (enqueueError) {
      logSafeError(enqueueError, {
        requestId,
        route: "/api/analyze-cover-letter#enqueue",
        userId: user.id,
      });

      await supabase
        .from("cover_letters")
        .update({
          analysis_status: "failed",
          analysis_error_code: "ENQUEUE_FAILED",
          analysis_error_summary: "Failed to start cover letter analysis.",
        })
        .eq("id", coverLetterId)
        .eq("user_id", user.id);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to start cover letter analysis. Please try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { success: true, status: "processing", coverLetterId },
      { status: 202 }
    );
  } catch (error) {
    logSafeError(error, { requestId, route: "/api/analyze-cover-letter" });

    return NextResponse.json(
      { success: false, message: "Failed to analyze cover letter." },
      { status: 500 }
    );
  }
}
