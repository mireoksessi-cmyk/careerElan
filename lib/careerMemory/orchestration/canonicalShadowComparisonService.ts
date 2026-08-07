/*
  Phase 6G - Shadow Mode. Runs canonical generation ALONGSIDE an
  already-succeeded (or already-failed) legacy generation, entirely for
  comparison/observability - never returned to the user, never allowed
  to affect the legacy result or the request's quota outcome.

  Hard requirements from this round's own additional constraints:
  1. Must be AWAITED inside the background worker (generateCore.ts),
     never a detached fire-and-forget promise - see that file's own
     call site for where this is awaited after the legacy write
     completes.
  2. Fully isolated in its own try/catch - a canonical exception here
     must never propagate out and must never change generateCore.ts's
     own success/failure outcome for the legacy attempt already
     recorded.
  3. Never consumes generate-package quota - this module never calls
     any of the four generate_package_usage RPCs, and
     generateCanonicalPackage()'s own AI call is a SEPARATE OpenAI
     call outside that quota system entirely (a real cost/latency
     tradeoff, disclosed in the final report, not hidden).
*/
import { supabaseAdmin } from "../../supabaseAdmin";
import { generateCanonicalPackage } from "./canonicalGeneratePackageService";
import { classifyForFallback, type FallbackReason } from "./canonicalGenerationFallbackService";
import { isCanonicalShadowModeEnabled } from "./featureFlags";
import type { PaperSize } from "../../documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "../../resumeTemplates/contracts/types";

export type ShadowComparisonInput = {
  userId: string;
  applicationId: string;
  jobDescriptionText: string;
  jobAnalysisSummary: string;
  targetRole?: string;
  templateId?: string;
  paperSize?: PaperSize;
  density?: TemplateDensity;
  locale?: string;
  legacySucceeded: boolean;
};

export type ShadowComparisonResultCategory = "canonical_succeeded" | "canonical_failed_fallback_eligible" | "canonical_failed_hard" | "skipped_flag_disabled";

export type ShadowComparisonLogRecord = {
  event: "shadow_comparison_completed";
  applicationId: string;
  resultCategory: ShadowComparisonResultCategory;
  fallbackReason: FallbackReason | null;
  legacySucceeded: boolean;
  canonicalPageCount: number | null;
  canonicalMissingTextCount: number | null;
  canonicalProtectedFactsUnchanged: boolean | null;
  latencyMs: number;
};

/*
  PII-safe by construction: only categories/counts/booleans/latency are
  ever logged (round spec §16's own explicit exclusion list - resume
  text, email/phone, full prompt, PDF bytes are never referenced by any
  variable in this function, let alone logged).
*/
export async function runShadowComparison(input: ShadowComparisonInput): Promise<ShadowComparisonLogRecord> {
  const startedAt = Date.now();

  if (!isCanonicalShadowModeEnabled()) {
    return {
      event: "shadow_comparison_completed",
      applicationId: input.applicationId,
      resultCategory: "skipped_flag_disabled",
      fallbackReason: null,
      legacySucceeded: input.legacySucceeded,
      canonicalPageCount: null,
      canonicalMissingTextCount: null,
      canonicalProtectedFactsUnchanged: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const result = await generateCanonicalPackage(supabaseAdmin, {
      userId: input.userId,
      applicationId: input.applicationId,
      jobDescriptionText: input.jobDescriptionText,
      jobAnalysisSummary: input.jobAnalysisSummary,
      targetRole: input.targetRole,
      templateId: input.templateId ?? "professional-ats",
      paperSize: input.paperSize ?? "letter",
      density: input.density ?? "comfortable",
      locale: input.locale ?? "en",
    });

    return {
      event: "shadow_comparison_completed",
      applicationId: input.applicationId,
      resultCategory: "canonical_succeeded",
      fallbackReason: null,
      legacySucceeded: input.legacySucceeded,
      canonicalPageCount: result.render.pageCount,
      canonicalMissingTextCount: result.render.pdfValidation.missingTextCount,
      canonicalProtectedFactsUnchanged: result.render.pdfValidation.protectedFactsUnchanged,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const decision = classifyForFallback(error);
    return {
      event: "shadow_comparison_completed",
      applicationId: input.applicationId,
      resultCategory: decision.shouldFallback ? "canonical_failed_fallback_eligible" : "canonical_failed_hard",
      fallbackReason: decision.shouldFallback ? decision.reason : null,
      legacySucceeded: input.legacySucceeded,
      canonicalPageCount: null,
      canonicalMissingTextCount: null,
      canonicalProtectedFactsUnchanged: null,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/*
  The one function generateCore.ts's worker calls - swallows EVERY
  possible failure (including a bug in runShadowComparison itself),
  guaranteeing the legacy generation's own success/failure path is
  NEVER affected by shadow mode. Logs via plain console.log (structured
  JSON, matching generateCore.ts's own logGenerationStage convention)
  rather than throwing or returning an error the caller might
  accidentally propagate.
*/
export async function runShadowComparisonSafely(input: ShadowComparisonInput): Promise<void> {
  try {
    const record = await runShadowComparison(input);
    console.log(JSON.stringify(record));
  } catch (error) {
    console.log(JSON.stringify({ event: "shadow_comparison_completed", applicationId: input.applicationId, resultCategory: "canonical_failed_hard", fallbackReason: null, legacySucceeded: input.legacySucceeded, canonicalPageCount: null, canonicalMissingTextCount: null, canonicalProtectedFactsUnchanged: null, latencyMs: -1, unexpectedError: error instanceof Error ? error.constructor.name : "unknown" }));
  }
}
