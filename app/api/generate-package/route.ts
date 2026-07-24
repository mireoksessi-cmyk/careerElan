import { NextResponse } from "next/server";
import {
  resolveSelectedResume,
  ResumeResolutionError,
} from "@/lib/resume-service";
import { createClient } from "@/lib/supabase-server";
import { logSafeError } from "@/lib/errors/publicError";
import { buildCareerMemoryDraftText } from "@/lib/resume-builder";
import {
  getFirstText,
  fallbackPackage,
  safeResumeResolutionMessage,
} from "@/lib/generatePackage/shared";

/*
  This route is now claim-only: authenticate, resolve+validate the
  selected resume (no AI call - see resume-builder.ts/resolveSelectedResume
  history for why career_memory sources no longer need one here), freeze a
  source snapshot onto the applications row, hand off to the Background
  Function, and return 202 immediately. The actual OpenAI call, prompt
  construction, and post-generation validation live in
  lib/generatePackage/generateCore.ts, run by the background worker - see
  netlify/functions/generate-package-background.ts (production) and
  app/api/internal/generate-package-worker/route.ts (local-dev stand-in).

  Target: auth + source resolution + ownership checks + snapshot + claim +
  enqueue acknowledgement, all inside ~2s, with zero OpenAI calls and zero
  Storage/file reads anywhere in this path.
*/

// How stale a "pending" row (claimed but never reached succeeded/failed)
// has to be before a same-generationRequestId retry is allowed to reclaim
// it instead of getting 409. Sized off the background worker's own OpenAI
// deadline (generateCore.ts's OPENAI_CALL_TIMEOUT_MS = 120s) plus generous
// margin for worker cold start/enqueue latency - not off this route's own
// (now sub-2s) execution time.
const WORKER_STALE_THRESHOLD_MS = 5 * 60 * 1000;

