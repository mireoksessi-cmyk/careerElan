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

type CanonicalInputManifest = {
  jobDescriptionText?: string;
  jobAnalysisSummary?: string;
  targetRole?: string;
  templateId?: string;
  paperSize?: string;
  density?: string;
  locale?: string;
};

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
    logCanonicalMetric({ event: "canonical_generate", applicationId, templateId, outcome: "error", errorCode, latencyMs: Date.now() - startedAt });
  }
}
