/*
  Document Preservation Engine (DPE) - Layout Preservation completion pass
  (Phase 1-4 roadmap-closure effort, Phase 4 item; upgraded further in the
  Phase 2-4 Hardening pass, item P4H "Relayout Strategy 고도화"). Real
  Relayout Plan - a structured, traceable record of WHICH real
  overflow/measurement facts led to WHICH remediation decision, built
  from data this pipeline already computes for real (retryEngine.ts's
  attempts, overflowDetection.ts's findings, pageClone.ts's real
  measurement, and now the real per-element data-dpe-* tagging added by
  the Renderer's own minimal DOM extension) - not a new layout engine.

  Disclosed scope boundary, unchanged from the original pass: this
  Renderer is CSS-flow based, not an absolute-position/canvas renderer -
  there is no "compute new x/y coordinates for each box" operation for a
  flow renderer to perform. Every action below is an ACTION-LEVEL
  decision record (which remediation this pipeline recommends/applied,
  why, and what real signal justified it), never fabricated coordinate
  math.

  Hardening pass upgrade: five action kinds now, each backed by a
  DIFFERENT real signal (not five labels over the same one fact):
  - compress_content / suggest_page_break: unchanged real basis (a real
    overflow finding persisting to final measurement), now additionally
    carries a real `targetKey` when the boundary element on that page
    carries a data-dpe-section tag.
  - merge_paragraphs: real signal - 2+ CONSECUTIVE short (<=
    MERGE_MAX_LINES real measured lines) <p>/<li> elements on the SAME
    overflowing page, in the SAME real data-dpe-section, with no other
    element between them.
  - reduce_whitespace: real signal - an element's own real measured
    height exceeds its real line-count * real computed line-height by
    more than a disclosed threshold (i.e. real box height carries
    padding/margin beyond its own text content) - an intrinsic per-
    element fact, not a cross-element estimate.
  - shift_section: real signal - two or more real measured elements
    share the SAME real data-dpe-unbreakable group id (Phase 2-4
    hardening's own real UnbreakableGroup assignment, now traceable
    through the Renderer's own minimal DOM attributes) but were measured
    on DIFFERENT real pages - i.e. a group this pipeline marked
    unbreakable was, in fact, split by the Renderer (which does not
    consult this metadata) - a genuine, real preservation-fidelity
    finding, not a guess.

  `targetKey` is deliberately NOT a ContentBox id: browserMeasurement.ts's
  own BoxMeasurement.contentBoxId is already a SYNTHETIC per-render id
  (`real-el-{page}-{idx}`), never traceable back to an original
  ContentBox (Renderer Adapter reassembles boxes into plain text before
  rendering - see rendererAdapter.ts's own investigation). `targetKey`
  instead references the real data-dpe-section/data-dpe-unbreakable value
  read back off the actual rendered DOM - real, but coarser than a box id,
  and disclosed as such.
*/
import { pageIndexForY } from "./layoutMeasurement";
import type { LayoutMeasurementResult, OverflowReport, RetryAttempt } from "./types";
import type { RealElementMeasurement } from "./browserMeasurement";
import type { PageCloneResult } from "./pageClone";

export type RelayoutActionType =
  | "compress_content"
  | "merge_paragraphs"
  | "reduce_whitespace"
  | "shift_section"
  | "suggest_page_break"
  | "no_action_needed";

export type RelayoutPriority = "high" | "medium" | "low";

export type RelayoutAction = {
  page: number;
  action: RelayoutActionType;
  reason: string;
  /* Real dpeSection/dpeUnbreakableGroup-derived reference, or null when
     no real per-render tagging metadata applied to this action (e.g. a
     whole-document compress_content action). Never a fabricated
     ContentBox id - see this file's own header comment. */
  targetKey: string | null;
  expectedImpact: string;
  priority: RelayoutPriority;
};

export type RelayoutPlan = {
  actions: RelayoutAction[];
  /* True only when at least one action is anything other than
     "no_action_needed" - a quick real signal for callers that want to
     know "did this document need any relayout at all". */
  requiredRelayout: boolean;
};

const MERGE_MAX_LINES = 2;
const WHITESPACE_MIN_EXCESS_PX = 8;
const WHITESPACE_EXCESS_RATIO = 0.35;
const SHORT_MERGEABLE_TAGS = new Set(["P", "LI"]);

function pageElementsSortedByY(
  measurement: LayoutMeasurementResult,
  pageIndex: number
): RealElementMeasurement[] {
  return measurement.rawElements
    .filter((el) => pageIndexForY(el.y) === pageIndex)
    .sort((a, b) => a.y - b.y);
}

function lineCountOf(el: RealElementMeasurement): number | null {
  return el.lineHeight > 0 ? Math.max(1, Math.round(el.height / el.lineHeight)) : null;
}

