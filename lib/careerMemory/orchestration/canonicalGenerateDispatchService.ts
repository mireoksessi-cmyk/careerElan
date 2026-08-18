/*
  Phase 6I - Part A (routing dispatcher) + Part C (quota) + Part D
  (background execution enqueue) call target: the ENTIRE canonical
  branch of app/api/generate-package/route.ts's dispatch point, kept in
  this dedicated module so that route.ts's own legacy code path is
  never touched by this phase (see that file's own dispatch comment).

  Mirrors app/api/generate-package/route.ts's own claim-insert/quota/
  enqueue shape closely - not by re-implementing generation logic (this
  module never calls OpenAI, never renders anything - it only claims a
  row and enqueues a worker), but because "preserve idempotency" and
  "preserve audit trail" mean reusing the SAME quota RPCs, the SAME
  (user_id, generation_request_id) unique-constraint idempotency
  mechanism, and the SAME background-enqueue pattern legacy already
  established and this repo has already verified extensively.

  Writes the legacy-equivalent input snapshot (resume_source, resume_id,
  generation_input_*) onto the claimed row UNCONDITIONALLY, via the
  SAME resolveSelectedResume()/buildCareerMemoryDraftText() helpers
  legacy's own route imports - not because canonical generation needs
  that snapshot (it resolves its runtime fresh from career_profiles at
  generation time), but so that a LATER fallback-to-legacy (Part B,
  canonicalGenerationWorker.ts) never needs a user session to prepare
  one - the row is always already fallback-ready the moment it's
  created. This is reused resolution, not duplicated generation logic.
*/
import { NextResponse } from "next/server";
import { resolveSelectedResume, ResumeResolutionError } from "../../resume-service";
import { supabaseAdmin } from "../../supabaseAdmin";
import { logSafeError } from "../../errors/publicError";
import { logOperationalEvent } from "../../observability/logger";
import { buildCareerMemoryDraftText } from "../../resume-builder";
import { GENERATE_PACKAGE_MONTHLY_LIMIT, isNetlifyProductionRuntime } from "../../config/packageQuota";
import { resolveBackgroundFunctionSecret, resolveNamedBackgroundFunctionUrl } from "../../generatePackage/backgroundTarget";
import { getFirstText, fallbackPackage, safeResumeResolutionMessage } from "../../generatePackage/shared";
import { classifyCanadaJobScope, isCanadaScopeGenerationAllowed, CANADA_SCOPE_UNSUPPORTED_MESSAGE } from "../../jobPosting/canadaScopeClassifier";
import { createCanonicalRepositories } from "../repositories/createRepositories";
import { resolveGenerationTemplateId } from "../services/resolveResumeTemplate";
import { resolveCanonicalResumeContext } from "../services/resolveCanonicalResumeContext";
import { SelectedResumeUnavailableError } from "../errors/domainErrors";
import type { createClient } from "../../supabase-server";

const ENQUEUE_FETCH_TIMEOUT_MS = 10 * 1000;
// Same staleness window legacy's own route.ts uses (matches generateCore.ts's OPENAI_CALL_TIMEOUT_MS class of budget) - not re-derived, deliberately identical, since a canonical background worker has the same real-world enqueue/cold-start/generation-latency profile.
const WORKER_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/*
  Stage 2B: the id passed here is the id the reservation was actually MADE
  under - the founding entitlement owner, not necessarily the current auth
  user - because release_generate_package_usage() matches on (p_user_id,
  p_request_id). Passing the auth uuid instead would silently refund nothing.
  Null whenever no reservation was taken, which the guard below no-ops on.
*/
async function releaseQuotaReservation(quotaReserved: boolean, reservationOwnerId: string | null, generationRequestId: string | null) {
  if (!quotaReserved || !reservationOwnerId || !generationRequestId) return;
  try {
    await supabaseAdmin.rpc("release_generate_package_usage", { p_user_id: reservationOwnerId, p_request_id: generationRequestId });
  } catch (error) {
    logSafeError(error, { requestId: "canonical-dispatch", route: "/api/generate-package#canonical", generationRequestId });
  }
}

