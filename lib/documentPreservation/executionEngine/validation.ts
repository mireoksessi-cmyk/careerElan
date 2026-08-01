/*
  Document Preservation Engine (DPE) - Phase 4B completion. Validation -
  judges the final replaced document only. Never modifies anything, never
  replaces Generate Package's own content-fact validation
  (lib/generatePackage/shared.ts's validateSourceIntegrity/
  validateProtectedClaims/validateRequirementEvidence, both entirely
  untouched and out of scope here - those check GENERATED TEXT against
  source facts; this checks the FINAL LAYOUT/MAPPING outcome).

  All 9 of this phase's own required checks are implemented, grounded in
  either the real headless-browser measurement (layoutMeasurement.ts/
  browserMeasurement.ts) or explicit ReplacementPlan/ContentBox data - no
  check here estimates a value it cannot really observe; anything this
  module genuinely cannot check is listed in `unsupportedChecks`, never
  silently treated as passing (per this phase's own "추정할 수 없는 항목을
  성공으로 처리하지 않는다").

  clipping/overlap/page_overflow/column_overflow are NOT re-derived here -
  overflowDetection.ts already computed them from the same real
  measurement; this module reclassifies its findings into Validation
  Issues so there is exactly one source of truth for each judgment.
*/
import { pageIndexForY } from "./layoutMeasurement";
import type { ReplacementPlan } from "../contentMapping/types";
import type { ContentBox } from "../contentBox/types";
import type { LayoutMeasurementResult, OverflowReport, SimilarityScores, ValidationIssue, ValidationReport } from "./types";

const DUPLICATE_TEXT_MIN_LENGTH = 20;
const HEADING_TAGS = new Set(["H1", "H2", "H3"]);

/*
  Disclosed section-omission gap (Task A's original root-cause fix,
  extended once - see the RC regression session's own regtest1
  investigation for the evidence behind the extension). A resume's
  ORIGINAL document may genuinely have no Summary/Objective/Profile
  section at all (a real, common case - many resumes omit one), while
  Generate Package's AI commonly writes one anyway. When that happens,
  resumeMapping.ts's Summary Mapping correctly finds ZERO Content Boxes to
  place it in - not a mapping defect the way the earlier Experience bug
  was (there, correctly role-classified boxes existed but were discarded
  by an over-strict filter). Confirmed via real instrumented DPE
  introspection (google_docs_docx fixture): the ORIGINAL source
  document's own real roleClassifier call log never matched a Summary/
  Profile/Objective heading anywhere in the whole document, so
  editableBoxes carries zero role="summary" boxes by construction - a
  genuine structural fact, not a bug to fix in the mapping itself (Phase
  3/4A's own "추측으로 Box를 생성하지 않는다" rule leaves no way to
  fabricate a box the source never had).

  Extended to "skills" (RC regression round, regtest1 fixture) on the SAME
  evidence shape, confirmed the same way rather than by analogy alone: a
  raw mammoth extraction of the actual uploaded regtest1 DOCX (zero AI
  involvement) contains no "Skills" text anywhere - the real source
  document genuinely has no Skills section. Content Box Generation is
  correct (zero skills-role boxes, matching the real source); Generate
  Package's AI wrote a Skills section anyway - the identical "AI writes a
  section the literal source document doesn't have" pattern as Summary,
  producing the identical contentBoxes.length===0 signature.

  This function is the ONLY place this condition is special-cased -
  scoped to an EXPLICIT two-key allowlist (DISCLOSED_OMITTABLE_SECTIONS
  below), never a blanket "any section" rule. Every other section keeps
  failing Validation exactly as before via collectUnassignedUnitIssues/
  collectBrokenMappingIssues below when its own content truly has
  nowhere to go - this never touches Experience/Education/Projects/
  Certifications/Volunteer/Languages/References.
*/
const DISCLOSED_OMITTABLE_SECTIONS = new Set(["summary", "skills"]);

