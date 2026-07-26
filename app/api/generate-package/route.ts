import { NextResponse } from "next/server";
import {
  resolveSelectedResume,
  ResumeResolutionError,
} from "@/lib/resume-service";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSafeError } from "@/lib/errors/publicError";
import { buildCareerMemoryDraftText } from "@/lib/resume-builder";
import {
  GENERATE_PACKAGE_LIFETIME_LIMIT,
  isNetlifyProductionRuntime,
} from "@/lib/config/packageQuota";
import {
  resolveBackgroundFunctionSecret,
  resolveBackgroundFunctionUrl,
} from "@/lib/generatePackage/backgroundTarget";
import {
  getFirstText,
  fallbackPackage,
  safeResumeResolutionMessage,
  stripCoverLetterContactBlock,
} from "@/lib/generatePackage/shared";

/*
  Phase 1 async rewrite: this route is now claim-only. It authenticates,
  reserves quota, resolves+validates the selected resume (no AI call ever
  happens here - career_memory sources use buildCareerMemoryDraftText, a
  deterministic, non-AI text builder, instead of the old AI-polish step),
  freezes an immutable "source snapshot" onto the applications row, hands
  off to the background worker, and returns 202 immediately. The actual
  OpenAI call, prompt construction, and post-generation validation now
  live in lib/generatePackage/generateCore.ts, run by the worker - see
  netlify/functions/generate-package-background.ts (Production trigger)
  and app/api/internal/generate-package-worker/route.ts (local-dev
  stand-in).

  Target: auth + source resolution + ownership checks + snapshot + claim +
  enqueue acknowledgement, all well under a second, with zero OpenAI calls
  and zero long-running work of any kind in this request.
*/

// How stale a "pending" row (claimed by this route but never reached
// succeeded/failed by the worker) has to be before a same-generationRequestId
// retry is allowed to reclaim it instead of getting 409. Sized off the
// background worker's own OpenAI deadline (generateCore.ts's
// OPENAI_CALL_TIMEOUT_MS = 120s) plus generous margin for worker cold
// start/enqueue latency - not off this route's own (now sub-second)
// execution time.
const WORKER_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/*
  How long a claim can go completely un-started (generation_worker_claimed_at
  still null) - measured from the row's created_at, which no reclaim below
  ever touches, so it keeps counting across multiple reclaim attempts -
  before this route gives up entirely instead of reclaiming again. Sized as
  WORKER_STALE_THRESHOLD_MS (the point a first automatic retry becomes
  eligible) plus a 90s grace window for that retry's own re-enqueue to
  actually get claimed, matching the client's own give-up wait
  (app/paste-job/page.tsx). A row that is still unclaimed this long after
  its very first attempt has had two full chances to start and has not -
  continuing to reclaim it indefinitely would silently keep the user
  waiting forever with nothing left to try.
*/
const GIVE_UP_THRESHOLD_MS = WORKER_STALE_THRESHOLD_MS + 90 * 1000;

/*
  Immediately refunds a quota reservation on any early-return failure path
  after it was taken - never left to the outer catch block alone, since
  several failure paths below (missing OPENAI_API_KEY, resume resolution
  errors, the applications claim itself failing) return directly instead
  of throwing. Best-effort: the reserve_generate_package_usage() reconcile
  step is a second, delayed safety net for any path this call itself
  can't reach, so a release failure here is logged, never thrown.
*/
async function releaseQuotaReservation(
  quotaReserved: boolean,
  userId: string | null,
  generationRequestId: string | null,
  context: { requestId: string }
) {
  if (!quotaReserved || !userId || !generationRequestId) {
    return;
  }

  try {
    const { error } = await supabaseAdmin.rpc(
      "release_generate_package_usage",
      {
        p_user_id: userId,
        p_request_id: generationRequestId,
      }
    );

    if (error) {
      logSafeError(error, {
        requestId: context.requestId,
        route: "/api/generate-package",
        generationRequestId,
      });
    }
  } catch (error) {
    logSafeError(error, {
      requestId: context.requestId,
      route: "/api/generate-package",
      generationRequestId,
    });
  }
}