async function enqueueCanonicalWorker(params: { requestOrigin: string; applicationId: string; generationRequestId: string }) {
  const { requestOrigin, applicationId, generationRequestId } = params;
  const secret = resolveBackgroundFunctionSecret();
  if (!secret) throw new Error("Background generation is not configured.");

  const { url } = resolveNamedBackgroundFunctionUrl(requestOrigin, "canonical-generate-package-background", "/api/internal/canonical-generate-package-worker");

  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ENQUEUE_FETCH_TIMEOUT_MS) : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ applicationId, generationRequestId }),
    signal,
  });

  if (res.status !== 202) {
    throw new Error(`Canonical background function returned ${res.status}, expected 202.`);
  }
}

export type CanonicalDispatchParams = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  /*
    Stage 2B: the caller's entitlement claim, computed once in
    app/api/generate-package/route.ts. Passed in rather than derived here so
    the Free/paid rule, the confirmed-address requirement, the raw address and
    the HMAC secret all live in exactly one file, and the two engines cannot
    drift apart. Null only outside the metered runtime, where neither engine
    reserves anything.
  */
  emailHmac: string | null;
  memory: Record<string, unknown> | null;
  generationRequestId: string;
  jobText: string;
  title: string;
  company: string;
  applicantName: string;
  analysis: Record<string, unknown>;
  jobUrl: string | null;
  body: Record<string, unknown>;
  requestOrigin: string;
  routingReason: string;
  canaryStage: number;
};