function collectSummaryOmissionWarnings(plan: ReplacementPlan): ValidationIssue[] {
  if (plan.documentType !== "resume") return [];

  const warnings: ValidationIssue[] = [];
  for (const section of plan.sections) {
    if (!DISCLOSED_OMITTABLE_SECTIONS.has(section.sectionKey) || section.contentBoxes.length !== 0) continue;
    for (const unit of section.unassignedUnits) {
      warnings.push({
        type: "missing_content",
        contentBoxId: null,
        detail: `Generated ${unit.unitType} for "${section.sectionKey}" (order ${unit.order}) could not be placed: the original document has no "${section.sectionKey}" section for it to occupy (zero Content Boxes of that role exist anywhere in the source document). Disclosed as a non-blocking, structurally-unavoidable content-preservation gap, not a mapping defect: ${JSON.stringify(unit.text.slice(0, 60))}`,
      });
    }
  }
  return warnings;
}

function isSummaryOmission(sectionKey: string, contentBoxesLength: number): boolean {
  return DISCLOSED_OMITTABLE_SECTIONS.has(sectionKey) && contentBoxesLength === 0;
}

function collectUnassignedUnitIssues(plan: ReplacementPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const unassignedGroups =
    plan.documentType === "resume"
      ? plan.sections.map((section) => ({ key: section.sectionKey, unassigned: section.unassignedUnits, contentBoxesLength: section.contentBoxes.length }))
      : [{ key: "cover_letter", unassigned: plan.unassignedUnits, contentBoxesLength: plan.contentBoxes.length }];

  for (const group of unassignedGroups) {
    if (isSummaryOmission(group.key, group.contentBoxesLength)) continue;
    for (const unit of group.unassigned) {
      issues.push({
        type: "missing_content",
        contentBoxId: null,
        detail: `Generated ${unit.unitType} for "${group.key}" (order ${unit.order}) had no Content Box to occupy: ${JSON.stringify(unit.text.slice(0, 60))}`,
      });
    }
  }

  return issues;
}

function collectBrokenMappingIssues(plan: ReplacementPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const sectionsOrGroups =
    plan.documentType === "resume"
      ? plan.sections
      : [{ sectionKey: "cover_letter" as const, status: plan.status, generatedUnits: plan.generatedUnits, contentBoxes: plan.contentBoxes }];

  for (const group of sectionsOrGroups) {
    if (isSummaryOmission(group.sectionKey, group.contentBoxes.length)) continue;
    if (group.status === "unmapped" && group.generatedUnits.length > 0 && group.contentBoxes.length === 0) {
      issues.push({
        type: "broken_mapping",
        contentBoxId: null,
        detail: `Section/group "${group.sectionKey}" has generated content but zero Content Boxes of that role exist in the original document.`,
      });
    }
  }

  return issues;
}

function collectOrphanHeadingIssues(replacedBoxes: ContentBox[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < replacedBoxes.length; i++) {
    const box = replacedBoxes[i];
    if (box.role !== "heading") continue;

    const next = replacedBoxes[i + 1];
    const nextIsAnotherHeadingOrEnd = !next || next.role === "heading";

    if (nextIsAnotherHeadingOrEnd) {
      issues.push({
        type: "orphan_content",
        contentBoxId: box.id,
        detail: `Heading box "${box.text}" is followed by no body content before the next heading (or the end of the document).`,
      });
    }
  }

  return issues;
}

// Real DOM-based orphan check, distinct from the Content-Box-level check
// above: a heading-TAGGED (H1/H2/H3) element that is genuinely the last
// element measured on its real page, with more content still following
// on a later page, is a heading actually stranded at the bottom of a
// printed page - a signal the box-role check above cannot see (it has no
// concept of pages).
function collectRealOrphanHeadingIssues(measurement: LayoutMeasurementResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (measurement.totalPageCount <= 1) return issues;

  const sorted = [...measurement.rawElements].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sorted.length; i++) {
    const el = sorted[i];
    if (!HEADING_TAGS.has(el.tag)) continue;
    const next = sorted[i + 1];
    if (next && pageIndexForY(next.y) !== pageIndexForY(el.y)) {
      issues.push({
        type: "orphan_content",
        contentBoxId: null,
        detail: `Real measurement: heading "${el.text.slice(0, 60)}" (${el.tag}) is the last element on page ${pageIndexForY(el.y) + 1}, with its own content beginning only on page ${pageIndexForY(next.y) + 1}.`,
      });
    }
  }
  return issues;
}

