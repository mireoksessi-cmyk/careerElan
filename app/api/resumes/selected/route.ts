import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  resolveSelectedResume,
  ResumeResolutionError,
} from "@/lib/resume-service";
import { logSafeError } from "@/lib/errors/publicError";

/*
  Read-only endpoint exposing the exact same authoritative resolution
  app/api/generate-package/route.ts uses, so the Paste Job preview and the
  package-generation source are guaranteed to agree - they call the same
  resolveSelectedResume() function, not two independently-maintained
  copies of "which resume is selected" logic.

  includeGenerationText: false skips buildResumeFromCareerMemory's OpenAI
  call for Career Memory sources - this route only needs to know WHICH
  resume/source is selected and return its preview-relevant row, not
  produce the AI-tailored resume text (that only happens at actual
  generation time).
*/
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

    let resolved;

    try {
      resolved = await resolveSelectedResume(supabase, user.id, {
        includeGenerationText: false,
      });
    } catch (error) {
      if (error instanceof ResumeResolutionError) {
        const status =
          error.code === "NO_CAREER_MEMORY" ||
          error.code === "RESUME_NOT_FOUND"
            ? 404
            : error.code === "FETCH_FAILED"
              ? 500
              : 400;

        return NextResponse.json(
          { error: error.code },
          { status }
        );
      }

      throw error;
    }

    return NextResponse.json({
      source: resolved.source,
      resumeId: resolved.resumeId,
      selectedName: resolved.selectedName,
      previewData: resolved.previewData,
    });
  } catch (error) {
    logSafeError(error, {
      requestId,
      route: "/api/resumes/selected",
    });

    return NextResponse.json(
      { error: "Something went wrong. Please try again.", requestId },
      { status: 500 }
    );
  }
}
