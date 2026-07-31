/*
  Document Preservation Engine (DPE) - Phase 4B (Execution Engine).
  Types only. No text is generated, replaced text is data-only here (the
  Replacement Engine writes into ContentBox COPIES, never mutates Phase 3
  originals or calls the real Renderer/Export).
*/
import type { ContentBox, DocumentLayerModel } from "../contentBox/types";
import type { ReplacementPlan } from "../contentMapping/types";
import type { RealElementMeasurement, RealPageWindowMeasurement } from "./browserMeasurement";

/*
  12. Final Status - the exact 6 values and termination rules this
  phase's own spec requires (섹션 12), nothing added, nothing renamed.
*/
export type ExecutionStatus =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "PAGE_EXPANDED"
  | "LAYOUT_IMPOSSIBLE"
  | "MAPPING_FAILED"
  | "VALIDATION_FAILED";

export type OverflowVerdict =
  | "fits"
  | "overflow"
  | "clipping"
  | "overlap"
  | "column_overflow"
  | "horizontal_overflow"
  | "vertical_overflow";

/*
  Measurement is per-box, per-page, sourced from a REAL headless-browser
  DOM render of the actual product Renderer (browserMeasurement.ts) - not
  an estimate. `available: false` is reserved for the case where the
  browser measurement itself failed (see `measurable`/`unmeasurableReason`
  below); it is never a stand-in for "we didn't bother measuring this
  format" (the old PDF/DOCX asymmetry this replaced).
*/
export type BoxMeasurement = {
  contentBoxId: string;
  available: boolean;
  lineCount: number | null;
  renderedWidth: number | null;
  renderedHeight: number | null;
  reason: string | null;
};

export type PageMeasurement = {
  page: number;
  boxMeasurements: BoxMeasurement[];
  contentHeightUsed: number | null;
  contentHeightLimit: number | null;
};

export type RealOverlapPair = {
  elementAIndex: number;
  elementBIndex: number;
  overlapWidth: number;
  overlapHeight: number;
};

/*
  rawElements/pageWindows/overlapPairs/totalPageCount are the REAL,
  browser-measured data (see browserMeasurement.ts/layoutMeasurement.ts) -
  part of the canonical result shape (not a separate "Real*" wrapper
  type) so every downstream consumer (overflowDetection.ts, pageClone.ts,
  validation.ts, retryEngine.ts) shares one definition instead of each
  re-declaring its own subset.
*/
export type LayoutMeasurementResult = {
  pages: PageMeasurement[];
  measurable: boolean;
  unmeasurableReason: string | null;
  rawElements: RealElementMeasurement[];
  pageWindows: RealPageWindowMeasurement[];
  overlapPairs: RealOverlapPair[];
  totalPageCount: number;
};

export type OverflowFinding = {
  contentBoxId: string;
  page: number;
  verdict: OverflowVerdict;
  detail: string;
};

export type OverflowReport = {
  hasOverflow: boolean;
  findings: OverflowFinding[];
};

/*
  9 required checks (spec item 11), all now implemented in validation.ts,
  plus 4 "additionally where possible" checks - each of those 4 is either
  implemented on a real signal or explicitly listed in `unsupportedChecks`
  below, never silently skipped.
*/
export type ValidationIssueType =
  | "clipping"
  | "overlap"
  | "page_overflow"
  | "column_overflow"
  | "broken_mapping"
  | "missing_content"
  | "duplicated_content"
  | "orphan_content"
  | "invalid_page_continuation"
  | "horizontal_overflow"
  | "detached_content"
  | "unexpected_template_mutation"
  | "protected_content_omission"
  | "output_order_mismatch";

export type ValidationIssue = {
  type: ValidationIssueType;
  contentBoxId: string | null;
  detail: string;
};

