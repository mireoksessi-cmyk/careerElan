import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  RESUME_ANALYSIS_STAGE_PROGRESS,
  resolveAnalysisProgress,
} from "@/lib/documentAnalysis/shared";

/*
  Polling endpoint for the async Resume analysis flow - mirrors
  app/api/applications/[id]/status/route.ts exactly (see that route's own
  docstring). One addition beyond that pattern: since a resumes row is now
  inserted (with analysis_status='pending') BEFORE analysis is known to
  succeed - unlike the old synchronous flow, which never inserted a row
  until parsing had already succeeded - a row that ends up 'failed' would
  otherwise linger in Dashboard's resume list as a permanent, unusable
  placeholder. The first poll to observe 'failed' deletes the row and its
  Storage object here, server-side, so cleanup does not depend on the
  client still being on the page (though the client's own error handling
  no longer needs to do this deletion itself, unlike the old sync flow).
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
    .from("resumes")
    .select(
      "id, storage_path, analysis_status, analysis_stage, analysis_stage_updated_at, analysis_started_at, analysis_error_code, analysis_error_summary, parsed_data, original_text"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Resume not found." }, { status: 404 });
  }

  if (row.analysis_status === "succeeded") {
    return NextResponse.json({
      status: "succeeded",
      resumeId: row.id,
      data: row.parsed_data,
    });
  }

  if (row.analysis_status === "failed") {
    const code = row.analysis_error_code;
    const message = row.analysis_error_summary || "Failed to analyze resume.";

    if (row.storage_path) {
      await supabase.storage.from("resumes").remove([row.storage_path]);
    }

    await supabase.from("resumes").delete().eq("id", row.id).eq("user_id", user.id);

    return NextResponse.json({
      status: "failed",
      resumeId: row.id,
      code,
      error: message,
    });
  }

  const progress = resolveAnalysisProgress(
    row.analysis_status,
    row.analysis_stage,
    RESUME_ANALYSIS_STAGE_PROGRESS
  );

  return NextResponse.json({
    status: row.analysis_status || "pending",
    resumeId: row.id,
    stage: row.analysis_stage,
    progress,
    stageUpdatedAt: row.analysis_stage_updated_at,
    startedAt: row.analysis_started_at,
  });
}