/*
  Compression / Page Break Suggestion - real basis unchanged from the
  original pass (a real overflow finding persisting to final
  measurement); the only addition is a real `targetKey` naming the
  data-dpe-section of the LAST (bottom-most) real element measured on
  that page, when that element carries the tag - the actual boundary
  content the overflow butts up against, not a guess at which section
  "caused" it.
*/
function buildOverflowActions(
  pagesWithOverflow: Set<number>,
  retryAttempts: RetryAttempt[],
  measurement: LayoutMeasurementResult
): RelayoutAction[] {
  const actions: RelayoutAction[] = [];

  for (const attempt of retryAttempts) {
    if (attempt.decision === "fits" || attempt.decision === "improved_continue") {
      actions.push({
        page: 0,
        action: "compress_content",
        reason: `Retry attempt ${attempt.attempt}: real Compression Retry was applied (decision=${attempt.decision}).`,
        targetKey: null,
        expectedImpact: "Whole-document text regeneration under real layout constraints (see retryAttempts for the actual before/after measurement) - not a per-section edit.",
        priority: "high",
      });
    }
  }

  for (const page of Array.from(pagesWithOverflow).sort((a, b) => a - b)) {
    const elements = pageElementsSortedByY(measurement, page - 1);
    const boundaryElement = elements[elements.length - 1] ?? null;
    const targetKey = boundaryElement?.dpeSection ? `section:${boundaryElement.dpeSection}` : null;

    actions.push({
      page,
      action: retryAttempts.length > 0 ? "compress_content" : "suggest_page_break",
      reason: `Page ${page} had a real overflow finding that persisted through to the final measurement.`,
      targetKey,
      expectedImpact:
        retryAttempts.length > 0
          ? "Already covered by the whole-document Compression Retry attempt(s) above."
          : `No Compression Retry was attempted for this document - inserting a page break before ${targetKey ?? "the page boundary content"} is the disclosed fallback remediation (moves that content to a new page).`,
      priority: "high",
    });
  }

  return actions;
}

/*
  Paragraph Merge - real signal: on an overflowing page, 2+ CONSECUTIVE
  (by real measured Y order, no other element between them) short <p>/
  <li> elements sharing the SAME real data-dpe-section. Merging short
  adjacent paragraphs within the same section is a real, disclosed
  compression candidate - never applied automatically, only surfaced as
  a suggestion (this pipeline does not rewrite text itself here).
*/
function buildMergeParagraphActions(
  pagesWithOverflow: Set<number>,
  measurement: LayoutMeasurementResult
): RelayoutAction[] {
  const actions: RelayoutAction[] = [];

  for (const page of pagesWithOverflow) {
    const elements = pageElementsSortedByY(measurement, page - 1);

    for (let i = 0; i < elements.length - 1; i++) {
      const a = elements[i];
      const b = elements[i + 1];

      if (!SHORT_MERGEABLE_TAGS.has(a.tag) || !SHORT_MERGEABLE_TAGS.has(b.tag)) continue;
      if (!a.dpeSection || a.dpeSection !== b.dpeSection) continue;

      const aLines = lineCountOf(a);
      const bLines = lineCountOf(b);
      if (aLines === null || bLines === null) continue;
      if (aLines > MERGE_MAX_LINES || bLines > MERGE_MAX_LINES) continue;

      actions.push({
        page,
        action: "merge_paragraphs",
        reason: `Two consecutive short elements (<=${MERGE_MAX_LINES} real measured line(s) each) in the same section "${a.dpeSection}" were found back-to-back on the overflowing page ${page}.`,
        targetKey: `section:${a.dpeSection}`,
        expectedImpact: `Combining these into one paragraph could reclaim roughly one line-height (~${Math.round(a.lineHeight)}px) of vertical space from the shared line-wrap/paragraph-spacing overhead - an estimate, not a guaranteed reduction.`,
        priority: "low",
      });
    }
  }

  return actions;
}

/*
  Whitespace Reduction - real, INTRINSIC per-element signal: an
  element's own real measured height vs. its own real measured line
  count * real computed line-height. The difference is real vertical
  space inside that element's own box (margin/padding/line-height
  slack) beyond what its actual text content needs - never a
  cross-element estimate or a claim about the source document's
  authored spacing.
*/
function buildWhitespaceActions(
  pagesWithOverflow: Set<number>,
  measurement: LayoutMeasurementResult
): RelayoutAction[] {
  const actions: RelayoutAction[] = [];

  for (const page of pagesWithOverflow) {
    const elements = pageElementsSortedByY(measurement, page - 1);

    for (const el of elements) {
      const lines = lineCountOf(el);
      if (lines === null) continue;

      const expectedHeight = lines * el.lineHeight;
      const excess = el.height - expectedHeight;
      if (excess < WHITESPACE_MIN_EXCESS_PX) continue;
      if (excess / el.height < WHITESPACE_EXCESS_RATIO) continue;

      const targetKey = el.dpeSection ? `section:${el.dpeSection}` : `element:${el.tag}:${el.text.slice(0, 30)}`;

      actions.push({
        page,
        action: "reduce_whitespace",
        reason: `Element (tag=${el.tag}) on page ${page} measures ${Math.round(el.height)}px tall for ${lines} real measured line(s) at ${Math.round(el.lineHeight)}px line-height (expected ~${Math.round(expectedHeight)}px) - ${Math.round(excess)}px of real excess vertical space.`,
        targetKey,
        expectedImpact: `Up to ~${Math.round(excess)}px of vertical space could be reclaimed by reducing this element's own margin/padding/line-height - an estimate from real measured geometry, not a guaranteed reduction (some excess may be legitimate paragraph spacing).`,
        priority: "low",
      });
    }
  }

  return actions;
}

