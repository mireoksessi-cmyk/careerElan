/*
  Phase 6I - Part D (background execution) + Part B (fallback
  activation), combined in one worker because they share the exact
  same claim/complete lifecycle: this is the entrypoint a Netlify
  Background Function (Production) or the local-dev internal worker
  route invokes for a canonical-routed applicationId, mirroring
  lib/generatePackage/generateCore.ts's own runPackageGeneration()
  shape (atomic claim -> do the work -> complete/fail), safe to invoke
  more than once for the same applicationId (the atomic claim below
  makes a retried/duplicate invocation a no-op).

  Call sequence on a fallback-eligible canonical failure (Part B):
  1. mark_canonical_fallback() records fallback_used/fallback_reason/
     generation_engine='legacy' immediately - so the fallback is
     observable even if the subsequent legacy attempt itself also
     fails.
  2. release_canonical_claim_for_legacy_fallback() releases this row's
     worker claim. The legacy input snapshot (resume_source, resume_id,
     generation_input_*) is ALREADY on the row - written by
     canonicalGenerateDispatchService.ts at claim-insert time,
     unconditionally, before it was known whether canonical would
     succeed - so nothing needs to be written here.
  3. runPackageGeneration(applicationId) - legacy's own, completely
     UNMODIFIED worker entrypoint - claims (via its own
     claim_generate_package_worker, now unblocked) and completes this
     SAME row exactly as it would for a request that had been legacy
     from the start. This is what makes fallback reuse real generation
     logic instead of duplicating it.
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { generateCanonicalPackage } from "./canonicalGeneratePackageService";
import { runCanonicalWithFallbackDecision } from "./canonicalGenerationFallbackService";
import { classifyErrorCode, logCanonicalMetric } from "./canonicalProductionMetrics";
import { runPackageGeneration } from "../../generatePackage/generateCore";
import { logSafeError } from "../../errors/publicError";

type CanonicalInputManifest = {
  jobDescriptionText?: string;
  jobAnalysisSummary?: string;
  targetRole?: string;
  templateId?: string;
  paperSize?: string;
  density?: string;
  locale?: string;
};

/*
  Bounded, best-effort settlement of one generation's quota reservation,
  mirroring lib/generatePackage/generateCore.ts's own completion retry shape:
  3 attempts, a short backoff, a safe log on final failure, and never a throw.

  Never throwing is the load-bearing property. Both call sites run after the
  application's own final status is already durably written, and the failure
  call site is inside a catch block - so a throw would either escape the
  worker or risk re-running failure handling against a row that has already
  succeeded. A bookkeeping failure must never change a generation's outcome.

  Both RPCs update only rows still in 'reserved' status, so a duplicate or
  retried call - including complete-after-release and release-after-complete -
  is a no-op. Ownership is always supplied explicitly by the caller;
  request_id alone is never used to resolve an owner.
*/
async function settleQuotaReservation(
  rpcName: "complete_generate_package_usage" | "release_generate_package_usage",
  reservationOwnerId: string | null,
  generationRequestId: string | null
): Promise<void> {
  if (!reservationOwnerId || !generationRequestId) {
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await supabaseAdmin.rpc(rpcName, {
        p_user_id: reservationOwnerId,
        p_request_id: generationRequestId,
      });

      if (!error) {
        return;
      }

      lastError = error;
    } catch (thrown) {
      lastError = thrown;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  logSafeError(lastError, {
    requestId: "canonical-worker",
    route: `canonicalGenerationWorker#${rpcName}`,
    generationRequestId,
  });
}

export async function runCanonicalGeneration(applicationId: string): Promise<void> {
  const startedAt = Date.now();

  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc("claim_canonical_generate_worker", { p_application_id: applicationId });

  if (claimError) {
    // Nothing to mark failed - the claim itself never succeeded, so no
    // row is under this worker's ownership. Matches legacy's own
    // "0 rows affected is a no-op, not an error" convention.
    return;
  }

  const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!claimed) {
    // Already claimed by another invocation, already completed, or not
    // a canonical row - safe no-op (see this file's own header comment
    // on retried/duplicate invocations).
    return;
  }

  const userId: string = claimed.user_id;
  const manifest: CanonicalInputManifest = (claimed.canonical_input_manifest as CanonicalInputManifest | null) || {};

  /*
    Stage 2B quota identity. This generation's reservation was made under the
    FOUNDING ENTITLEMENT OWNER, which for a recreated account is NOT
    claimed.user_id - and complete_/release_generate_package_usage() match on
    (p_user_id, p_request_id), so targeting the wrong id would silently
    settle nothing.

    claim_canonical_generate_worker does not return the owner (Stage 2A
    extended only legacy's claim RPC), so it is read here from the row this
    worker has just claimed. service_role holds SELECT on public.applications,
    so this needs no RPC signature change and no migration.

    entitlement_owner_id ?? user_id is a COMPLETION-time fallback onto the id
    a row was actually reserved with - NULL means the pre-Stage-2B legacy
    model. It is never a reservation-time fallback, and no owner value is ever
    taken from client input, an email address or the HMAC.

    Left null when the read itself fails: guessing an owner would target the
    wrong reservation, whereas leaving it unsettled hands the row to the
    owner-aware reclaim, which reconciles it from the application's own
    final status.
  */
  const { data: quotaIdentity, error: quotaIdentityError } = await supabaseAdmin
    .from("applications")
    .select("entitlement_owner_id, user_id, generation_request_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (quotaIdentityError) {
    logSafeError(quotaIdentityError, {
      requestId: "canonical-worker",
      route: "canonicalGenerationWorker#quota-identity",
    });
  }

  const reservationOwnerId: string | null = quotaIdentityError
    ? null
    : quotaIdentity?.entitlement_owner_id ?? quotaIdentity?.user_id ?? null;

  const generationRequestId: string | null =
    quotaIdentity?.generation_request_id ?? null;

  const templateId = manifest.templateId || "professional-ats";
  const paperSize = (manifest.paperSize as "letter" | "a4") || "letter";
  const density = (manifest.density as "compact" | "comfortable" | "spacious" | "balanced") || "comfortable";
  const locale = manifest.locale || "en";

  try {
    const decision = await runCanonicalWithFallbackDecision(() =>
      generateCanonicalPackage(supabaseAdmin, {
        userId,
        applicationId,
        jobDescriptionText: manifest.jobDescriptionText || "",
        jobAnalysisSummary: manifest.jobAnalysisSummary || "",
        targetRole: manifest.targetRole,
        // Phase 6I.6.6 - company/existingCoverLetterText come straight
        // off the claimed row (claim_canonical_generate_worker now
        // returns company/job_title/generation_input_cover_letter_text
        // - the SAME snapshot columns the legacy fallback path already
        // relies on), not the canonical-specific manifest.
        company: claimed.company || undefined,
        existingCoverLetterText: claimed.generation_input_cover_letter_text || undefined,
        templateId,
        paperSize,
        density,
        locale,
      })
    );

    if (decision.usedCanonical) {
      await supabaseAdmin.rpc("complete_canonical_generate_worker", {
        p_application_id: applicationId,
        p_user_id: userId,
        p_status: "succeeded",
        // Phase 6I.6.5 - same completion transaction, same existing
        // applications.ai_insight column legacy already uses; see this
        // RPC's own migration comment for why a new optional parameter
        // was the smallest safe signature change.
        p_ai_insight: decision.result.packageAnalysis,
        // Phase 6I.6.6 - same completion transaction, same existing
        // applications.cover_letter_text/email_draft columns legacy
        // already writes.
        p_cover_letter_text: decision.result.coverLetterText,
        p_email_draft: decision.result.emailDraftText,
      });

      /*
        Stage 2B: the application's success is now durably written, so this
        generation's quota reservation can be completed - under the id it was
        RESERVED with. Deliberately AFTER the application completion: the
        reverse order would, on a crash, leave a completed reservation against
        a still-pending application, a state the reclaim heal branch cannot
        repair, whereas this order leaves reserved+succeeded, which it repairs
        exactly. Best-effort and never throwing - a bookkeeping failure must
        never turn a delivered package into a failure, and must never refund
        one.
      */
      await settleQuotaReservation(
        "complete_generate_package_usage",
        reservationOwnerId,
        generationRequestId
      );
      logCanonicalMetric({ event: "canonical_generate", applicationId, templateId, outcome: "success", latencyMs: Date.now() - startedAt, pdfPersisted: decision.result.render.documentStorage.persisted, docxPersisted: decision.result.render.documentStorage.persisted });
      return;
    }

    // Fallback-eligible failure, canonical_legacy_fallback_enabled=true.
    await supabaseAdmin.rpc("mark_canonical_fallback", {
      p_user_id: userId,
      p_application_id: applicationId,
      p_fallback_used: true,
      p_fallback_reason: decision.fallbackReason,
      p_generation_engine: "legacy",
    });

    await supabaseAdmin.rpc("release_canonical_claim_for_legacy_fallback", {
      p_application_id: applicationId,
      p_user_id: userId,
    });

    // Legacy's own, unmodified worker - claims the now-unblocked row and
    // completes it (success or failure) using ITS OWN error handling and
    // ITS OWN completion RPC, exactly as if this had been a legacy
    // request from the start. It does not throw on a normal generation
    // failure (writes generation_status='failed' itself and returns) -
    // so the row's own final status, not a thrown/caught exception, is
    // what tells us whether the fallback attempt actually succeeded.
    await runPackageGeneration(applicationId);

    const { data: finalStatus } = await supabaseAdmin.rpc("get_application_generation_status", { p_application_id: applicationId, p_user_id: userId });
    logCanonicalMetric({ event: "canonical_fallback", applicationId, reason: decision.fallbackReason, outcome: finalStatus === "succeeded" ? "legacy_succeeded" : "legacy_failed" });
  } catch (error) {
    // Either canonical threw a HARD-FAIL (not fallback-eligible, or
    // fallback disabled) - runCanonicalWithFallbackDecision rethrows in
    // that case - or the fallback-to-legacy attempt itself threw.
    // Either way, this row must not stay "pending" forever.
    const errorCode = classifyErrorCode(error);
    await supabaseAdmin.rpc("complete_canonical_generate_worker", {
      p_application_id: applicationId,
      p_user_id: userId,
      p_status: "failed",
      p_error_code: errorCode,
      p_error_summary: "Canonical generation failed and could not be completed.",
    });

    /*
      Stage 2B: this generation terminally failed, so the reservation taken
      for it must be released - under the id it was RESERVED with, which is
      the founding entitlement owner, not necessarily userId. Best-effort and
      never throwing: this already sits inside a catch block, so a throw here
      would escape the worker entirely. If every attempt fails the row stays
      failed+reserved, which the owner-aware reclaim's failed branch releases
      on this owner's next reserve or usage read.
    */
    await settleQuotaReservation(
      "release_generate_package_usage",
      reservationOwnerId,
      generationRequestId
    );
    logCanonicalMetric({ event: "canonical_generate", applicationId, templateId, outcome: "error", errorCode, latencyMs: Date.now() - startedAt });
  }
}
