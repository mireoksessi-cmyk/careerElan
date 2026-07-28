import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  COVER_LETTER_ANALYSIS_STAGE_PROGRESS,
  resolveAnalysisProgress,
} from "@/lib/documentAnalysis/shared";

/*
  Polling endpoint for the async Cover Letter analysis flow - identical
  shape and rationale to app/api/resumes/[id]/analysis-status/route.ts (see
  that route's own docstring), including server-side cleanup of a failed
  row + its Storage object on first observation.
*/
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("cover_letters")
    .select(
      "id, storage_path, analysis_status, analysis_stage, analysis_stage_updated_at, analysis_started_at, analysis_error_code, analysis_error_summary, parsed_data, original_text"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Cover letter not found." }, { status: 404 });
  }

  if (row.analysis_status === "succeeded") {
    return NextResponse.json({
      status: "succeeded",
      coverLetterId: row.id,
      data: row.parsed_data,
    });
  }

  if (row.analysis_status === "failed") {
    const code = row.analysis_error_code;
    const message = row.analysis_error_summary || "Failed to analyze cover letter.";

    /*
      TEMPORARY DIAGNOSTIC - cleanup disabled to preserve the failed row for
      inspection. See app/api/resumes/[id]/analysis-status/route.ts's own
      comment - revert both together after the investigation is complete.
    */
    // if (row.storage_path) {
    //   await supabase.storage.from("cover-letters").remove([row.storage_path]);
    // }
    // await supabase.from("cover_letters").delete().eq("id", row.id).eq("user_id", user.id);

    return NextResponse.json({
      status: "failed",
      coverLetterId: row.id,
      code,
      error: message,
    });
  }

  const progress = resolveAnalysisProgress(
    row.analysis_status,
    row.analysis_stage,
    COVER_LETTER_ANALYSIS_STAGE_PROGRESS
  );

  return NextResponse.json({
    status: row.analysis_status || "pending",
    coverLetterId: row.id,
    stage: row.analysis_stage,
    progress,
    stageUpdatedAt: row.analysis_stage_updated_at,
    startedAt: row.analysis_started_at,
  });
}