/*
  Section Shift - real signal: 2+ real measured elements share the SAME
  real data-dpe-unbreakable group id (Phase 2-4 hardening's own real
  UnbreakableGroup assignment - see experienceRefinement.ts's
  assignUnbreakableGroups()) but were measured on DIFFERENT real pages.
  This means the Renderer, which does not consult this pipeline's own
  flow metadata, split a group this pipeline explicitly marked as
  "should not be split across a page break" - a genuine, disclosed
  preservation-fidelity gap, not a guess. Runs over ALL pages (not just
  ones flagged as overflowing), since a group split is a structural
  concern independent of whether the page it lands on happens to
  overflow.
*/
function buildSectionShiftActions(measurement: LayoutMeasurementResult): RelayoutAction[] {
  const actions: RelayoutAction[] = [];
  const byGroup = new Map<string, RealElementMeasurement[]>();

  for (const el of measurement.rawElements) {
    if (!el.dpeUnbreakableGroup) continue;
    if (!byGroup.has(el.dpeUnbreakableGroup)) byGroup.set(el.dpeUnbreakableGroup, []);
    byGroup.get(el.dpeUnbreakableGroup)!.push(el);
  }

  for (const [groupId, els] of byGroup) {
    const pages = new Set(els.map((el) => pageIndexForY(el.y) + 1));
    if (pages.size <= 1) continue;

    const sortedPages = Array.from(pages).sort((a, b) => a - b);
    actions.push({
      page: sortedPages[0],
      action: "shift_section",
      reason: `Unbreakable group "${groupId}" (${els.length} real measured element(s), e.g. a job title/company/date/bullets group) was measured split across pages ${sortedPages.join(", ")} - the Renderer's own CSS flow does not consult this pipeline's flow.unbreakableGroup metadata, so the split happened despite this group being marked unbreakable.`,
      targetKey: `unbreakableGroup:${groupId}`,
      expectedImpact: `Shifting this entire group to start on page ${sortedPages[sortedPages.length - 1]} (its later page) would keep it intact, at the cost of additional whitespace at the bottom of page ${sortedPages[0]}.`,
      priority: "high",
    });
  }

  return actions;
}

export function buildRelayoutPlan(
  overflow: OverflowReport,
  retryAttempts: RetryAttempt[],
  pageClonePlan: PageCloneResult,
  measurement: LayoutMeasurementResult
): RelayoutPlan {
  if (!measurement.measurable) {
    return {
      actions: [
        {
          page: 0,
          action: "no_action_needed",
          reason: `Layout not measurable (${measurement.unmeasurableReason}) - no relayout decision could be made.`,
          targetKey: null,
          expectedImpact: "None - no real measurement exists to base a decision on.",
          priority: "low",
        },
      ],
      requiredRelayout: false,
    };
  }

  const pagesWithOverflow = new Set(
    overflow.findings.filter((f) => f.verdict !== "fits").map((f) => f.page).filter((p) => p > 0)
  );

  const actions: RelayoutAction[] = [
    ...buildOverflowActions(pagesWithOverflow, retryAttempts, measurement),
    ...buildMergeParagraphActions(pagesWithOverflow, measurement),
    ...buildWhitespaceActions(pagesWithOverflow, measurement),
    ...buildSectionShiftActions(measurement),
  ];

  if (pageClonePlan.pageCloned) {
    actions.push({
      page: measurement.totalPageCount,
      action: "suggest_page_break",
      reason: `Real Renderer measurement produced ${pageClonePlan.expectedPageCount} pages (mode=${pageClonePlan.mode}) - content continues past the original page count.`,
      targetKey: null,
      expectedImpact: "Already realized - the Renderer's own pagination already placed this content on a real additional page; this action records that fact rather than proposing a new one.",
      priority: "medium",
    });
  }

  if (actions.length === 0) {
    actions.push({
      page: 0,
      action: "no_action_needed",
      reason: "No overflow, no retry attempts, no page expansion, no unbreakable-group page splits - the document fit as generated.",
      targetKey: null,
      expectedImpact: "None needed.",
      priority: "low",
    });
  }

  return { actions, requiredRelayout: actions.some((a) => a.action !== "no_action_needed") };
}