export async function dispatchCanonicalGeneration(params: CanonicalDispatchParams): Promise<NextResponse> {
  const { supabase, userId, emailHmac, memory, generationRequestId, jobText, title, company, applicantName, analysis, jobUrl, body, requestOrigin, routingReason, canaryStage } = params;

  /*
    Phase 6I.6.22 - the exact bug this phase closes: canonical never
    called legacy's own Canadian-scope validator at all (see
    canonicalGeneratePackageService.ts's own comment on why its AI
    response has no jobContext field to validate), so an explicitly
    non-Canada job could reach real AI generation through this routing
    choice while being correctly blocked through the legacy one. Uses
    the SAME classifyCanadaJobScope() legacy's own generateCore.ts now
    also calls (lib/jobPosting/canadaScopeClassifier.ts) - one
    authoritative policy, not a second copy - run on this dispatch's own
    `jobText` (never a client-supplied jobContext/supportedByCareerElan
    flag from `analysis`/`body` - Part J), and BEFORE quota reservation
    so an UNSUPPORTED job never consumes the user's generation quota
    either. SUPPORTED and UNKNOWN both proceed (Part H/B) - only a
    confirmed non-Canada posting is rejected here.
  */
  const canadaScope = classifyCanadaJobScope(jobText);
  if (!isCanadaScopeGenerationAllowed(canadaScope.status)) {
    return NextResponse.json(
      { error: CANADA_SCOPE_UNSUPPORTED_MESSAGE, code: "CANADIAN_SCOPE_FAILED", ...fallbackPackage(title, company, applicantName) },
      { status: 422 }
    );
  }

  let quotaReserved = false;

  /*
    Stage 2B: the id this request's reservation was actually taken under -
    the founding entitlement owner resolved from emailHmac, which is NOT
    necessarily userId. Stays null outside the metered runtime, where no
    reservation exists at all.
  */
  let reservationOwnerId: string | null = null;

  // ==================== Quota reservation (Part C, Phase 6I.6.23: monthly/calendar-month) - SAME ledger, SAME RPCs, SAME idempotency key as legacy. A user's plan grants a single monthly generation budget regardless of which engine ultimately serves the request - this is what "no double charging" means at the product level, not just at the per-request level. The RPC ignores p_limit and resolves the real, per-user limit itself server-side. ====================
  if (isNetlifyProductionRuntime()) {
    /*
      emailHmac is non-null on every path that reaches here: route.ts gates it
      under the same isNetlifyProductionRuntime() condition and returns before
      dispatching otherwise. Re-checked rather than asserted so a future edit
      which loosens that gate fails closed instead of reserving without a claim.
    */
    if (!emailHmac) {
      logSafeError(new Error("Canonical dispatch reached quota reservation without an entitlement claim."), { requestId: "canonical-dispatch", route: "/api/generate-package#canonical", generationRequestId });
      return NextResponse.json({ error: "We could not verify your monthly usage. Please try again in a moment." }, { status: 500 });
    }

    // p_user_id stays the CURRENT auth user so the RPC resolves THIS caller's plan limit (subscription / admin override); only the usage counter moves onto the founding entitlement owner that p_email_hmac resolves to.
    const { data: quotaRows, error: quotaError } = await supabaseAdmin.rpc("reserve_generate_package_usage_for_entitlement", {
      p_user_id: userId,
      p_email_hmac: emailHmac,
      p_request_id: generationRequestId,
      p_limit: GENERATE_PACKAGE_MONTHLY_LIMIT,
    });

    if (quotaError) {
      logSafeError(quotaError, { requestId: "canonical-dispatch", route: "/api/generate-package#canonical", generationRequestId });
      return NextResponse.json({ error: "Failed to verify your Generate Package usage. Please try again." }, { status: 500 });
    }

    const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
    if (!quota?.reserved) {
      const used = quota?.used ?? GENERATE_PACKAGE_MONTHLY_LIMIT;
      const limit = used + (quota?.remaining ?? 0);
      logOperationalEvent({ domain: "generate_package", event: "quota_denied", userId, generationRequestId, used, limit, engine: "canonical" });
      return NextResponse.json({
        error: "You've reached your monthly Generate Package limit. You can generate up to " + GENERATE_PACKAGE_MONTHLY_LIMIT + " packages per month.",
        code: "GENERATE_PACKAGE_LIMIT_REACHED",
        // used + remaining reflects the RPC's own server-resolved limit for
        // this user (see packageQuota.ts's doc comment), not this file's
        // display constant.
        limit,
        used,
        remaining: 0,
      }, { status: 429 });
    }
    /*
      Every later completion/release for this request must target the id the
      reservation was made under. Deliberately NO fallback to userId: if the
      RPC returned no owner the reservation cannot be reconciled, so fail
      closed and leave it to the RPC's own stale-reservation reclaim rather
      than completing it under the wrong id.
    */
    if (!quota.entitlement_owner_id) {
      logSafeError(new Error("Quota reservation returned no entitlement owner."), { requestId: "canonical-dispatch", route: "/api/generate-package#canonical", generationRequestId });
      return NextResponse.json({ error: "We could not verify your monthly usage. Please try again in a moment." }, { status: 500 });
    }

    reservationOwnerId = quota.entitlement_owner_id;
    quotaReserved = true;
    logOperationalEvent({ domain: "generate_package", event: "quota_reserved", userId, generationRequestId, engine: "canonical" });
  }

  // ==================== Legacy-equivalent input snapshot - resolved unconditionally so a later fallback never needs a user session (see this file's own header comment). ====================
  let resolvedResume;
  try {
    resolvedResume = await resolveSelectedResume(supabase, userId, { preloadedMemory: memory, includeGenerationText: false });
  } catch (error) {
    if (error instanceof ResumeResolutionError) {
      const isResumeTextUnavailable = error.code === "EMPTY_GENERATION_TEXT";
      const status = error.code === "NO_CAREER_MEMORY" || error.code === "RESUME_NOT_FOUND" ? 404 : error.code === "FETCH_FAILED" ? 500 : isResumeTextUnavailable ? 422 : 400;
      await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
      return NextResponse.json({ error: safeResumeResolutionMessage(error.code), ...fallbackPackage(title, company, applicantName) }, { status });
    }
    await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
    throw error;
  }

  const inputResumeText = resolvedResume.source === "uploaded" ? resolvedResume.generationText : buildCareerMemoryDraftText(resolvedResume.previewData);

  if (resolvedResume.source === "career_memory" && !inputResumeText.trim()) {
    await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
    return NextResponse.json({ error: "Career Memory did not produce usable resume text. Please add more detail to your Career Memory.", code: "RESUME_TEXT_UNAVAILABLE", ...fallbackPackage(title, company, applicantName) }, { status: 422 });
  }

  let inputCoverLetterText: string | null = null;
  if (memory?.selected_cover_letter_id) {
    const { data: selectedCover } = await supabase.from("cover_letters").select("original_text").eq("id", memory.selected_cover_letter_id as string).eq("user_id", userId).maybeSingle();
    inputCoverLetterText = getFirstText(selectedCover?.original_text) || null;
  } else {
    inputCoverLetterText = getFirstText(memory?.cover_letter) || null;
  }

  const canonicalRepos = createCanonicalRepositories(supabase);

  /*
    Phase 6I.6.15 - bound to the SAME resolvedResume identity (source +
    resumeId) already resolved above for CONTENT, not an independent
    lookup - see resolveGenerationTemplateId()'s own header comment for
    the full priority chain (resume-explicit -> profile-default ->
    ultimate fallback for uploaded resumes; profile-default only for
    Manual/career_memory selections, which own no resumes row).
  */
  const resolvedTemplateId = await resolveGenerationTemplateId(
    canonicalRepos,
    supabase,
    userId,
    { source: resolvedResume.source, resumeId: resolvedResume.resumeId },
    typeof body.templateId === "string" ? body.templateId : undefined
  );

  /*
    Phase 6I.6.16 - freezes the canonical profile/version tuple onto
    the claimed row, from the SAME resolvedResume identity used for
    both content and template above - never a later, independently
    re-resolved lookup. This is what lets the worker's service-role
    resolveCanonicalResumeContext() call (see canonicalGeneratePackageService.ts)
    prefer the application-binding branch over re-reading whatever
    resume is CURRENTLY selected, closing the race where a user
    switches their selected resume between Generate Package click and
    worker execution. Left null (not an error) when resolution genuinely
    fails - resolveCanonicalResumeContext() throws SELECTED_RESUME_
    UNAVAILABLE for a real problem, which the existing catch below
    already surfaces identically to how content resolution's own
    failure is surfaced; "not-canonical"/"legacy-only" (no canonical
    identity exists yet to freeze) simply leave both columns null,
    exactly matching every application created before this phase - the
    worker's existing fresh-resolve fallback still applies for those.
  */
  let canonicalProfileId: string | null = null;
  let canonicalResumeVersionId: string | null = null;
  if (resolvedResume.source === "uploaded" && resolvedResume.resumeId) {
    try {
      const ctx = await resolveCanonicalResumeContext({ mode: "session", repos: canonicalRepos, client: supabase, userId, resumeId: resolvedResume.resumeId });
      if (ctx.status === "resolved") {
        canonicalProfileId = ctx.profileId;
        canonicalResumeVersionId = ctx.versionId;
      }
    } catch (error) {
      if (!(error instanceof SelectedResumeUnavailableError)) throw error;
      // not-yet-importable/resume-deleted/resume-not-owned - no canonical
      // identity exists to freeze; leave both null, matching pre-fix
      // behavior for this one narrow edge case (nothing to bind yet).
    }
  } else if (resolvedResume.source === "career_memory") {
    // Manual Career Memory owns no resumes row - freeze the profile's
    // current latest version (the same fallback resolution the worker
    // itself already uses for "not-canonical"/"legacy-only" today - see
    // canonicalGeneratePackageService.ts's own header comment), so Manual
    // obeys the identical click-time snapshot rule as uploaded resumes.
    const profile = await canonicalRepos.profiles.getByUserId(userId);
    if (profile) {
      const latest = await canonicalRepos.resumeVersions.getLatestByProfileId(profile.id);
      if (latest) {
        canonicalProfileId = profile.id;
        canonicalResumeVersionId = latest.id;
      }
    }
  }

  const canonicalInputManifest = {
    jobDescriptionText: jobText,
    jobAnalysisSummary: getFirstText((analysis as { summary?: unknown }).summary) || "",
    targetRole: typeof body.targetRole === "string" ? body.targetRole : undefined,
    templateId: resolvedTemplateId,
    paperSize: typeof body.paperSize === "string" ? body.paperSize : "letter",
    density: typeof body.density === "string" ? body.density : "comfortable",
    locale: typeof body.locale === "string" ? body.locale : "en",
    routingReason,
    canaryStage,
  };

  // ==================== Idempotent claim-insert (Part A: preserve idempotency/ownership/audit trail) ====================
  const { data: claimedRow, error: claimInsertError } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      generation_request_id: generationRequestId,
      // Stage 2B: records the id this generation's quota reservation was taken under, so the worker's completion/release path (lib/generatePackage/generateCore.ts, via claim_generate_package_worker) targets that id rather than user_id. Null outside the metered runtime, which reads back as the legacy model - exactly as it did before Stage 2B. Never client-supplied.
      entitlement_owner_id: reservationOwnerId,
      generation_status: "pending",
      generation_stage: "queued",
      generation_stage_updated_at: new Date().toISOString(),
      generation_started_at: new Date().toISOString(),
      generation_engine: "canonical",
      company,
      job_title: title,
      job_url: jobUrl,
      job_description: jobText,
      job_description_normalized: getFirstText((analysis as { summary?: unknown }).summary) || null,
      job_analysis: analysis,
      location: getFirstText((analysis as { location?: unknown }).location) || null,
      job_type: getFirstText((analysis as { type?: unknown }).type) || null,
      resume_source: resolvedResume.source,
      resume_id: resolvedResume.source === "uploaded" ? resolvedResume.resumeId : null,
      cover_letter_id: (memory?.selected_cover_letter_id as string | undefined) ?? null,
      canonical_profile_id: canonicalProfileId,
      canonical_resume_version_id: canonicalResumeVersionId,
      generation_input_resume_text: inputResumeText,
      generation_input_resume_name: resolvedResume.selectedName,
      generation_input_manifest_source: resolvedResume.previewData,
      generation_input_cover_letter_text: inputCoverLetterText,
      canonical_input_manifest: canonicalInputManifest,
      applied_date: new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  let applicationId: string;

  if (claimInsertError) {
    if (claimInsertError.code !== "23505") {
      logSafeError(claimInsertError, { requestId: "canonical-dispatch", route: "/api/generate-package#canonical", generationRequestId });
      await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
      return NextResponse.json({ error: "Failed to generate application package. Please try again.", ...fallbackPackage(title, company, applicantName) }, { status: 500 });
    }

    // Idempotent replay / stale reclaim - same shape as legacy's own conflict handling.
    const { data: existing, error: existingError } = await supabase
      .from("applications")
      .select("id, generation_status, created_at, generation_started_at, generation_worker_claimed_at, generation_engine, canonical_profile_id, tailored_resume_id, selected_template_id, generated_pdf_document_id, generated_docx_document_id, fallback_used, fallback_reason")
      .eq("user_id", userId)
      .eq("generation_request_id", generationRequestId)
      .single();

    if (existingError || !existing) {
      await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
      return NextResponse.json({ error: "Failed to generate application package. Please try again.", ...fallbackPackage(title, company, applicantName) }, { status: 500 });
    }

    if (existing.generation_status === "succeeded") {
      if (quotaReserved) {
        await supabaseAdmin.rpc("complete_generate_package_usage", { p_user_id: reservationOwnerId, p_request_id: generationRequestId });
      }
      return NextResponse.json({
        success: true,
        status: "succeeded",
        applicationId: existing.id,
        engine: existing.generation_engine,
        canonicalProfileId: existing.canonical_profile_id,
        tailoredResumeId: existing.tailored_resume_id,
        selectedTemplateId: existing.selected_template_id,
        documentStorage: { persisted: Boolean(existing.generated_pdf_document_id && existing.generated_docx_document_id) },
        fallbackUsed: existing.fallback_used,
        fallbackReason: existing.fallback_reason,
      });
    }

    if (existing.generation_status === "pending") {
      const pendingAgeMs = existing.generation_started_at ? Date.now() - new Date(existing.generation_started_at).getTime() : 0;
      if (existing.generation_worker_claimed_at !== null || pendingAgeMs < WORKER_STALE_THRESHOLD_MS) {
        return NextResponse.json({ error: "Generation is already in progress for this job. Please wait a moment and check Job Tracker.", code: "GENERATION_IN_PROGRESS", applicationId: existing.id }, { status: 409 });
      }
    }

    /*
      failed, or stale-pending-unclaimed: reclaim and re-enqueue. Snapshot
      columns already correct from the original claim (never re-derived -
      same principle as legacy's own reclaim path).

      Bug fix (found while writing e2e/specs/render-failure.spec.ts's own
      Part L retry test): a row whose PRIOR attempt fell back to legacy
      (Part B - canonicalGenerationWorker.ts's mark_canonical_fallback)
      is left with generation_engine='legacy' on this table. Without
      resetting it back to 'canonical' here, claim_canonical_generate_worker
      (supabase/migrations/20260808000000_canonical_background_execution_and_fallback.sql)
      - which strictly requires generation_engine='canonical' in its own
      WHERE clause - can never claim this reclaimed row again: the
      background worker's fetch to enqueueCanonicalWorker() below still
      returns 202 (the enqueue itself "succeeds"), but the worker's own
      claim RPC then silently matches 0 rows (its own documented,
      legitimate no-op for "not a canonical row"), leaving the row stuck
      at generation_status='pending'/generation_worker_claimed_at=null
      forever - confirmed via a real stuck DB row during E2E testing.
      Also clearing the stale fallback_used/fallback_reason/
      generation_error_code/generation_error_summary from the PRIOR
      attempt so a fresh attempt is not misleadingly reported as already
      having fallen back or failed before it has even run again.
    */
    applicationId = existing.id;
    logOperationalEvent({
      domain: "generate_package",
      event: "stale_pending_reclaimed",
      applicationId,
      generationRequestId,
      pendingAgeMs: existing.generation_started_at ? Date.now() - new Date(existing.generation_started_at).getTime() : 0,
      engine: "canonical",
    });
    await supabase
      .from("applications")
      .update({
        generation_status: "pending",
        generation_stage: "queued",
        generation_stage_updated_at: new Date().toISOString(),
        generation_started_at: new Date().toISOString(),
        generation_worker_claimed_at: null,
        // Stage 2B: this re-enqueue is charged against the reservation taken by THIS request, so the row must point at that reservation's owner rather than whatever a prior attempt recorded - realigning pre-Stage-2B rows (NULL) onto the owner the worker must complete under. A no-op when a prior attempt already recorded the same owner, since one address always resolves to one founding owner. Not an input-snapshot column, so the "already correct from the original claim" rule above does not cover it.
        entitlement_owner_id: reservationOwnerId,
        generation_engine: "canonical",
        fallback_used: null,
        fallback_reason: null,
        generation_error_code: null,
        generation_error_summary: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)
      .eq("user_id", userId);
  } else {
    applicationId = claimedRow.id;
  }

  // ==================== Enqueue (Part D) ====================
  try {
    await enqueueCanonicalWorker({ requestOrigin, applicationId, generationRequestId });
    logOperationalEvent({ domain: "background_worker", event: "enqueued", applicationId, generationRequestId, engine: "canonical" });
  } catch (enqueueError) {
    logSafeError(enqueueError, { requestId: "canonical-dispatch", route: "/api/generate-package#canonical-enqueue", userId, generationRequestId });
    logOperationalEvent({ domain: "background_worker", event: "enqueue_failed", applicationId, generationRequestId, engine: "canonical" });
    await releaseQuotaReservation(quotaReserved, reservationOwnerId, generationRequestId);
    await supabase.from("applications").update({ generation_status: "failed", generation_error_code: "BACKGROUND_ENQUEUE_FAILED", generation_error_summary: "Could not start AI generation. Please try again.", generation_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", applicationId).eq("user_id", userId);
    return NextResponse.json({ error: "Could not start AI generation. Please try again.", code: "BACKGROUND_ENQUEUE_FAILED", applicationId, ...fallbackPackage(title, company, applicantName) }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      status: "processing",
      applicationId,
      generationRequestId,
      engine: "canonical",
    },
    { status: 202 }
  );
}