// Real exact-text duplication across DIFFERENT real pages - the same
// signal pageClone.ts's own verification uses, reported here as a
// document-level Validation Issue rather than a Page-Clone-specific one.
function collectDuplicatedContentIssues(measurement: LayoutMeasurementResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (measurement.totalPageCount <= 1) return issues;

  const textToPages = new Map<string, Set<number>>();
  for (const el of measurement.rawElements) {
    const text = el.text.trim();
    if (text.length < DUPLICATE_TEXT_MIN_LENGTH) continue;
    const page = pageIndexForY(el.y);
    if (!textToPages.has(text)) textToPages.set(text, new Set());
    textToPages.get(text)!.add(page);
  }

  for (const [text, pages] of textToPages.entries()) {
    if (pages.size > 1) {
      issues.push({
        type: "duplicated_content",
        contentBoxId: null,
        detail: `Text "${text.slice(0, 60)}" was measured on ${pages.size} different real pages (${Array.from(pages).join(", ")}).`,
      });
    }
  }

  return issues;
}

// Content that mathematically belongs on a page beyond the ones the real
// Renderer actually created (per the SAME pageIndexForY()/CONTENT_HEIGHT_PX
// formula used everywhere else in this module) - i.e. genuinely detached
// from the document the Renderer produced, not merely overflowing within
// an existing page.
function collectDetachedContentIssues(measurement: LayoutMeasurementResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const el of measurement.rawElements) {
    const impliedPage = pageIndexForY(el.y);
    if (impliedPage >= measurement.totalPageCount) {
      issues.push({
        type: "detached_content",
        contentBoxId: null,
        detail: `Element "${el.text.slice(0, 60)}" falls at a vertical position implying page ${impliedPage + 1}, but the real Renderer only created ${measurement.totalPageCount} page(s).`,
      });
    }
  }

  return issues;
}

// Invalid page continuation: the real Renderer created more than one
// page, but either no content landed on the later page(s), or a page
// exists with zero measured elements at all - both are cases where the
// continuation itself is broken, not merely imperfect.
function collectInvalidPageContinuationIssues(measurement: LayoutMeasurementResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (measurement.totalPageCount <= 1) return issues;

  for (let pageIndex = 1; pageIndex < measurement.totalPageCount; pageIndex++) {
    const elementsOnPage = measurement.rawElements.filter((el) => pageIndexForY(el.y) === pageIndex);
    if (elementsOnPage.length === 0) {
      issues.push({
        type: "invalid_page_continuation",
        contentBoxId: null,
        detail: `Real Renderer created page ${pageIndex + 1}, but no content elements were measured on it - continuation produced an empty page.`,
      });
    }
  }

  return issues;
}

/*
  output_order_mismatch: within each section/group, assignments already
  walk Content Boxes in their real document order (Phase 4A's own
  Section/Bullet/Paragraph Matchers build `assignments` this way - see
  contentMapping's own report). If a LATER box (in document order) was
  given a generated unit with a SMALLER `order` than an EARLIER box's
  unit, the generated content came out of its own original sequence.
*/
function collectOutputOrderMismatchIssues(plan: ReplacementPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const groups =
    plan.documentType === "resume"
      ? plan.sections.map((section) => ({ key: section.sectionKey, assignments: section.assignments }))
      : [{ key: "cover_letter", assignments: plan.assignments }];

  for (const group of groups) {
    let lastOrder: number | null = null;
    let lastBoxId: string | null = null;
    for (const assignment of group.assignments) {
      if (!assignment.unit) continue;
      if (lastOrder !== null && assignment.unit.order < lastOrder) {
        issues.push({
          type: "output_order_mismatch",
          contentBoxId: assignment.contentBox.id,
          detail: `In "${group.key}", Content Box ${assignment.contentBox.id} (later in document order than box ${lastBoxId}) received generated unit order ${assignment.unit.order}, earlier than the previous box's unit order ${lastOrder}.`,
        });
      }
      lastOrder = assignment.unit.order;
      lastBoxId = assignment.contentBox.id;
    }
  }

  return issues;
}

