import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
  Lightweight polling endpoint for the async Generate Package flow. Never
  returns generation_input_* snapshot columns (the resume/job source text
  fed to the AI) - only status and, once succeeded, the actual output
  documents, matching what the old synchronous response used to return.
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
    return NextResponse.json(
      { error: "Unauthorized.", code: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  const { data: row, error } = await supabase
    .from("applications")
    .select(
      "id, generation_status, generation_error_code, generation_error_summary, resume_text, cover_letter_text, email_draft, ai_insight, resume_source, resume_id, generation_input_resume_name"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }

  if (row.generation_status === "succeeded") {
    return NextResponse.json({
      status: "succeeded",
      applicationId: row.id,
      resume: row.resume_text,
      coverLetter: row.cover_letter_text,
      emailDraft: row.email_draft,
      packageAnalysis: row.ai_insight,
      selectedResume: {
        source: row.resume_source,
        resumeId: row.resume_id,
        selectedName: row.generation_input_resume_name,
      },
    });
  }

  if (row.generation_status === "failed") {
    return NextResponse.json({
      status: "failed",
      applicationId: row.id,
      code: row.generation_error_code,
      error: row.generation_error_summary,
    });
  }

  return NextResponse.json({
    status: row.generation_status || "pending",
    applicationId: row.id,
  });
}
