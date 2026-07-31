/*
  Document Preservation Engine (DPE) - Phase 4B completion. Retry Engine -
  Measure -> Overflow? -> Compression -> Replacement -> Measure loop, max 3
  attempts, per this phase's own "9. Retry Engine".

  Each retry re-runs Phase 4A's createReplacementPlan() (unmodified)
  against the NEWLY regenerated text - a fresh Generate Package attempt
  produces a fresh resume/coverLetter string, which still has to go
  through the exact same Section/Bullet/Paragraph Matchers as the first
  attempt, not a shortcut.

  Every attempt is measured via the REAL headless-browser Layout
  Measurement (layoutMeasurement.ts), not an estimate. The BEST result
  across all attempts (fewest overflow findings, "fits" beating any
  overflow) is tracked and returned - not merely the LAST attempt's
  result - per this phase's own "가장 좋은 결과를 선택한다".

  Early-exit conditions (checked in this order, every attempt):
  1. fits - overflow fully resolved, stop immediately.
  2. identical_output_stop - the newly generated text is byte-identical to
     the previous attempt's (Generate Package returned the same content
     again) - further identical retries cannot help.
  3. protected_claims_failed_stop - the real Generate Package attempt
     failed with VALIDATION_FAILED (the same code
     lib/generatePackage/shared.ts's classifyGenerationError assigns to a
     validateProtectedClaims() throw - see realRegeneratePackage.ts's own
     comment on why no separate code exists to distinguish this from other
     content-quality checks). Retrying cannot fix a Protected Claims
     violation, so this always stops the loop.
  4. generate_package_error_stop - any other real failure from the
     injected regeneratePackage (OpenAI error/timeout/malformed response).
  5. unmeasurable_stop - the real headless-browser measurement itself
     failed for this attempt's text.
  6. no_improvement_stop - this attempt's overflow score did not improve
     on the previous attempt's.
  7. improved_continue - genuine improvement, but overflow remains; try
     again if budget allows.
  8. budget_exhausted_stop - MAX_RETRIES reached with no full fit.
*/
import { createReplacementPlan } from "../contentMapping";
import type { DocumentLayerModel } from "../contentBox/types";
import { applyReplacementPlan } from "./replacementEngine";
import { renderBoxesToResumeText } from "./rendererAdapter";
import { measureLayout } from "./layoutMeasurement";
import { detectOverflow } from "./overflowDetection";
import { requestCompressionRetry } from "./compressionRetry";
import type { ContentBox } from "../contentBox/types";
import type {
  ExperienceRefinementResult,
  LayoutConstraints,
  LayoutMeasurementResult,
  OverflowReport,
  RegeneratePackageFn,
  RetryAttempt,
  RetryDecision,
} from "./types";

const MAX_RETRIES = 3;

export type RetryEngineResult = {
  finalReplacedBoxes: ContentBox[];
  finalOverflow: OverflowReport;
  finalMeasurement: LayoutMeasurementResult | null;
  attempts: RetryAttempt[];
  resolvedByRetry: boolean;
};

// Lower is better. `hasOverflow: false` always scores 0 (fits) regardless
// of `findings.length` (which stays 0 in that case anyway by
// overflowDetection.ts's own construction).
function overflowScore(overflow: OverflowReport): number {
  return overflow.hasOverflow ? overflow.findings.length : 0;
}

function buildLayoutConstraints(measurement: LayoutMeasurementResult | null): LayoutConstraints {
  return {
    targetPageCount: measurement && measurement.totalPageCount > 0 ? Math.max(1, measurement.totalPageCount - 1) : 1,
    preserveProtectedClaims: true,
  };
}

