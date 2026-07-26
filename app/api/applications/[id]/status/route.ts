import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  resolveGenerationProgress,
  stripCoverLetterContactBlock,
} from "@/lib/generatePackage/shared";

/*
  Lightweight polling endpoint for the async Generate Package flow -
  introduced in Phase 1 alongside the 202-returning sync claim route.
  Never returns generation_input_* snapshot columns (the resume/job source
  text fed to the AI, or applicant PII embedded in the manifest snapshot)
  - only status and, once succeeded, the actual output documents, exactly
  matching what the old synchronous response used to return in one shot.

  Not yet called by any frontend code in Phase 1 (paste-job polling UI is
  explicitly out of scope for this phase) - this route exists and is
  tested on its own so Phase 2 only has to wire a fetch loop to it.
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
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  const { data: row, error } = await supabase
    .from("applications")
    .select(
      "id, generation_status, generation_stage, generation_stage_updated_at, generation_started_at, generation_error_code, generation_error_summary, resume_text, cover_letter_text, email_draft, ai_insight, resume_source, resume_id, generation_input_resume_name, company, job_title, location, job_type, job_url, job_analysis"
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

  /*
    Real, worker-reported progress only - never a time-based guess. See
    resolveGenerationProgress()'s own doc comment for why this mapping
    lives in exactly one place (here) rather than being duplicated on the
    frontend. stageUpdatedAt/startedAt/elapsedSeconds are included
    alongside so the client can show "how long in this stage" without
    computing its own clock skew against the server.
  */
  const progressInfo = {
    stage: row.generation_stage,
    progress: resolveGenerationProgress(
      row.generation_status,
      row.generation_stage
    ),
    stageUpdatedAt: row.generation_stage_updated_at,
    startedAt: row.generation_started_at,
    elapsedSeconds: row.generation_started_at
      ? Math.max(
          0,
          Math.round(
            (Date.now() - new Date(row.generation_started_at).getTime()) /
              1000
          )
        )
      : null,
  };

  /*
    Job posting identity/analysis fields - never PII (no applicant name,
    resume/cover-letter text, or generation_input_* snapshot data), safe to
    return regardless of generation_status so a caller recovering after
    navigation (e.g. arriving via ?applicationId=... from Job Tracker, or a
    tab reopened after the sessionStorage-only recovery entry was lost) can
    reconstruct the "what job was this" panel even while still pending or
    after a failure, not only on success.
  */
  const jobContext = {
    jobTitle: row.job_title,
    company: row.company,
    location: row.location,
    jobType: row.job_type,
    jobUrl: row.job_url,
    jobAnalysis: row.job_analysis,
  };

  if (row.generation_status === "succeeded") {
    return NextResponse.json({
      status: "succeeded",
      applicationId: row.id,
      resume: row.resume_text,
      coverLetter: row.cover_letter_text
        ? stripCoverLetterContactBlock(row.cover_letter_text)
        : row.cover_letter_text,
      emailDraft: row.email_draft,
      packageAnalysis: row.ai_insight,
      selectedResume: {
        source: row.resume_source,
        resumeId: row.resume_id,
        selectedName: row.generation_input_resume_name,
      },
      ...jobContext,
      ...progressInfo,
    });
  }

  if (row.generation_status === "failed") {
    return NextResponse.json({
      status: "failed",
      applicationId: row.id,
      code: row.generation_error_code,
      error: row.generation_error_summary,
      ...jobContext,
      ...progressInfo,
    });
  }

  return NextResponse.json({
    status: row.generation_status || "pending",
    applicationId: row.id,
    ...jobContext,
    ...progressInfo,
  });
}