const BACKGROUND_FUNCTION_URL = process.env.BACKGROUND_FUNCTION_URL || "";
const BACKGROUND_FUNCTION_SECRET =
  process.env.BACKGROUND_FUNCTION_SECRET || "";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  let applicationId: string | null = null;
  let userId: string | null = null;

  try {
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

    userId = user.id;

    const body = await req.json();

    const analysis = body.jobAnalysis || {};
    const jobText = getFirstText(body.jobDescription);
    const title =
      getFirstText(analysis.title, analysis.jobTitle) || "the position";
    const company =
      getFirstText(analysis.company, analysis.companyName) ||
      "the company";

    const { data: memory } = await supabase
      .from("career_memory")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const applicantName =
      [getFirstText(memory?.first_name), getFirstText(memory?.last_name)]
        .filter(Boolean)
        .join(" ") ||
      getFirstText(memory?.full_name) ||
      "Applicant";

    const generationRequestId =
      typeof body.generationRequestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.generationRequestId
      )
        ? body.generationRequestId
        : null;

    if (!generationRequestId) {
      return NextResponse.json(
        {
          error: "A generation request id is required.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 500 }
      );
    }

    if (!BACKGROUND_FUNCTION_URL || !BACKGROUND_FUNCTION_SECRET) {
      return NextResponse.json(
        {
          error: "Background generation is not configured.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 500 }
      );
    }

    /*
      includeGenerationText: false - no AI call for career_memory sources
      (validation only). Ownership/existence/empty-text checks for uploaded
      sources are unconditional inside resolveSelectedResume regardless of
      this flag, so uploaded resumes are still fully validated here.
    */
    let resolvedResume;

    try {
      resolvedResume = await resolveSelectedResume(supabase, user.id, {
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
          {
            error: safeResumeResolutionMessage(error.code),
            ...fallbackPackage(title, company, applicantName),
          },
          { status }
        );
      }

      throw error;
    }

    /*
      Resolve the actual input resume text + display name here, in the
      sync route, so the snapshot stored below is exactly what generateCore
      will use - never re-derived, never re-fetched.

      uploaded: resolveSelectedResume already returned the real,
      already-validated generationText (resume.original_text).
      career_memory: deterministic, non-AI text build from the same
      career_memory row resolveSelectedResume already fetched
      (resolvedResume.previewData) - no separate query.
    */
    const inputResumeText =
      resolvedResume.source === "uploaded"
        ? resolvedResume.generationText
        : buildCareerMemoryDraftText(resolvedResume.previewData);

    if (resolvedResume.source === "career_memory" && !inputResumeText.trim()) {
      return NextResponse.json(
        {
          error: "Career Memory did not produce usable resume text.",
          code: "VALIDATION_FAILED",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 400 }
      );
    }

    if (!jobText) {
      return NextResponse.json(
        {
          error: "The job description could not be loaded.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 400 }
      );
    }

    /*
      Canada-gate, checked before enqueueing the background worker - a
      fast-fail, not the only safeguard (the worker's own
      validateCanadianScope() still re-checks the AI's own determination).
    */
    if (analysis?.jobContext?.supportedByCareerElan === false) {
      return NextResponse.json(
        {
          error:
            "This job posting is not currently supported (Career Élan supports Canadian private-sector, provincial, and municipal postings only).",
          code: "VALIDATION_FAILED",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 400 }
      );
    }

    /*
      Selected saved Cover Letter, if any - snapshotted as a style/tone
      reference only (never as the final output). Missing/deleted is
      treated as "no cover letter selected", not a validation error, since
      it's optional supporting material, not a required input.
    */
    let coverLetterId: string | null = null;
    let inputCoverLetterText: string | null = null;

    if (memory?.selected_cover_letter_id) {
      const { data: selectedCover } = await supabase
        .from("cover_letters")
        .select("id, original_text")
        .eq("id", memory.selected_cover_letter_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (selectedCover) {
        coverLetterId = selectedCover.id;
        inputCoverLetterText =
          getFirstText(selectedCover.original_text) || null;
      }
    }

    const jobUrl = getFirstText(body.jobUrl) || null;
    const appliedDate = new Date().toISOString().split("T")[0];
    const jobDescriptionNormalized = getFirstText(analysis.summary) || null;

    const { data: claimedRow, error: claimInsertError } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        generation_request_id: generationRequestId,
        generation_status: "pending",
        generation_started_at: new Date().toISOString(),
        company,
        job_title: title,
        job_url: jobUrl,
        job_description: jobText,
        job_description_normalized: jobDescriptionNormalized,
        job_analysis: analysis,
        location: getFirstText(analysis.location) || null,
        job_type: getFirstText(analysis.type) || null,
        resume_source: resolvedResume.source,
        resume_id:
          resolvedResume.source === "uploaded"
            ? resolvedResume.resumeId
            : null,
        cover_letter_id: coverLetterId,
        generation_input_resume_text: inputResumeText,
        generation_input_resume_name: resolvedResume.selectedName,
        generation_input_manifest_source: resolvedResume.previewData,
        generation_input_cover_letter_text: inputCoverLetterText,
        applied_date: appliedDate,
        status: "package_generated",
      })
      .select("id")
      .single();

    if (claimInsertError) {
      if (claimInsertError.code === "23505") {
        const { data: existing, error: existingError } = await supabase
          .from("applications")
          .select(
            "id, generation_status, generation_started_at, resume_text, cover_letter_text, email_draft, ai_insight"
          )
          .eq("user_id", user.id)
          .eq("generation_request_id", generationRequestId)
          .single();

        if (existingError || !existing) {
          logSafeError(
            existingError ??
              new Error(
                "Existing generation row not found after unique-constraint conflict."
              ),
            { requestId, route: "/api/generate-package", generationRequestId }
          );

          return NextResponse.json(
            {
              error: "Failed to generate application package. Please try again.",
              requestId,
              ...fallbackPackage(title, company, applicantName),
            },
            { status: 500 }
          );
        }

        if (existing.generation_status === "succeeded") {
          return NextResponse.json({
            resume: existing.resume_text,
            coverLetter: existing.cover_letter_text,
            emailDraft: existing.email_draft,
            packageAnalysis: existing.ai_insight,
            selectedResume: {
              source: resolvedResume.source,
              resumeId: resolvedResume.resumeId,
              selectedName: resolvedResume.selectedName,
            },
            applicationId: existing.id,
          });
        }

        const pendingStartedAt = existing.generation_started_at
          ? new Date(existing.generation_started_at).getTime()
          : 0;
        const pendingAgeMs = Date.now() - pendingStartedAt;

        if (
          existing.generation_status === "pending" &&
          pendingAgeMs < WORKER_STALE_THRESHOLD_MS
        ) {
          return NextResponse.json(
            {
              error:
                "Generation is already in progress for this job. Please wait a moment and check Job Tracker.",
              code: "GENERATION_IN_PROGRESS",
              applicationId: existing.id,
            },
            { status: 409 }
          );
        }

        /*
          "failed" or stale "pending" - reclaim this row. The snapshot
          columns (generation_input_*, resume_id, cover_letter_id,
          resume_source) are deliberately NOT touched here: the same
          generationRequestId must always regenerate from the exact same
          input it was first claimed with, never a refreshed Dashboard
          selection. generation_worker_claimed_at IS reset to NULL so the
          worker's atomic claim can run again for this retry.
        */
        applicationId = existing.id;

        await supabase
          .from("applications")
          .update({
            generation_status: "pending",
            generation_started_at: new Date().toISOString(),
            generation_worker_claimed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId)
          .eq("user_id", user.id);
      } else {
        logSafeError(claimInsertError, {
          requestId,
          route: "/api/generate-package",
          generationRequestId,
        });

        return NextResponse.json(
          {
            error: "Failed to generate application package. Please try again.",
            requestId,
            ...fallbackPackage(title, company, applicantName),
          },
          { status: 500 }
        );
      }
    } else {
      applicationId = claimedRow.id;
    }

    /*
      Enqueue the background worker and wait for its 202 acknowledgement
      (not for the generation itself - the worker keeps running after this
      response is sent). Any failure to enqueue must not leave the row
      stuck at "pending" forever.
    */
    try {
      const enqueueRes = await fetch(BACKGROUND_FUNCTION_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${BACKGROUND_FUNCTION_SECRET}`,
        },
        body: JSON.stringify({ applicationId, generationRequestId }),
      });

      if (enqueueRes.status !== 202) {
        throw new Error(
          `Background function returned ${enqueueRes.status}, expected 202.`
        );
      }
    } catch (enqueueError) {
      logSafeError(enqueueError, {
        requestId,
        route: "/api/generate-package#enqueue",
        userId,
        generationRequestId,
      });

      await supabase
        .from("applications")
        .update({
          generation_status: "failed",
          generation_error_code: "BACKGROUND_ENQUEUE_FAILED",
          generation_error_summary:
            "Could not start AI generation. Please try again.",
          generation_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)
        .eq("user_id", userId);

      return NextResponse.json(
        {
          error: "Could not start AI generation. Please try again.",
          code: "BACKGROUND_ENQUEUE_FAILED",
          requestId,
          applicationId,
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        applicationId,
        generationRequestId,
        selectedResume: {
          source: resolvedResume.source,
          resumeId: resolvedResume.resumeId,
          selectedName: resolvedResume.selectedName,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    if (applicationId) {
      try {
        const supabase = await createClient();

        const updateQuery = supabase
          .from("applications")
          .update({
            generation_status: "failed",
            generation_error_code: "UNKNOWN",
            generation_error_summary:
              "An unexpected error occurred while starting generation.",
            generation_completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId);

        await (userId ? updateQuery.eq("user_id", userId) : updateQuery);
      } catch {
        /*
          Best-effort only - never mask the original error being reported
          below.
        */
      }
    }

    logSafeError(error, { requestId, route: "/api/generate-package" });

    return NextResponse.json(
      {
        error: "Failed to start application package generation. Please try again.",
        code: "UNKNOWN",
        requestId,
        applicationId,
      },
      { status: 500 }
    );
  }
}