/*
  Template Preservation Validation: real font-family/font-size/font-weight/
  color sets, and real column presence (sidebar vs main), compared between
  the ORIGINAL document's own real render and the FINAL replaced
  document's real render - both measured through the exact same Renderer/
  CSS. Natural height changes from different text length are explicitly
  NOT penalized (no page-count or contentHeightUsed comparison here); only
  genuine STYLE/STRUCTURE divergence is flagged.
*/
function collectTemplatePreservationIssues(
  finalMeasurement: LayoutMeasurementResult,
  originalMeasurement: LayoutMeasurementResult
): { issues: ValidationIssue[]; skipped: string[] } {
  if (!originalMeasurement.measurable) {
    return {
      issues: [],
      skipped: ["template_preservation: original document could not be measured for a before/after baseline."],
    };
  }

  const issues: ValidationIssue[] = [];

  const fontFamilies = (m: LayoutMeasurementResult) => new Set(m.rawElements.map((el) => el.fontFamily));
  const originalFonts = fontFamilies(originalMeasurement);
  const finalFonts = fontFamilies(finalMeasurement);
  const newFonts = Array.from(finalFonts).filter((f) => !originalFonts.has(f));
  if (newFonts.length > 0) {
    issues.push({
      type: "unexpected_template_mutation",
      contentBoxId: null,
      detail: `Final render uses font-family value(s) not present in the original render: ${newFonts.join(", ")}.`,
    });
  }

  const originalHasSidebar = originalMeasurement.rawElements.some((el) => el.column === "sidebar");
  const finalHasSidebar = finalMeasurement.rawElements.some((el) => el.column === "sidebar");
  if (originalHasSidebar !== finalHasSidebar) {
    issues.push({
      type: "unexpected_template_mutation",
      contentBoxId: null,
      detail: `Sidebar column presence changed between original (${originalHasSidebar}) and final (${finalHasSidebar}) render - column/template geometry diverged.`,
    });
  }

  // Per-page-window comparison (not just page 1) - a template mutation
  // that only shows up on a LATER page (e.g. a repeating region that
  // drifts after Page Clone) would be invisible to a page[0]-only check.
  const pageCount = Math.min(originalMeasurement.pageWindows.length, finalMeasurement.pageWindows.length);
  for (let i = 0; i < pageCount; i++) {
    const o = originalMeasurement.pageWindows[i];
    const f = finalMeasurement.pageWindows[i];
    if (o.clientWidth !== f.clientWidth || o.clientHeight !== f.clientHeight) {
      issues.push({
        type: "unexpected_template_mutation",
        contentBoxId: null,
        detail: `Real page ${i + 1} window size changed between original (${o.clientWidth}x${o.clientHeight}px) and final (${f.clientWidth}x${f.clientHeight}px) render.`,
      });
    }
  }

  /*
    Box-level comparison (Phase 4 completion, Phase 1-4 roadmap-closure
    effort) - real per-element geometry/style comparison, keyed by exact
    text match. This is the closest honest approximation to true
    Content-Box-id-level comparison achievable today: real DOM
    measurement (browserMeasurement.ts) cannot trace a rendered element
    back to the ORIGINAL ContentBox that produced it (Renderer Adapter
    reassembles boxes into plain text before rendering - see
    rendererAdapter.ts's own investigation conclusion), so exact-text
    matching is used as the identity proxy instead. This only ever
    applies to TEMPLATE/boilerplate content that is expected to be
    byte-identical between original and final render (a real repeating
    header/footer/page-number, or any element whose text simply never
    changed) - it is never applied to generated section content, which
    legitimately changes text on every generation and has no stable
    identity to compare by construction.

    Phase5 Gate Blocker 3 root-cause fix (real, evidenced - see the
    session's own investigation): text-only matching is not a strong
    enough identity proxy on its own - real instrumented output proved
    two distinct false-positive shapes. (1) word_docx's "Frontend
    Developer" (job #2's real title) coincidentally matched an unrelated
    element in the ORIGINAL baseline's own re-parse: original tag=LI
    (mis-split as job #1's 4th bullet, entry=0/bullet=3) vs final tag=H3
    (correctly parsed as job #2's own title, entry=1/bullet=null) - same
    words, completely different structural role, both from independently
    re-parsing reconstructed text (see this file's own comment above on
    why exact-text is used at all - re-parsing divergence is the newly-
    confirmed real risk that comment did not yet account for). (2) the
    same fixture's Skills list ("- React"/"- Node.js"/...): both sides
    ARE genuinely tag=LI/section=skills, but the AI's own generated
    ordering differs from the original table's reading order, so the
    SAME skill text lands at a different ordinal position (thus a
    different real x) in each render - a legitimate reorder, not a
    mutation.

    The already-real, already-extracted `dpeSection`/`dpeEntry`/
    `dpeBullet`/`tag` DOM metadata (Phase 2-4 hardening's own
    data-dpe-* attributes, browserMeasurement.ts) resolves the
    "Frontend Developer" shape (entry/bullet index differs) with no new
    Renderer/Adapter work at all. It does NOT resolve the Skills-list
    shape: `dpeEntry`/`dpeBullet` are only ever set on the entry-based
    render path (Experience/Volunteer, see DocumentRenderer.tsx) - a
    flat list like Skills has neither, so both real "React" elements
    still carry entry=null/bullet=null and would otherwise still match
    by coincidence. Rather than touch the Renderer to add a new
    per-item attribute, this reuses information already present in the
    SAME rawElements array this function already has: an element's own
    ORDINAL position among same-(tag, section) siblings, computed here,
    in document order, from each side's own array independently. Two
    genuinely-reordered skills with identical text now get different
    ordinals (whichever position each landed in on its own side) and
    stop matching; a real repeating template element keeps the same
    ordinal on both sides by construction, so nothing this check was
    meant to catch is weakened.
  */
  function withOrdinals(elements: typeof originalMeasurement.rawElements) {
    const seen = new Map<string, number>();
    return elements.map((el) => {
      const groupKey = `${el.tag}|||${el.dpeSection ?? ""}`;
      const ordinal = seen.get(groupKey) ?? 0;
      seen.set(groupKey, ordinal + 1);
      return { el, ordinal };
    });
  }

  const boxIdentityKey = (el: typeof originalMeasurement.rawElements[number], ordinal: number) =>
    `${el.text.trim()}|||${el.tag}|||${el.dpeSection ?? ""}|||${el.dpeEntry ?? ""}|||${el.dpeBullet ?? ""}|||${ordinal}`;

  const originalByIdentity = new Map<string, typeof originalMeasurement.rawElements[number]>();
  for (const { el, ordinal } of withOrdinals(originalMeasurement.rawElements)) {
    if (!el.text.trim()) continue;
    const key = boxIdentityKey(el, ordinal);
    if (!originalByIdentity.has(key)) originalByIdentity.set(key, el);
  }

  const POSITION_DRIFT_TOLERANCE_PX = 2;
  let boxLevelComparisons = 0;
  for (const { el: finalEl, ordinal } of withOrdinals(finalMeasurement.rawElements)) {
    const text = finalEl.text.trim();
    if (!text) continue;
    const originalEl = originalByIdentity.get(boxIdentityKey(finalEl, ordinal));
    if (!originalEl) continue;

    boxLevelComparisons++;

    if (originalEl.fontFamily !== finalEl.fontFamily || originalEl.fontWeight !== finalEl.fontWeight || originalEl.fontSize !== finalEl.fontSize) {
      issues.push({
        type: "unexpected_template_mutation",
        contentBoxId: null,
        detail: `Box-level: unchanged text "${text.slice(0, 50)}" real style diverged (font-family/weight/size: original="${originalEl.fontFamily}/${originalEl.fontWeight}/${originalEl.fontSize}" final="${finalEl.fontFamily}/${finalEl.fontWeight}/${finalEl.fontSize}").`,
      });
    }

    // Only meaningful when both are on the SAME real page (position
    // naturally shifts across a page boundary, which is not a mutation).
    if (
      pageIndexForY(originalEl.y) === pageIndexForY(finalEl.y) &&
      Math.abs(originalEl.x - finalEl.x) > POSITION_DRIFT_TOLERANCE_PX
    ) {
      issues.push({
        type: "unexpected_template_mutation",
        contentBoxId: null,
        detail: `Box-level: unchanged text "${text.slice(0, 50)}" real horizontal position drifted (original x=${Math.round(originalEl.x)}px, final x=${Math.round(finalEl.x)}px) on the same page.`,
      });
    }
  }

  return {
    issues,
    skipped:
      boxLevelComparisons === 0
        ? [
            "template_preservation (box-level): no unchanged (identical-text) element pairs existed between original and final render to compare individually - every element's text changed, so only the aggregate/page-level checks above applied.",
          ]
        : [],
  };
}

