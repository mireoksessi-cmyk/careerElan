import { NextResponse } from "next/server";
import {
  resolveSelectedResume,
  ResumeResolutionError,
} from "@/lib/resume-service";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSafeError } from "@/lib/errors/publicError";
import { buildCareerMemoryDraftText } from "@/lib/resume-builder";
import { normalizeResumeTemplateId } from "@/lib/brand/render/templateId";
import {
  GENERATE_PACKAGE_MONTHLY_LIMIT,
  isNetlifyProductionRuntime,
} from "@/lib/config/packageQuota";
import {
  resolveBackgroundFunctionSecret,
  resolveBackgroundFunctionUrl,
  isNetlifyRuntime,
  detectNetlifyRuntimeSource,
  getRuntimeDiagnosticsSnapshot,
} from "@/lib/generatePackage/backgroundTarget";
import {
  getFirstText,
  fallbackPackage,
  safeResumeResolutionMessage,
  stripCoverLetterContactBlock,
  type GenerationMode,
  type LayoutConstraints,
} from "@/lib/generatePackage/shared";
import { entitlementEmailHmac } from "@/lib/security/generatePackageEntitlementIdentity";
import { decideGenerationRoute } from "@/lib/careerMemory/orchestration/canonicalTrafficRouter";
import { dispatchCanonicalGeneration } from "@/lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { logCanonicalMetric } from "@/lib/careerMemory/orchestration/canonicalProductionMetrics";

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
  Bounds only the wait for the enqueue call's 202 acknowledgement, never
  the generation itself (which keeps running after this resolves - see
  enqueueBackgroundWorker's own doc comment). Without this, a network-
  level hang on the fetch() to the Background Function/internal route
  could leave this request awaiting indefinitely instead of failing fast
  into the existing "mark failed, refund quota" path below.
*/
const ENQUEUE_FETCH_TIMEOUT_MS = 10 * 1000;

/*
  Immediately refunds a quota reservation on any early-return failure path
  after it was taken - never left to the outer catch block alone, since
  several failure paths below (missing OPENAI_API_KEY, resume resolution
  errors, the applications claim itself failing) return directly instead
  of throwing. Best-effort: the reserve_generate_package_usage() reconcile
  step is a second, delayed safety net for any path this call itself
  can't reach, so a release failure here is logged, never thrown.

  Stage 2B: the id passed in is the id the reservation was actually MADE
  under - the founding entitlement owner, which is not necessarily the
  current auth user - because release_generate_package_usage() matches on
  (p_user_id, p_request_id). Passing the auth uuid instead would silently
  refund nothing. It is null whenever no reservation was taken, which the
  guard below already treats as a no-op.
*/
async function releaseQuotaReservation(
  quotaReserved: boolean,
  reservationOwnerId: string | null,
  generationRequestId: string | null,
  context: { requestId: string }
) {
  if (!quotaReserved || !reservationOwnerId || !generationRequestId) {
    return;
  }

  try {
    const { error } = await supabaseAdmin.rpc(
      "release_generate_package_usage",
      {
        p_user_id: reservationOwnerId,
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
async function enqueueBackgroundWorker(params: {
  requestOrigin: string;
  applicationId: string;
  generationRequestId: string;
  requestStartedAt: number;
  requestHostname: string;
  requestProtocol: string;
}) {
  const {
    requestOrigin,
    applicationId,
    generationRequestId,
    requestStartedAt,
    requestHostname,
    requestProtocol,
  } = params;

  const secret = resolveBackgroundFunctionSecret();

  if (!secret) {
    throw new Error("Background generation is not configured.");
  }

  const { url: backgroundUrl, originSource: selectedOriginSource } =
    resolveBackgroundFunctionUrl(requestOrigin);
  const selectedTargetType = isNetlifyRuntime()
    ? "netlify_background_function"
    : "internal_worker_route";
  const selectedTargetUrl = new URL(backgroundUrl);
  const selectedTargetHostname = selectedTargetUrl.hostname;
  const selectedTargetPath = selectedTargetUrl.pathname;

  /*
    Diagnostics-only (see the "package worker runtime diagnostics"
    investigation) - never affects which target is actually chosen (that
    decision already happened above, via the same
    resolveBackgroundFunctionUrl()/isNetlifyRuntime() this route already
    used before this diagnostic logging existed) - only records what was
    chosen and why, so a real Production request can be traced end to
    end. Only hostname/pathname are logged, never the full URL (which
    could otherwise carry a query string in some future change) - and
    never the secret itself, the Authorization header, or any
    request/response body content.
  */
  console.log(
    JSON.stringify({
      event: "package_worker_target_resolved",
      applicationId,
      generationRequestId,
      ...getRuntimeDiagnosticsSnapshot(),
      runtimeDetectedBy: detectNetlifyRuntimeSource(),
      selectedTargetType,
      selectedTargetHostname,
      selectedTargetPath,
      selectedOriginSource,
      requestHostname,
      requestProtocol,
    })
  );

  const enqueueStartedAt = Date.now();

  console.log(
    JSON.stringify({
      event: "package_worker_enqueue_started",
      applicationId,
      generationRequestId,
      selectedTargetType,
      selectedTargetHostname,
      selectedTargetPath,
      startedAt: new Date(enqueueStartedAt).toISOString(),
      elapsedFromRequestStartMs: enqueueStartedAt - requestStartedAt,
    })
  );

  /*
    Bounds only the wait for the 202 acknowledgement itself - see
    ENQUEUE_FETCH_TIMEOUT_MS's own doc comment. AbortSignal.timeout is
    available in every Node runtime this app targets, but a defensive
    AbortController fallback is kept in case a future runtime downgrade
    ever lacks it, so a timeout can never silently stop being enforced.
  */
  const enqueueTimeoutSignal =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ENQUEUE_FETCH_TIMEOUT_MS)
      : (() => {
          const controller = new AbortController();
          setTimeout(
            () => controller.abort(new Error("Enqueue fetch timed out.")),
            ENQUEUE_FETCH_TIMEOUT_MS
          );
          return controller.signal;
        })();

  let enqueueRes: Response;

  try {
    enqueueRes = await fetch(backgroundUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ applicationId, generationRequestId }),
      signal: enqueueTimeoutSignal,
    });
  } catch (fetchError) {
    console.log(
      JSON.stringify({
        event: "package_worker_enqueue_failed",
        applicationId,
        generationRequestId,
        selectedTargetType,
        selectedTargetHostname,
        selectedTargetPath,
        durationMs: Date.now() - enqueueStartedAt,
        timedOut:
          fetchError instanceof Error && fetchError.name === "TimeoutError",
        errorName:
          fetchError instanceof Error ? fetchError.name : "Unknown",
        errorMessage:
          fetchError instanceof Error
            ? fetchError.message
            : "Unknown error",
      })
    );

    throw fetchError;
  }

  console.log(
    JSON.stringify({
      event: "package_worker_enqueue_finished",
      applicationId,
      generationRequestId,
      selectedTargetType,
      selectedTargetHostname,
      selectedTargetPath,
      responseStatus: enqueueRes.status,
      responseOk: enqueueRes.ok,
      durationMs: Date.now() - enqueueStartedAt,
      redirectOccurred: enqueueRes.redirected,
      responseHostname: enqueueRes.url
        ? new URL(enqueueRes.url).hostname
        : null,
      responsePathname: enqueueRes.url
        ? new URL(enqueueRes.url).pathname
        : null,
    })
  );

  if (enqueueRes.status !== 202) {
    throw new Error(
      `Background function returned ${enqueueRes.status}, expected 202.`
    );
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  // Diagnostics-only anchor for elapsedFromRequestStartMs below.
  const requestStartedAt = Date.now();

  let applicationId: string | null = null;
  let userId: string | null = null;
  let generationRequestId: string | null = null;
  let quotaReserved = false;
  let reservationOwnerId: string | null = null;

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
      Stage 2B - resolve the entitlement identity ONCE, here, before the
      routing decision below. Both engines then reserve against the same
      verified-email-derived claim, and a request that fails this gate reaches
      neither of them.

      Scoped to isNetlifyProductionRuntime() because that is exactly the
      condition under which either engine reserves quota at all. Outside it
      nothing is metered, so nothing here runs and non-production behaviour is
      unchanged.
    */
    let emailHmac: string | null = null;

    if (isNetlifyProductionRuntime()) {
      /*
        Free vs paid is decided from the SUBSCRIPTION, never from the numeric
        limit: admin_user_quota_overrides can set any limit for any user, so a
        limit of 3 does not imply Free. 'active'/'trialing' are precisely the
        statuses resolve_generate_package_quota_limit() treats as plan-granting
        (20260817000000_admin_user_controls.sql), so this stays in step with the
        limit the database will actually apply.
      */
      const { data: planGrantingSubscription, error: subscriptionError } =
        await supabaseAdmin
          .from("subscriptions")
          .select("plan_key")
          .eq("user_id", user.id)
          .in("status", ["active", "trialing"])
          // limit(1) because only EXISTENCE matters here, and a user can legitimately hold more than one active/trialing row; resolve_generate_package_quota_limit() tolerates that the same way (a non-STRICT SELECT INTO). Without it maybeSingle() would 500 on a duplicate rather than answering the question asked.
          .limit(1)
          .maybeSingle();

      if (subscriptionError) {
        logSafeError(subscriptionError, {
          requestId,
          route: "/api/generate-package",
          generationRequestId,
        });

        return NextResponse.json(
          {
            error:
              "We could not verify your monthly usage. Please try again in a moment.",
            requestId,
          },
          { status: 500 }
        );
      }

      /*
        The address comes only from the server-side session User - never the
        request body, the profile row, or Career Memory. Free callers must have
        confirmed it before any allowance is spent, because an unconfirmed
        address proves nothing and would let one person mint an unlimited number
        of distinct entitlements. Paid callers are not gated on confirmation.
      */
      if (!planGrantingSubscription && !user.email_confirmed_at) {
        return NextResponse.json(
          {
            error:
              "Please confirm your email address before generating a package.",
            code: "EMAIL_CONFIRMATION_REQUIRED",
            requestId,
          },
          { status: 403 }
        );
      }

      /*
        No address means no entitlement identity can be derived. Fail closed:
        falling back to the current auth uuid here would hand a recreated
        account a fresh monthly allowance, which is the exact bypass this
        design exists to prevent.
      */
      if (!user.email) {
        return NextResponse.json(
          {
            error:
              "We could not verify your monthly usage. Please try again in a moment.",
            requestId,
          },
          { status: 500 }
        );
      }

      try {
        emailHmac = entitlementEmailHmac(user.email);
      } catch (entitlementIdentityError) {
        /*
          Missing or misconfigured secret in production. Logged without the
          address, the digest or the secret, and never downgraded to a
          per-uuid fallback - a retryable failure is the safe outcome.
        */
        logSafeError(entitlementIdentityError, {
          requestId,
          route: "/api/generate-package",
          generationRequestId,
        });

        return NextResponse.json(
          {
            error:
              "We could not verify your monthly usage. Please try again in a moment.",
            requestId,
          },
          { status: 500 }
        );
      }
    }

    /*
      Phase 6I - Part A: the ONE routing dispatch point. decideGenerationRoute()
      is the single, isolated routing decision service (see its own file) -
      this route never re-implements or inlines its logic, only branches on
      the result. Everything above this point (auth, body parsing,
      career_memory fetch, generationRequestId validation) is shared input
      resolution both routes need identically; everything below (quota
      reservation, claim-insert, enqueue) is legacy-specific and completely
      untouched by this phase - a canonical-routed request never reaches any
      of it, it is handled entirely by dispatchCanonicalGeneration() (its own
      file, its own quota reservation, its own claim-insert, its own
      enqueue) and returns directly from this branch.
    */
    const routingDecision = decideGenerationRoute(user.id);
    logCanonicalMetric({ event: "canonical_routing_decision", route: routingDecision.route, reason: routingDecision.reason, stage: routingDecision.stage });
    if (routingDecision.route === "canonical") {
      return await dispatchCanonicalGeneration({
        supabase,
        userId: user.id,
        /*
          Stage 2B: the entitlement claim is resolved once, above, and handed
          to the canonical engine rather than recomputed there - so the two
          engines cannot drift apart on gating rules, and the HMAC secret and
          the raw address stay confined to this file.
        */
        emailHmac,
        memory,
        generationRequestId,
        jobText,
        title,
        company,
        applicantName,
        analysis,
        jobUrl: getFirstText(body.jobUrl) || null,
        body,
        requestOrigin: new URL(req.url).origin,
        routingReason: routingDecision.reason,
        canaryStage: routingDecision.stage,
      });
    }

    /*
      Phase 6I.6.23 - MONTHLY (calendar-month, UTC) Generate Package quota
      - Production only (see isNetlifyProductionRuntime()'s doc comment).
      Reserves against the same generationRequestId already used for the
      applications-table idempotent claim below, so a retry/double-click/
      recovery-poll with the same id can never be double-charged -
      reserve_generate_package_usage() is itself idempotent per (user_id,
      request_id). Runs before the applications claim and before
      enqueueing the worker, so a caller at their limit never reaches
      either - and, since this is the only call site that ever invokes an
      AI-bound worker for the legacy engine, a blocked caller here also
      guarantees 0 OpenAI invocations. Unchanged from the pre-Phase-1
      synchronous route. The RPC ignores p_limit and resolves the real
      limit itself server-side (per-user, via resolve_generate_package_
      quota_limit()) - GENERATE_PACKAGE_MONTHLY_LIMIT below is only the
      required-but-unused parameter value and a display fallback.
    */
    if (isNetlifyProductionRuntime()) {
      /*
        Stage 2B: emailHmac is non-null on every path that reaches here - the
        gate above returns before this point otherwise. Re-checked rather than
        asserted so that a future edit which loosens that gate fails closed
        instead of sending a null claim to the database.
      */
      if (!emailHmac) {
        return NextResponse.json(
          {
            error:
              "We could not verify your monthly usage. Please try again in a moment.",
            requestId,
          },
          { status: 500 }
        );
      }

      const { data: quotaRows, error: quotaError } =
        await supabaseAdmin.rpc(
          "reserve_generate_package_usage_for_entitlement",
          {
            /*
              p_user_id stays the CURRENT auth user: the RPC resolves this
              caller's plan limit (subscription / admin override) from it. Only
              the usage counter is moved onto the founding entitlement owner
              that p_email_hmac resolves to, so a returning user keeps their own
              plan's limit while a recreated account inherits its prior usage.
            */
            p_user_id: user.id,
            p_email_hmac: emailHmac,
            p_request_id: generationRequestId,
            p_limit: GENERATE_PACKAGE_MONTHLY_LIMIT,
          }
        );

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
        const used = quota?.used ?? GENERATE_PACKAGE_MONTHLY_LIMIT;
        return NextResponse.json(
          {
            error:
              "You've reached your monthly Generate Package limit. You can generate up to " +
              GENERATE_PACKAGE_MONTHLY_LIMIT +
              " packages per month.",
            code: "GENERATE_PACKAGE_LIMIT_REACHED",
            // used + remaining (remaining is always 0 in this branch) reflects
            // the RPC's own server-resolved limit for THIS user, rather than
            // this file's own display constant - correct today (both equal 3)
            // and correct without any change if a future Pro entitlement ever
            // resolves to a different per-user limit server-side.
            limit: used + (quota?.remaining ?? 0),
            used,
            remaining: 0,
          },
          { status: 429 }
        );
      }

      /*
        The reservation was made against the founding entitlement owner, not
        necessarily this auth user, so every later completion/release for this
        request must target that same id. There is deliberately NO fallback to
        user.id here: if the RPC did not return an owner the reservation cannot
        be reconciled, so we fail closed and leave the row to the RPC's own
        stale-reservation reclaim rather than completing it under the wrong id.
      */
      if (!quota.entitlement_owner_id) {
        logSafeError(
          new Error(
            "Quota reservation returned no entitlement owner."
          ),
          {
            requestId,
            route: "/api/generate-package",
            generationRequestId,
          }
        );

        return NextResponse.json(
          {
            error:
              "We could not verify your monthly usage. Please try again in a moment.",
            requestId,
          },
          { status: 500 }
        );
      }

      reservationOwnerId = quota.entitlement_owner_id;
      quotaReserved = true;
    }

    if (!process.env.OPENAI_API_KEY) {
      await releaseQuotaReservation(
        quotaReserved,
        reservationOwnerId,
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
          reservationOwnerId,
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
        reservationOwnerId,
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
        reservationOwnerId,
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

    /*
      Document Preservation Engine (DPE) Phase 4B completion - optional
      Layout Compression Request (see lib/generatePackage/shared.ts's own
      GenerationMode/LayoutConstraints comment). Absent for every normal
      Paste Job / Dashboard call (the ONLY caller today) - this route
      never constructs these itself, it only forwards them if a caller
      (the DPE's own compressionRetry.ts) provides them, so the normal
      path's insert is byte-identical to before this phase whenever these
      two fields are omitted.
    */
    const dpeMode: GenerationMode | null =
      body.dpeMode === "layout_compression" ? "layout_compression" : null;
    const dpeLayoutConstraints: LayoutConstraints | null =
      dpeMode === "layout_compression" &&
      body.dpeLayoutConstraints &&
      typeof body.dpeLayoutConstraints === "object"
        ? (body.dpeLayoutConstraints as LayoutConstraints)
        : null;

    const { data: claimedRow, error: claimInsertError } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        generation_request_id: generationRequestId,
        /*
          Stage 2B: records the id this generation's quota reservation was
          actually taken under, so the worker's completion/release path
          (lib/generatePackage/generateCore.ts, via
          claim_generate_package_worker) targets the same id rather than
          user_id. Null outside the metered runtime, where no reservation
          exists - which reads back as the legacy model, exactly as it did
          before Stage 2B. Never client-supplied.
        */
        entitlement_owner_id: reservationOwnerId,
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
        cover_letter_id: memory?.selected_cover_letter_id ?? null,
        /*
          Snapshot of the template active in Career Memory at generation
          time - reuses the `memory` row already fetched above (no extra
          query). See lib/brand/render/templateId.ts: this is what keeps
          Job Tracker Preview/PDF/DOCX rendering this application with the
          template that was selected when it was generated, even if the
          user later changes their Career Memory default.
        */
        resume_template_id: normalizeResumeTemplateId(memory?.resume_template),
        generation_input_resume_text: inputResumeText,
        generation_input_resume_name: resolvedResume.selectedName,
        generation_input_manifest_source: resolvedResume.previewData,
        generation_input_cover_letter_text: inputCoverLetterText,
        dpe_generation_mode: dpeMode,
        dpe_layout_constraints: dpeLayoutConstraints,
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
            reservationOwnerId,
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
          if (quotaReserved && generationRequestId && reservationOwnerId) {
            const { error: completeError } = await supabaseAdmin.rpc(
              "complete_generate_package_usage",
              {
                p_user_id: reservationOwnerId,
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
              reservationOwnerId,
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
            /*
              Stage 2B: this re-enqueue is charged against the reservation
              taken by THIS request, so the row must point at that
              reservation's owner rather than whatever a prior attempt
              recorded. Realigns pre-Stage-2B rows (NULL) onto the owner the
              worker must complete under; a no-op when a prior attempt already
              recorded the same owner, since the same address always resolves
              to the same founding owner. Not an input-snapshot column, so the
              rule above does not apply to it.
            */
            entitlement_owner_id: reservationOwnerId,
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
          reservationOwnerId,
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
      const requestUrl = new URL(req.url);
      const requestOrigin = requestUrl.origin;

      await enqueueBackgroundWorker({
        requestOrigin,
        applicationId: claimedApplicationId,
        generationRequestId,
        requestStartedAt,
        requestHostname: requestUrl.hostname,
        requestProtocol: requestUrl.protocol,
      });

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
        reservationOwnerId,
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
      reservationOwnerId,
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