/*
  Enqueues the background worker for an already-claimed applicationId and
  waits only for its 202 acknowledgement (not for the generation itself -
  the worker keeps running after this resolves). Thrown on anything other
  than a clean 202, so the caller can mark the row failed and refund quota
  rather than leaving it stuck at "pending" forever.
*/
async function enqueueBackgroundWorker(
  requestOrigin: string,
  applicationId: string,
  generationRequestId: string
) {
  const secret = resolveBackgroundFunctionSecret();

  if (!secret) {
    throw new Error("Background generation is not configured.");
  }

  const backgroundUrl = resolveBackgroundFunctionUrl(requestOrigin);

  const enqueueRes = await fetch(backgroundUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ applicationId, generationRequestId }),
  });

  if (enqueueRes.status !== 202) {
    throw new Error(
      `Background function returned ${enqueueRes.status}, expected 202.`
    );
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  let applicationId: string | null = null;
  let userId: string | null = null;
  let generationRequestId: string | null = null;
  let quotaReserved = false;

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

    userId = user.id;

    const body = await req.json();

    /*
      Minimal request body - job data only. The client never sends
      applicationData/memory/resumes/covers or any resume text: the server
      resolves the caller's actual selected resume itself, below, using
      only the authenticated user.id. Nothing the client sends can
      substitute for that resolution.
    */
    const analysis = body.jobAnalysis || {};
    const jobText = getFirstText(body.jobDescription);
    const title =
      getFirstText(analysis.title, analysis.jobTitle) || "the position";
    const company =
      getFirstText(analysis.company, analysis.companyName) ||
      "the company";

    /*
      Directly fetched (not client-supplied) - used below for the
      applicant's name, the selected cover letter snapshot, and (for
      career_memory sources) resolveSelectedResume's own ownership-scoped
      copy via preloadedMemory, avoiding a second identical query.
    */
    const { data: memory } = await supabase
      .from("career_memory")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const applicantName =
      [
        getFirstText(memory?.first_name),
        getFirstText(memory?.last_name),
      ]
        .filter(Boolean)
        .join(" ") ||
      getFirstText(memory?.full_name) ||
      "Applicant";

    generationRequestId =
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

    /*
      Lifetime Generate Package quota - Production only (see
      isNetlifyProductionRuntime()'s doc comment). Reserves against the
      same generationRequestId already used for the applications-table
      idempotent claim below, so a retry/double-click/recovery-poll with
      the same id can never be double-charged - reserve_generate_package_
      usage() is itself idempotent per (user_id, request_id). Runs before
      the applications claim and before enqueueing the worker, so a caller
      at their limit never reaches either. Unchanged from the pre-Phase-1
      synchronous route.
    */
    if (isNetlifyProductionRuntime()) {
      const { data: quotaRows, error: quotaError } =
        await supabaseAdmin.rpc("reserve_generate_package_usage", {
          p_user_id: user.id,
          p_request_id: generationRequestId,
          p_limit: GENERATE_PACKAGE_LIFETIME_LIMIT,
        });

      if (quotaError) {
        logSafeError(quotaError, {
          requestId,
          route: "/api/generate-package",
          generationRequestId,
        });

        return NextResponse.json(
          {
            error:
              "Failed to verify your Generate Package usage. Please try again.",
            requestId,
          },
          { status: 500 }
        );
      }

      const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;

      if (!quota?.reserved) {
        return NextResponse.json(
          {
            error: "Generate Package limit reached.",
            code: "GENERATE_PACKAGE_LIMIT_REACHED",
            limit: GENERATE_PACKAGE_LIFETIME_LIMIT,
            used: quota?.used ?? GENERATE_PACKAGE_LIFETIME_LIMIT,
            remaining: 0,
          },
          { status: 429 }
        );
      }

      quotaReserved = true;
    }

    if (!process.env.OPENAI_API_KEY) {
      await releaseQuotaReservation(
        quotaReserved,
        userId,
        generationRequestId,
        { requestId }
      );

      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 500 }
      );
    }

    /*
      includeGenerationText: false - never triggers buildResumeFromCareerMemory's
      OpenAI call. Ownership/existence/empty-text checks for uploaded
      sources are unconditional inside resolveSelectedResume regardless of
      this flag, so uploaded resumes are still fully validated here (Bug2's
      RESUME_TEXT_UNAVAILABLE handling below is unaffected). career_memory
      sources are validated separately, right after, using the
      deterministic draft builder instead.
    */
    let resolvedResume;

    try {
      resolvedResume = await resolveSelectedResume(supabase, user.id, {
        preloadedMemory: memory,
        includeGenerationText: false,
      });
    } catch (error) {
      if (error instanceof ResumeResolutionError) {
        const isResumeTextUnavailable =
          error.code === "EMPTY_GENERATION_TEXT";

        const status =
          error.code === "NO_CAREER_MEMORY" ||
          error.code === "RESUME_NOT_FOUND"
            ? 404
            : error.code === "FETCH_FAILED"
              ? 500
              : isResumeTextUnavailable
                ? 422
                : 400;

        /*
          RESUME_TEXT_UNAVAILABLE covers an uploaded PDF with no
          extractable text (the only case that can reach here, since
          includeGenerationText:false skips the career_memory empty-text
          check inside resolveSelectedResume itself - see the separate
          check just below for that case).
        */
        const errorMessage =
          isResumeTextUnavailable && error.source === "uploaded"
            ? "We couldn't read text from this PDF. Please upload a text-based PDF or paste your resume into Career Memory."
            : safeResumeResolutionMessage(error.code);

        await releaseQuotaReservation(
          quotaReserved,
          userId,
          generationRequestId,
          { requestId }
        );

        return NextResponse.json(
          {
            error: errorMessage,

            ...(isResumeTextUnavailable
              ? { code: "RESUME_TEXT_UNAVAILABLE" }
              : error.code === "RESUME_NOT_FOUND"
                ? { code: "RESUME_NOT_FOUND" }
                : {}),

            ...fallbackPackage(title, company, applicantName),
          },
          { status }
        );
      }

      throw error;
    }

    /*
      Resolve the actual input resume text + display name here, in the
      sync route, so the snapshot stored below is exactly what the worker
      will use - never re-derived, never re-fetched.

      uploaded: resolveSelectedResume's uploaded branch already validated
      non-empty generationText unconditionally - but includeGenerationText
      only suppresses the career_memory AI call, so resolvedResume.
      generationText is still populated correctly for uploaded sources
      (resume.original_text).
      career_memory: deterministic, non-AI text build from the same
      career_memory row resolveSelectedResume already fetched
      (resolvedResume.previewData === memory) - no separate query, no
      OpenAI call.
    */
    const inputResumeText =
      resolvedResume.source === "uploaded"
        ? resolvedResume.generationText
        : buildCareerMemoryDraftText(resolvedResume.previewData);

    if (
      resolvedResume.source === "career_memory" &&
      !inputResumeText.trim()
    ) {
      await releaseQuotaReservation(
        quotaReserved,
        userId,
        generationRequestId,
        { requestId }
      );

      return NextResponse.json(
        {
          error:
            "Career Memory did not produce usable resume text. Please add more detail to your Career Memory.",
          code: "RESUME_TEXT_UNAVAILABLE",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 422 }
      );
    }

    if (!jobText) {
      await releaseQuotaReservation(
        quotaReserved,
        userId,
        generationRequestId,
        { requestId }
      );

      return NextResponse.json(
        {
          error: "The job description could not be loaded.",
          ...fallbackPackage(title, company, applicantName),
        },
        { status: 400 }
      );
    }

    /*
      Selected saved Cover Letter, if any - snapshotted as a style/tone
      reference only (never as the final output). Missing/deleted is
      treated as "no cover letter selected," not a validation error, since
      it's optional supporting material. Server-fetched directly
      (ownership-checked), not read from any client-supplied value.
    */
    let inputCoverLetterText: string | null = null;

    if (memory?.selected_cover_letter_id) {
      const { data: selectedCover } = await supabase
        .from("cover_letters")
        .select("original_text")
        .eq("id", memory.selected_cover_letter_id)
        .eq("user_id", user.id)
        .maybeSingle();

      inputCoverLetterText =
        getFirstText(selectedCover?.original_text) || null;
    } else {
      inputCoverLetterText = getFirstText(memory?.cover_letter) || null;
    }

    /*
      Idempotent claim: the client reuses the same generationRequestId for
      every "Generate Package" click against the same analyzed job, so a
      duplicate request (double-click, retry) lands on the unique
      (user_id, generation_request_id) index below instead of creating a
      second applications row or re-running the AI generation. Unchanged
      from the pre-Phase-1 route.
    */
    const jobUrl = getFirstText(body.jobUrl) || null;
    const appliedDate = new Date().toISOString().split("T")[0];
    const jobDescriptionNormalized = getFirstText(analysis.summary) || null;

    const { data: claimedRow, error: claimInsertError } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        generation_request_id: generationRequestId,
        generation_status: "pending",
        generation_stage: "queued",
        generation_stage_updated_at: new Date().toISOString(),
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
        generation_input_resume_text: inputResumeText,
        generation_input_resume_name: resolvedResume.selectedName,
        generation_input_manifest_source: resolvedResume.previewData,
        generation_input_cover_letter_text: inputCoverLetterText,
        applied_date: appliedDate,
        /*
          status intentionally left unset (null) here - it is the
          user-facing Job Tracker lifecycle field, and must only become
          "package_generated" once the worker actually succeeds. Setting
          it here, before the worker has even been enqueued, is what
          previously let a failed/still-pending attempt show up in Job
          Tracker as a completed package.
        */
      })
      .select("id")
      .single();

    if (claimInsertError) {
      if (claimInsertError.code === "23505") {
        const { data: existing, error: existingError } = await supabase
          .from("applications")
          .select(
            "id, generation_status, created_at, generation_started_at, generation_worker_claimed_at, resume_text, cover_letter_text, email_draft, ai_insight"
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
            {
              requestId,
              route: "/api/generate-package",
              generationRequestId,
            }
          );

          await releaseQuotaReservation(
            quotaReserved,
            userId,
            generationRequestId,
            { requestId }
          );

          return NextResponse.json(
            {
              error:
                "Failed to generate application package. Please try again.",
              requestId,
              ...fallbackPackage(title, company, applicantName),
            },
            { status: 500 }
          );
        }

        if (existing.generation_status === "succeeded") {
          /*
            Idempotent replay - same generationRequestId as an already
            completed attempt. Return the stored result directly (200,
            not 202 - there is nothing left to wait for), without
            re-enqueueing the worker.

            Also (re)confirms the quota row as 'completed' here - this is
            the recovery path for a prior attempt whose generation
            succeeded but whose complete_generate_package_usage() call
            itself failed to run or persist: this call is a no-op if the
            row is already 'completed', and heals it otherwise. Never
            re-reserves or re-charges anything - it only ever flips an
            existing 'reserved' row for this same request_id.
          */
          if (quotaReserved && generationRequestId && userId) {
            const { error: completeError } = await supabaseAdmin.rpc(
              "complete_generate_package_usage",
              {
                p_user_id: userId,
                p_request_id: generationRequestId,
              }
            );

            if (completeError) {
              logSafeError(completeError, {
                requestId,
                route: "/api/generate-package",
                generationRequestId,
              });
            }
          }

          return NextResponse.json({
            success: true,
            status: "succeeded",
            resume: existing.resume_text,
            coverLetter: existing.cover_letter_text
              ? stripCoverLetterContactBlock(existing.cover_letter_text)
              : existing.cover_letter_text,
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

        if (existing.generation_status === "pending") {
          /*
            A worker that has already claimed this row (claim_generate_
            package_worker's atomic UPDATE succeeded, at some point, for
            some invocation of it) may still be genuinely running - a slow
            OpenAI call, or one that started late after a Background
            Function cold-start delay. Never reset its claim or enqueue a
            second worker while that's possible: the worker's own
            OPENAI_CALL_TIMEOUT_MS (120s) and its own catch block are what
            eventually resolve a genuinely stuck *claimed* row to 'failed',
            not this route.
          */
          if (existing.generation_worker_claimed_at !== null) {
            console.log(
              JSON.stringify({
                event: "reclaim skipped because worker already claimed",
                applicationId: existing.id,
              })
            );

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

          const totalAgeMs = existing.created_at
            ? Date.now() - new Date(existing.created_at).getTime()
            : pendingAgeMs;

          /*
            Never claimed at all (the Background Function invocation
            itself never started running - see generate-package-
            background.ts's own docstring on why a 202 does not guarantee
            that), and now old enough since the very first attempt that a
            worker should certainly have started by now even accounting for
            one prior reclaim. Continuing to reclaim forever would just
            keep the user waiting indefinitely with nothing left to try -
            give up instead: mark this attempt failed and refund the quota
            reservation rather than silently re-enqueueing again.
          */
          if (totalAgeMs >= GIVE_UP_THRESHOLD_MS) {
            await supabase
              .from("applications")
              .update({
                generation_status: "failed",
                generation_error_code: "BACKGROUND_WORKER_NOT_STARTED",
                generation_error_summary:
                  "The background worker never started processing this request.",
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id)
              .eq("user_id", user.id);

            console.log(
              JSON.stringify({
                event: "queued job marked failed",
                applicationId: existing.id,
              })
            );

            const hadQuotaReservation = quotaReserved;

            await releaseQuotaReservation(
              quotaReserved,
              userId,
              generationRequestId,
              { requestId }
            );

            console.log(
              JSON.stringify({
                event: hadQuotaReservation
                  ? "quota reservation released"
                  : "quota release skipped because already released",
                userId,
              })
            );

            logSafeError(
              new Error(
                "Background worker never started before give-up threshold."
              ),
              {
                requestId,
                route: "/api/generate-package#give-up",
                userId,
                generationRequestId,
              }
            );

            return NextResponse.json(
              {
                error:
                  "Package generation could not start. No usage was deducted. Please try again.",
                code: "BACKGROUND_WORKER_NOT_STARTED",
                applicationId: existing.id,
              },
              { status: 422 }
            );
          }

          if (pendingAgeMs < WORKER_STALE_THRESHOLD_MS) {
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

          console.log(
            JSON.stringify({
              event: "stale queued job detected",
              applicationId: existing.id,
            })
          );
        }

        /*
          Either generation_status === "failed" (a previous attempt with
          this same id failed), or it's "pending", never claimed, and older
          than WORKER_STALE_THRESHOLD_MS but not yet past
          GIVE_UP_THRESHOLD_MS - almost certainly a worker invocation that
          was killed (or never started) before it could ever reach its own
          success/failure update. Either way: reclaim and reuse this row
          rather than inserting a new one, then fall through to
          re-enqueue.

          The snapshot columns (generation_input_*, resume_id,
          resume_source) are deliberately NOT touched here: the same
          generationRequestId must always regenerate from the exact same
          input it was first claimed with, never a refreshed Dashboard
          selection made between the original attempt and this retry.
          generation_worker_claimed_at IS reset to NULL so the worker's
          own atomic claim can run again for this retry.
        */
        applicationId = existing.id;

        await supabase
          .from("applications")
          .update({
            generation_status: "pending",
            generation_stage: "queued",
            generation_stage_updated_at: new Date().toISOString(),
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

        await releaseQuotaReservation(
          quotaReserved,
          userId,
          generationRequestId,
          { requestId }
        );

        return NextResponse.json(
          {
            error:
              "Failed to generate application package. Please try again.",
            requestId,
            ...fallbackPackage(title, company, applicantName),
          },
          { status: 500 }
        );
      }
    } else {
      applicationId = claimedRow.id;
    }

    if (!applicationId) {
      throw new Error("applicationId was not set after claim.");
    }

    const claimedApplicationId: string = applicationId;

    /*
      Enqueue the background worker and wait only for its 202
      acknowledgement - not for the generation itself, which keeps running
      after this response is sent. Any failure to enqueue must not leave
      the row stuck at "pending" forever, so it's marked failed and the
      quota reservation refunded immediately.
    */
    console.log(
      JSON.stringify({
        event: "automatic re-enqueue attempted",
        applicationId: claimedApplicationId,
      })
    );

    try {
      const requestOrigin = new URL(req.url).origin;

      await enqueueBackgroundWorker(
        requestOrigin,
        claimedApplicationId,
        generationRequestId
      );

      console.log(
        JSON.stringify({
          event: "automatic re-enqueue accepted",
          applicationId: claimedApplicationId,
        })
      );
    } catch (enqueueError) {
      console.log(
        JSON.stringify({
          event: "automatic re-enqueue rejected",
          applicationId: claimedApplicationId,
        })
      );

      logSafeError(enqueueError, {
        requestId,
        route: "/api/generate-package#enqueue",
        userId,
        generationRequestId,
      });

      await releaseQuotaReservation(
        quotaReserved,
        userId,
        generationRequestId,
        { requestId }
      );

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
        success: true,
        status: "processing",
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

        await (userId
          ? updateQuery.eq("user_id", userId)
          : updateQuery);
      } catch {
        /*
          Best-effort only - never mask the original error being reported
          below.
        */
      }
    }

    await releaseQuotaReservation(
      quotaReserved,
      userId,
      generationRequestId,
      { requestId }
    );

    logSafeError(error, {
      requestId,
      route: "/api/generate-package",
    });

    return NextResponse.json(
      {
        error:
          "Failed to start application package generation. Please try again.",
        code: "UNKNOWN",
        requestId,
        applicationId,
      },
      { status: 500 }
    );
  }
}