export async function runRetryEngine(
  applicationId: string,
  documentType: DocumentLayerModel["documentType"],
  layerModel: DocumentLayerModel,
  initialReplacedBoxes: ContentBox[],
  experienceRefinements: ExperienceRefinementResult[],
  initialOverflow: OverflowReport,
  templateId: string,
  regeneratePackage: RegeneratePackageFn | undefined
): Promise<RetryEngineResult> {
  let replacedBoxes = initialReplacedBoxes;
  let overflow = initialOverflow;
  let measurement: LayoutMeasurementResult | null = null;
  const attempts: RetryAttempt[] = [];

  if (!overflow.hasOverflow) {
    return { finalReplacedBoxes: replacedBoxes, finalOverflow: overflow, finalMeasurement: measurement, attempts, resolvedByRetry: false };
  }

  if (!regeneratePackage) {
    // No injected regenerate function - Compression Retry cannot run.
    // Overflow stays as-is for Page Clone to handle next.
    return { finalReplacedBoxes: replacedBoxes, finalOverflow: overflow, finalMeasurement: measurement, attempts, resolvedByRetry: false };
  }

  let bestReplacedBoxes = replacedBoxes;
  let bestOverflow = overflow;
  let bestMeasurement: LayoutMeasurementResult | null = null;
  let bestScore = overflowScore(overflow);

  let previousGeneratedText: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    const inputLayoutConstraints = buildLayoutConstraints(measurement);
    const measurementBefore = measurement;
    const overflowBefore = overflow;

    let generatedText: string;
    let generationRequestId: string | null = null;
    let outputGenerationId: string | null = null;
    let error: string | null = null;

    try {
      const regenerated = await requestCompressionRetry(applicationId, inputLayoutConstraints, regeneratePackage);
      generatedText = documentType === "resume" ? regenerated.resume : regenerated.coverLetter;
      generationRequestId = regenerated.generationRequestId ?? null;
      outputGenerationId = regenerated.generationId ?? null;
    } catch (e) {
      error = (e as Error).message;

      // The real, already-persisted error code (VALIDATION_FAILED, the
      // same code a Protected Claims failure inside generateCore.ts
      // receives - see this module's own header comment) is embedded in
      // realRegeneratePackage.ts's thrown message as "code=...". This is
      // a real signal read from an actual failed generation attempt, not
      // a guess.
      const decision: RetryDecision = /code=VALIDATION_FAILED/.test(error)
        ? "protected_claims_failed_stop"
        : "generate_package_error_stop";

      attempts.push({
        attempt,
        generationRequestId,
        inputLayoutConstraints,
        outputGenerationId,
        measurementBefore,
        measurementAfter: null,
        overflowBefore,
        overflowAfter: overflowBefore,
        protectedClaimsValid: decision === "protected_claims_failed_stop" ? false : null,
        decision,
        elapsedMs: Date.now() - startedAt,
        error,
      });

      break;
    }

    if (previousGeneratedText !== null && generatedText === previousGeneratedText) {
      attempts.push({
        attempt,
        generationRequestId,
        inputLayoutConstraints,
        outputGenerationId,
        measurementBefore,
        measurementAfter: null,
        overflowBefore,
        overflowAfter: overflowBefore,
        protectedClaimsValid: true,
        decision: "identical_output_stop",
        elapsedMs: Date.now() - startedAt,
        error: null,
      });
      break;
    }
    previousGeneratedText = generatedText;

    const plan = createReplacementPlan(documentType, generatedText, layerModel);
    const replacement = applyReplacementPlan(layerModel, plan);
    const candidateText = renderBoxesToResumeText(replacement.replacedBoxes, experienceRefinements);
    const newMeasurement = await measureLayout(candidateText, templateId);

    if (!newMeasurement.measurable) {
      attempts.push({
        attempt,
        generationRequestId,
        inputLayoutConstraints,
        outputGenerationId,
        measurementBefore,
        measurementAfter: newMeasurement,
        overflowBefore,
        overflowAfter: overflowBefore,
        protectedClaimsValid: true,
        decision: "unmeasurable_stop",
        elapsedMs: Date.now() - startedAt,
        error: `Real measurement failed for attempt ${attempt}: ${newMeasurement.unmeasurableReason}`,
      });
      break;
    }

    const newOverflow = detectOverflow(newMeasurement);
    const newScore = overflowScore(newOverflow);

    replacedBoxes = replacement.replacedBoxes;
    overflow = newOverflow;
    measurement = newMeasurement;

    if (newScore < bestScore) {
      bestReplacedBoxes = replacedBoxes;
      bestOverflow = overflow;
      bestMeasurement = measurement;
      bestScore = newScore;
    }

    if (!newOverflow.hasOverflow) {
      attempts.push({
        attempt,
        generationRequestId,
        inputLayoutConstraints,
        outputGenerationId,
        measurementBefore,
        measurementAfter: newMeasurement,
        overflowBefore,
        overflowAfter: newOverflow,
        protectedClaimsValid: true,
        decision: "fits",
        elapsedMs: Date.now() - startedAt,
        error: null,
      });
      return {
        finalReplacedBoxes: replacedBoxes,
        finalOverflow: overflow,
        finalMeasurement: measurement,
        attempts,
        resolvedByRetry: true,
      };
    }

    const improved = newScore < overflowScore(overflowBefore);

    attempts.push({
      attempt,
      generationRequestId,
      inputLayoutConstraints,
      outputGenerationId,
      measurementBefore,
      measurementAfter: newMeasurement,
      overflowBefore,
      overflowAfter: newOverflow,
      protectedClaimsValid: true,
      decision: improved ? (attempt === MAX_RETRIES ? "budget_exhausted_stop" : "improved_continue") : "no_improvement_stop",
      elapsedMs: Date.now() - startedAt,
      error: null,
    });

    if (!improved) break;
    if (attempt === MAX_RETRIES) break;
  }

  return {
    finalReplacedBoxes: bestReplacedBoxes,
    finalOverflow: bestOverflow,
    finalMeasurement: bestMeasurement,
    attempts,
    resolvedByRetry: false,
  };
}