/*
  Phase 2-4 hardening pass (P4H item "Validation 강화"). Four real,
  per-box-level similarity scores (0-1) - each null (never fabricated as
  1.0/0.0) when no real element pair qualified for that specific
  comparison. All four are computed over the SAME identity-proxy match
  set as collectTemplatePreservationIssues() (exact-text match between
  original and final render - see that function's own comment on why
  this is the closest honest approximation available without true
  Content-Box-id traceability through the Renderer). `overallScore` is
  the plain average of whichever component scores are non-null; null
  only when every component is null (i.e. `comparedElementCount === 0`).
*/
export type SimilarityScores = {
  /* Real horizontal-position drift (px) for matched elements confirmed
     on the SAME real page, mapped to 0-1 (1 = at/under a small pixel
     tolerance, tapering to 0 by a disclosed max-drift bound). Null when
     no matched pair shared a page (every match happened to span a page
     boundary, where drift is expected and not a real signal). */
  positionSimilarity: number | null;
  /* Real font-family/font-weight/font-size exact-match rate across all
     matched elements. */
  styleSimilarity: number | null;
  /* Real sidebar/main column-assignment exact-match rate across all
     matched elements (browserMeasurement.ts's own real `column` field,
     derived from whether the DOM node sits inside the real <aside>). */
  regionSimilarity: number | null;
  /* Real computed line-height similarity (1 - normalized difference,
     floored at 0) across all matched elements with a real, positive
     line-height on both sides. */
  spacingSimilarity: number | null;
  overallScore: number | null;
  /* How many real (original, final) element pairs (by exact-text match)
     this score set was computed over - 0 means every component above is
     null, never silently defaulted. */
  comparedElementCount: number;
  reason: string;
};

export type ValidationReport = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  skippedChecks: string[];
  unsupportedChecks: string[];
  evidence: string[];
  similarityScores: SimilarityScores;
};

/*
  10. Experience Group Refinement result for ONE original Experience
  Content Box. `entries` is only ever populated when boundaries were
  found with real confidence (see experienceRefinement.ts) - an empty
  array + `refined: false` means the original box was kept as-is and
  Phase 4A's existing mapping for it is reused unchanged.
*/
export type RefinedBulletGroup = {
  boxId: string | null;
  bulletText: string;
};

export type RefinedJobEntry = {
  titleText: string | null;
  companyText: string | null;
  bullets: RefinedBulletGroup[];
  /*
    Phase 2-4 hardening pass (Real UnbreakableGroup). Only ever non-null
    for DOCX (real 1:1 Content Boxes - see refineDocxExperienceBoxes(),
    which already knows the exact box each title/company line came from
    at the point it builds this entry). Always null for PDF: geometry
    clustering already merged an entire job's title+company+bullets into
    ONE ContentBox before refinement ever runs (see
    pdfContentBoxGenerator.ts), so there is no separate title/company box
    id to report - that single box is already inherently unbreakable,
    nothing to group.
  */
  titleBoxId: string | null;
  companyBoxId: string | null;
};

export type ExperienceRefinementResult = {
  originalBoxId: string;
  refined: boolean;
  /*
    True only when at least one real candidate boundary was actually
    proposed from real signals (a genuine "this might be multiple jobs"
    hypothesis) but rejected downstream - as opposed to a box where no
    signal ever suggested a split (a confidently single-entry box, or one
    with too little data to evaluate at all). Index.ts's PARTIAL_SUCCESS
    decision uses this, not `!refined` alone - a real bug this
    distinction fixes: a single-job box with nothing to split is a
    correct, complete outcome, not a partial failure (see this module's
    own report for the real fixture that surfaced this).
  */
  evaluated: boolean;
  reason: string;
  entries: RefinedJobEntry[];
};

