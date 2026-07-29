import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
  Read-only polling endpoint for the async Resume analysis flow. Reports
  whatever analysis_status, analysis_error_code, analysis_error_summary,
  and parsed_data already say - those columns are written exclusively by
  runResumeAnalysis's own atomic claim + RPC writes
  (lib/documentAnalysis/resumeAnalysisCore.ts, unchanged). This route
  never mutates anything and never deletes the Storage object or the row
  - cleanup-on-terminal-failure is decided client-side in
  app/career-memory/page.tsx, exactly where the existing (already-
  verified) success/failure UI handling already lives, so this route
  staying pure-read keeps that single source of truth intact.
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
    .select("id, analysis_status, analysis_error_code, analysis_error_summary, parsed_data")
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
    return NextResponse.json({
      status: "failed",
      resumeId: row.id,
      code: row.analysis_error_code || "UNKNOWN",
      message: row.analysis_error_summary || "Failed to analyze resume.",
    });
  }

  return NextResponse.json({
    status: row.analysis_status || "pending",
    resumeId: row.id,
  });
}
