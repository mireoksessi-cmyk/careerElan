/*
  Document Preservation Engine (DPE) - Phase 4B (Execution Engine) entry
  point. Not called from anywhere yet - no route, worker, or existing
  Generate Package/Renderer/Dashboard code imports this module.

  Orchestrates: Replacement Plan (Phase 4A, unmodified) -> Experience
  Refinement -> Replacement Engine -> Layout Measurement -> Overflow
  Detection -> Compression Retry (Retry Engine) -> Page Clone ->
  Validation -> Final Result, exactly the pipeline this phase's own spec
  lists.

  Status precedence (this phase's own spec lists 6 termination rules
  without a stated priority order for when more than one condition is
  true at once - this is this module's own, disclosed resolution, not
  something the spec dictated):
    1. MAPPING_FAILED - checked first, before any measurement: if the
       Replacement Plan produced literally zero assignments with a unit
       anywhere in the document, nothing downstream can be judged.
    2. LAYOUT_IMPOSSIBLE - checked after Page Clone: a box whose own
       estimated height already exceeds a full page's content limit
       cannot be fixed by adding pages.
    3. VALIDATION_FAILED - checked last (Validation runs on the FINAL
       document, after Page Clone, per this phase's own pipeline
       diagram), overriding any tentative status below if issues remain.
    4. PAGE_EXPANDED - overflow persisted through retries and Page Clone
       predicted more than one page is needed.
    5. PARTIAL_SUCCESS - no page expansion needed, but at least one
       Experience Box's Refinement was attempted and could not split
       with confidence (the original box + Phase 4A's existing mapping
       was kept, per this phase's own "Refinement 실패... 기존 Mapping을
       그대로 사용한다").
    6. SUCCESS - no overflow (or overflow fully resolved by retry), no
       refinement failures, no validation issues.
*/
import { refineExperienceContentBoxes, assignUnbreakableGroups } from "./experienceRefinement";
import { applyReplacementPlan } from "./replacementEngine";
import { renderBoxesToResumeText } from "./rendererAdapter";
import { measureLayout } from "./layoutMeasurement";
import { detectOverflow } from "./overflowDetection";
import { runRetryEngine } from "./retryEngine";
import { planPageClone } from "./pageClone";
import { validateFinalDocument } from "./validation";
import { buildRelayoutPlan } from "./relayoutPlan";
import type { ExecutionInput, ExecutionResult, ExecutionStatus } from "./types";

function isMappingImpossible(plan: ExecutionInput["replacementPlan"]): boolean {
  const totalAssignedUnits =
    plan.documentType === "resume"
      ? plan.sections.reduce(
          (sum, section) => sum + section.assignments.filter((a) => a.unit).length,
          0
        )
      : plan.assignments.filter((a) => a.unit).length;

  return totalAssignedUnits === 0;
}