/*
  5/6. Compression Retry / Retry Engine. `regeneratePackage` stays an
  INJECTED function (this module never calls Supabase/OpenAI directly -
  see compressionRetry.ts's own comment on why), but its signature now
  carries the official `LayoutConstraints` contract extension
  (lib/generatePackage/shared.ts) as a real second parameter - the
  structural gap this phase was explicitly authorized to close ("기존
  공개 인터페이스가 압축 요구를 표현할 수 없다는 구조적 한계"). A REAL
  implementation of this function (executionEngine/realRegeneratePackage.ts)
  inserts a new applications row with dpe_generation_mode=
  "layout_compression" and these constraints, then calls Generate
  Package's own runPackageGeneration() - the actual public interface,
  unmodified prompt pipeline, real OpenAI call.
*/
export type RegeneratePackageFn = (
  applicationId: string,
  layoutConstraints: LayoutConstraints
) => Promise<{
  resume: string;
  coverLetter: string;
  /* Real ids of the NEW generation attempt, when the injected function
     creates one (see realRegeneratePackage.ts) - undefined for any
     lighter-weight injected function (e.g. a test double) that has no
     real applications row to report. Purely for RetryAttempt logging;
     never used for control flow. */
  generationId?: string;
  generationRequestId?: string;
}>;

export type LayoutConstraints = {
  targetPageCount?: number;
  maxRenderedHeightBySection?: Record<string, number>;
  maxBulletCountByExperience?: number;
  overflowSections?: string[];
  sectionCharacterBudgets?: Record<string, number>;
  preserveProtectedClaims?: boolean;
};

/*
  9. Retry Engine - per-attempt log, matching this phase's own required
  fields exactly: attempt number, generation request id, input layout
  constraints, output generation id, measurement before/after, overflow
  before/after, protected-claim validation result, retry decision,
  elapsed time, error.
*/
export type RetryDecision =
  | "fits"
  | "improved_continue"
  | "no_improvement_stop"
  | "identical_output_stop"
  | "protected_claims_failed_stop"
  | "generate_package_error_stop"
  | "unmeasurable_stop"
  | "budget_exhausted_stop";

export type RetryAttempt = {
  attempt: number;
  generationRequestId: string | null;
  inputLayoutConstraints: LayoutConstraints;
  outputGenerationId: string | null;
  measurementBefore: LayoutMeasurementResult | null;
  measurementAfter: LayoutMeasurementResult | null;
  overflowBefore: OverflowReport;
  overflowAfter: OverflowReport;
  protectedClaimsValid: boolean | null;
  decision: RetryDecision;
  elapsedMs: number;
  error: string | null;
};

export type ExecutionInput = {
  applicationId: string;
  documentType: DocumentLayerModel["documentType"];
  layerModel: DocumentLayerModel;
  replacementPlan: ReplacementPlan;
  regeneratePackage?: RegeneratePackageFn;
  /*
    Real Layout Measurement (browserMeasurement.ts) has to know which
    Renderer template to actually render - Phase 3's Content Box model
    never carried this (see contentBox/types.ts's own DocumentLayerModel,
    which has no templateId field). Not a Renderer/Generate Package
    contract change - purely a new field on this module's OWN input type,
    supplied by whichever caller already knows the application's chosen
    template (e.g. applications.resume_template_id).
  */
  templateId: string;
};

export type ExecutionResult = {
  status: ExecutionStatus;
  finalText: string | null;
  templateId: string | null;
  pageCount: number;
  replacedBoxes: ContentBox[];
  experienceRefinements: ExperienceRefinementResult[];
  retryAttempts: RetryAttempt[];
  pageCloned: boolean;
  measurement: LayoutMeasurementResult;
  overflow: OverflowReport;
  relayoutPlan: import("./relayoutPlan").RelayoutPlan;
  /*
    Phase 2-4 hardening pass: the FULL Page Clone decision record
    (mode/verification/continuationPlan, plus the new cloneStrategy/
    continuationChain - see pageClone.ts) - previously computed by
    index.ts but never exposed beyond the flattened `pageCloned`/
    `pageCount` fields above, which made the Continuation Plan/Strategy/
    Chain unreachable by any real caller despite being computed. Kept as
    an ADDITIVE field - `pageCloned`/`pageCount` are unchanged for any
    existing caller depending on them.
  */
  pageClonePlan: import("./pageClone").PageCloneResult;
  validation: ValidationReport;
  notes: string[];
};