const POSITION_DRIFT_TOLERANCE_PX = 2;
const POSITION_DRIFT_FLOOR_PX = 50;
const SPACING_SIMILARITY_FLOOR = 0;

/*
  Real per-box-level similarity scoring (Phase 2-4 hardening pass). Uses
  the SAME exact-text identity-proxy match set as
  collectTemplatePreservationIssues() above - see that function's own
  comment for why this is the honest ceiling without true Content-Box-id
  traceability through the Renderer. Every score is derived from real
  measured numbers (x/column/fontFamily/fontWeight/fontSize/lineHeight);
  nothing here is a guess, and every component that has zero qualifying
  pairs is left null rather than defaulted to a perfect or zero score.
*/
function computeSimilarityScores(
  finalMeasurement: LayoutMeasurementResult,
  originalMeasurement: LayoutMeasurementResult
): SimilarityScores {
  if (!originalMeasurement.measurable) {
    return {
      positionSimilarity: null,
      styleSimilarity: null,
      regionSimilarity: null,
      spacingSimilarity: null,
      overallScore: null,
      comparedElementCount: 0,
      reason: "Original document could not be measured for a before/after baseline - no similarity scores could be computed.",
    };
  }

  const originalByText = new Map<string, LayoutMeasurementResult["rawElements"][number]>();
  for (const el of originalMeasurement.rawElements) {
    const text = el.text.trim();
    if (text.length > 0 && !originalByText.has(text)) originalByText.set(text, el);
  }

  let compared = 0;
  let styleMatches = 0;
  let regionMatches = 0;
  let positionScoreSum = 0;
  let positionScoreCount = 0;
  let spacingScoreSum = 0;
  let spacingScoreCount = 0;

  for (const finalEl of finalMeasurement.rawElements) {
    const text = finalEl.text.trim();
    const originalEl = originalByText.get(text);
    if (!originalEl) continue;
    compared++;

    if (
      originalEl.fontFamily === finalEl.fontFamily &&
      originalEl.fontWeight === finalEl.fontWeight &&
      originalEl.fontSize === finalEl.fontSize
    ) {
      styleMatches++;
    }

    if (originalEl.column === finalEl.column) {
      regionMatches++;
    }

    // Position drift is only a real signal when both real occurrences
    // landed on the SAME real page (position naturally shifts across a
    // page boundary - see collectTemplatePreservationIssues()'s own
    // identical exclusion).
    if (pageIndexForY(originalEl.y) === pageIndexForY(finalEl.y)) {
      const drift = Math.abs(originalEl.x - finalEl.x);
      const score =
        drift <= POSITION_DRIFT_TOLERANCE_PX
          ? 1
          : Math.max(0, 1 - (drift - POSITION_DRIFT_TOLERANCE_PX) / (POSITION_DRIFT_FLOOR_PX - POSITION_DRIFT_TOLERANCE_PX));
      positionScoreSum += score;
      positionScoreCount++;
    }

    if (originalEl.lineHeight > 0 && finalEl.lineHeight > 0) {
      const diffRatio = Math.abs(originalEl.lineHeight - finalEl.lineHeight) / originalEl.lineHeight;
      spacingScoreSum += Math.max(SPACING_SIMILARITY_FLOOR, 1 - diffRatio);
      spacingScoreCount++;
    }
  }

  if (compared === 0) {
    return {
      positionSimilarity: null,
      styleSimilarity: null,
      regionSimilarity: null,
      spacingSimilarity: null,
      overallScore: null,
      comparedElementCount: 0,
      reason: "No unchanged (identical-text) element pairs existed between original and final render - every element's text changed, so no real box-level similarity comparison was possible.",
    };
  }

  const styleSimilarity = styleMatches / compared;
  const regionSimilarity = regionMatches / compared;
  const positionSimilarity = positionScoreCount > 0 ? positionScoreSum / positionScoreCount : null;
  const spacingSimilarity = spacingScoreCount > 0 ? spacingScoreSum / spacingScoreCount : null;

  const components = [positionSimilarity, styleSimilarity, regionSimilarity, spacingSimilarity].filter(
    (v): v is number => v !== null
  );
  const overallScore = components.length > 0 ? components.reduce((sum, v) => sum + v, 0) / components.length : null;

  return {
    positionSimilarity,
    styleSimilarity,
    regionSimilarity,
    spacingSimilarity,
    overallScore,
    comparedElementCount: compared,
    reason: `Computed over ${compared} real (original, final) element pair(s) matched by exact unchanged text - the same identity-proxy match set collectTemplatePreservationIssues() uses (real Content-Box-id traceability through the Renderer is not available - see this file's own comment).`,
  };
}