export async function runExecutionEngine(
  input: ExecutionInput
): Promise<ExecutionResult> {
  const notes: string[] = [];

  if (isMappingImpossible(input.replacementPlan)) {
    return {
      status: "MAPPING_FAILED",
      finalText: null,
      templateId: null,
      pageCount: 0,
      replacedBoxes: [],
      experienceRefinements: [],
      retryAttempts: [],
      pageCloned: false,
      measurement: {
        pages: [],
        measurable: false,
        unmeasurableReason: null,
        rawElements: [],
        pageWindows: [],
        overlapPairs: [],
        totalPageCount: 0,
      },
      overflow: { hasOverflow: false, findings: [] },
      pageClonePlan: {
        pageCloned: false,
        expectedPageCount: 0,
        mode: "none",
        reason: "Mapping failed before any Page Clone decision could be evaluated.",
        verification: null,
        continuationPlan: [],
        cloneStrategy: { repeatableElements: [], continuedSections: [], newSectionStarts: [], reason: "Mapping failed before any Page Clone Strategy could be evaluated." },
        continuationChain: { nodes: [], chains: [] },
      },
      validation: {
        valid: false,
        errors: [{ type: "broken_mapping", contentBoxId: null, detail: "Replacement Plan produced zero box assignments anywhere in the document - Replacement itself is impossible." }],
        warnings: [],
        skippedChecks: [],
        unsupportedChecks: [],
        evidence: [],
        similarityScores: {
          positionSimilarity: null,
          styleSimilarity: null,
          regionSimilarity: null,
          spacingSimilarity: null,
          overallScore: null,
          comparedElementCount: 0,
          reason: "Mapping failed before any measurement or similarity comparison could be evaluated.",
        },
      },
      relayoutPlan: {
        actions: [
          {
            page: 0,
            action: "no_action_needed",
            reason: "Mapping failed before any layout decision could be evaluated.",
            targetKey: null,
            expectedImpact: "None - no measurement was ever attempted.",
            priority: "low",
          },
        ],
        requiredRelayout: false,
      },
      notes: ["Replacement Plan produced zero box assignments anywhere in the document."],
    };
  }

  // 10. Experience Group Refinement - run BEFORE Replacement, on the
  // ORIGINAL (unreplaced) editable experience-role boxes, per this
  // phase's own pipeline order ("Replacement 이전에... Refinement할 수
  // 있다").
  const experienceBoxes = input.layerModel.editableBoxes.filter((box) => box.role === "experience");
  const experienceRefinements = refineExperienceContentBoxes(experienceBoxes, input.layerModel.sourceFormat);
  /*
    `evaluated` (not raw `!refined`) is what makes this a real "attempted
    with real evidence, still not confident" signal - a real fixture
    test (a single-job Experience box) surfaced that `!refined` alone was
    wrong: a box with no data suggesting multiple jobs, correctly left
    unsplit, was being counted as a partial failure it never was. See
    ExperienceRefinementResult.evaluated's own comment.
  */
  const anyRefinementAttemptedAndFailed = experienceRefinements.some((r) => !r.refined && r.evaluated);

  // Real UnbreakableGroup (Phase 2-4 hardening pass) - grouped BEFORE
  // Replacement so the group id survives onto the replaced boxes
  // (applyReplacementPlan spreads {...originalBox, text: ...}, preserving
  // every other field including `flow`).
  const groupedLayerModel = {
    ...input.layerModel,
    editableBoxes: assignUnbreakableGroups(input.layerModel.editableBoxes, experienceRefinements),
  };

  // Template Preservation Validation baseline - the SOURCE document's own
  // original text (before any Replacement/Refinement), rendered through
  // the same real Renderer, so validation.ts can compare real
  // before/after font-family/size/weight/color/column geometry rather
  // than assume the template stayed intact.
  const originalText = renderBoxesToResumeText(groupedLayerModel.editableBoxes, []);
  const originalMeasurement = await measureLayout(originalText, input.templateId);

  // 1. Replacement Engine
  const replacement = applyReplacementPlan(groupedLayerModel, input.replacementPlan);

  // 3. Layout Measurement + 4. Overflow Detection - real headless-browser
  // measurement requires the FINAL rendered text, so Renderer Adapter now
  // runs before measurement, not after (see rendererAdapter.ts's own
  // comment - it never invents text, only reassembles existing box text,
  // so producing it early changes no content, only ordering).
  let candidateText = renderBoxesToResumeText(replacement.replacedBoxes, experienceRefinements);
  let measurement = await measureLayout(candidateText, input.templateId);
  let overflow = detectOverflow(measurement);

  // 5/6. Compression Retry / Retry Engine
  const retry = await runRetryEngine(
    input.applicationId,
    input.documentType,
    input.layerModel,
    replacement.replacedBoxes,
    experienceRefinements,
    overflow,
    input.templateId,
    input.regeneratePackage
  );

  const replacedBoxes = retry.finalReplacedBoxes;
  overflow = retry.finalOverflow;

  if (retry.attempts.length > 0) {
    // retry.finalMeasurement already reflects the BEST attempt's real
    // measurement (retryEngine.ts's own best-result tracking) - reusing
    // it avoids a redundant extra headless-browser render of text we
    // already measured during the retry loop.
    candidateText = renderBoxesToResumeText(replacedBoxes, experienceRefinements);
    measurement = retry.finalMeasurement ?? measurement;
  }

  if (retry.attempts.length > 0 && !retry.resolvedByRetry) {
    notes.push(
      `Compression Retry ran ${retry.attempts.length} attempt(s) via Generate Package's official layout_compression contract extension and did not fully resolve overflow - the BEST-scoring attempt's result was kept (see retryAttempts for per-attempt measurement/decision detail).`
    );
  } else if (overflow.hasOverflow && !input.regeneratePackage) {
    notes.push("Overflow detected but no regeneratePackage function was provided - Compression Retry did not run.");
  }

  // 7. Page Clone - real DOM re-measurement based (see pageClone.ts).
  // input.layerModel.templateBoxes is now genuinely wired through
  // (Phase 3 completion: templateRegionClassifier.ts can populate real
  // Template Region boxes) - template_aware mode is reachable whenever a
  // real classification found one, not permanently defaulted to [].
  const pageClonePlan = overflow.hasOverflow
    ? await planPageClone(measurement, candidateText, input.templateId, input.layerModel.templateBoxes)
    : {
        pageCloned: false,
        expectedPageCount: measurement.totalPageCount || 1,
        reason: "No overflow.",
        mode: "none" as const,
        verification: null,
        continuationPlan: [],
        cloneStrategy: { repeatableElements: [], continuedSections: [], newSectionStarts: [], reason: "No overflow - Page Clone was not planned, so no Page Clone Strategy was evaluated." },
        continuationChain: { nodes: [], chains: [] },
      };
  notes.push(pageClonePlan.reason);

  // A genuine clipping/horizontal-overflow signal after retry AND page
  // clone means real content is being invisibly cut with no further
  // remediation this pipeline can attempt - not "clipping" (that verdict
  // string is no longer emitted; see overflowDetection.ts, which reports
  // the real horizontal/vertical overflow direction instead).
  const layoutImpossible = overflow.findings.some(
    (f) => f.verdict === "horizontal_overflow" || f.verdict === "vertical_overflow"
  );

  // 11. Validation - runs on the FINAL replaced document regardless of
  // which path above was taken.
  const validation = validateFinalDocument(replacedBoxes, input.replacementPlan, overflow, measurement, originalMeasurement);

  // 4 (Phase 4 completion). Relayout Plan - a structured record of which
  // real remediation decisions this run actually made (see
  // relayoutPlan.ts's own comment for why this is action-level, not
  // fabricated per-box coordinate math, for a CSS-flow renderer).
  const relayoutPlan = buildRelayoutPlan(overflow, retry.attempts, pageClonePlan, measurement);

  let status: ExecutionStatus;
  if (layoutImpossible) {
    status = "LAYOUT_IMPOSSIBLE";
  } else if (!validation.valid) {
    status = "VALIDATION_FAILED";
  } else if (pageClonePlan.pageCloned) {
    status = "PAGE_EXPANDED";
  } else if (anyRefinementAttemptedAndFailed) {
    status = "PARTIAL_SUCCESS";
  } else {
    status = "SUCCESS";
  }

  return {
    status,
    finalText: candidateText,
    templateId: input.templateId,
    pageCount: pageClonePlan.expectedPageCount,
    replacedBoxes,
    experienceRefinements,
    retryAttempts: retry.attempts,
    pageCloned: pageClonePlan.pageCloned,
    measurement,
    overflow,
    validation,
    relayoutPlan,
    pageClonePlan,
    notes,
  };
}

export * from "./types";
export { buildRelayoutPlan } from "./relayoutPlan";
export { refineExperienceContentBoxes } from "./experienceRefinement";
export { applyReplacementPlan } from "./replacementEngine";
export { renderBoxesToResumeText } from "./rendererAdapter";
export { measureLayout } from "./layoutMeasurement";
export { detectOverflow } from "./overflowDetection";
export { requestCompressionRetry } from "./compressionRetry";
export { runRetryEngine } from "./retryEngine";
export { planPageClone } from "./pageClone";
export { validateFinalDocument } from "./validation";