const NO_BASELINE_SIMILARITY_SCORES: SimilarityScores = {
  positionSimilarity: null,
  styleSimilarity: null,
  regionSimilarity: null,
  spacingSimilarity: null,
  overallScore: null,
  comparedElementCount: 0,
  reason: "No original-document baseline measurement was provided to this call - similarity scores require a real before/after comparison.",
};

const UNMEASURABLE_SIMILARITY_SCORES: SimilarityScores = {
  positionSimilarity: null,
  styleSimilarity: null,
  regionSimilarity: null,
  spacingSimilarity: null,
  overallScore: null,
  comparedElementCount: 0,
  reason: "Final document layout is not measurable - similarity scores require a real final-render measurement.",
};

export function validateFinalDocument(
  replacedBoxes: ContentBox[],
  plan: ReplacementPlan,
  overflow: OverflowReport,
  measurement: LayoutMeasurementResult,
  originalMeasurement?: LayoutMeasurementResult
): ValidationReport {
  const skippedChecks: string[] = [];
  const unsupportedChecks: string[] = [
    "protected_content_omission: this module has no access to Generate Package's Protected Claims text list (out of scope by this phase's own boundary - see lib/generatePackage/shared.ts's validateProtectedClaims, which already runs this check on the GENERATED TEXT itself, unmodified).",
  ];

  const evidence: string[] = [
    measurement.measurable
      ? `Final document measured via real headless browser: totalPageCount=${measurement.totalPageCount}, elements=${measurement.rawElements.length}.`
      : `Final document could not be measured: ${measurement.unmeasurableReason}`,
  ];

  if (!measurement.measurable) {
    skippedChecks.push(
      "clipping",
      "overlap",
      "page_overflow",
      "column_overflow",
      "duplicated_content",
      "orphan_content(real)",
      "invalid_page_continuation",
      "detached_content",
      "unexpected_template_mutation"
    );

    return {
      valid: false,
      errors: [
        { type: "broken_mapping", contentBoxId: null, detail: `Layout is not measurable: ${measurement.unmeasurableReason}. Per this phase's own rule, an unmeasurable result is never treated as a pass.` },
        ...collectUnassignedUnitIssues(plan),
        ...collectBrokenMappingIssues(plan),
      ],
      warnings: collectSummaryOmissionWarnings(plan),
      skippedChecks,
      unsupportedChecks,
      evidence,
      similarityScores: UNMEASURABLE_SIMILARITY_SCORES,
    };
  }

  const overflowDerivedErrors: ValidationIssue[] = overflow.findings
    .filter((f) => f.verdict !== "fits" && f.verdict !== "overflow")
    .map((f): ValidationIssue => {
      const typeMap: Record<string, ValidationIssue["type"]> = {
        overflow: "page_overflow",
        overlap: "overlap",
        column_overflow: "column_overflow",
        vertical_overflow: "clipping",
        horizontal_overflow: "horizontal_overflow",
      };
      return {
        type: typeMap[f.verdict] ?? "page_overflow",
        contentBoxId: f.contentBoxId === "*" ? null : f.contentBoxId,
        detail: f.detail,
      };
    });

  const templatePreservation = originalMeasurement
    ? collectTemplatePreservationIssues(measurement, originalMeasurement)
    : { issues: [], skipped: ["template_preservation: no original-document baseline measurement was provided to this call."] };
  skippedChecks.push(...templatePreservation.skipped);

  const similarityScores = originalMeasurement
    ? computeSimilarityScores(measurement, originalMeasurement)
    : NO_BASELINE_SIMILARITY_SCORES;

  const errors: ValidationIssue[] = [
    ...overflowDerivedErrors,
    ...collectUnassignedUnitIssues(plan),
    ...collectBrokenMappingIssues(plan),
    ...collectOrphanHeadingIssues(replacedBoxes),
    ...collectRealOrphanHeadingIssues(measurement),
    ...collectDuplicatedContentIssues(measurement),
    ...collectInvalidPageContinuationIssues(measurement),
    ...collectDetachedContentIssues(measurement),
    ...collectOutputOrderMismatchIssues(plan),
    ...templatePreservation.issues,
  ];

  return {
    valid: errors.length === 0,
    errors,
    warnings: collectSummaryOmissionWarnings(plan),
    skippedChecks,
    unsupportedChecks,
    evidence,
    similarityScores,
  };
}
