/*
  Phase 5D.6 TASK A gate test - Generic Section Heading Orphan
  Hardening. Pure synthetic (no browser measurement, no real fixture) -
  buildPaginationPlan() is a pure function of (assembly, measurement,
  paperSize, density), so every scenario here hand-constructs both
  inputs directly, at the exact byte-for-byte arithmetic borderline that
  used to trigger the real bug (confirmed against breakPolicy.ts's own
  real policy table: education-entry/credential-entry/award-entry/
  publication-entry/custom-section all get keepTogether:
  "whole-entry-if-fits" while canSplit can independently be true when
  there are 2+ details - the exact combination
  paginationPlanner.ts's pre-check used to mis-estimate).

  Root cause (see paginationPlanner.ts's own requiresWholeBlock()
  comment): the heading pre-check used to compute the first block's
  minimum keep-together chunk from canSplit/subItems.length ALONE,
  ignoring keepTogether. A block with canSplit:true but
  keepTogether:"whole-entry-if-fits" would make the pre-check think
  only "header + first item" was needed (small), let the heading get
  placed, and then the real per-block placement loop - which DOES
  honor keepTogether - discovered it actually needed the WHOLE block
  (large), didn't fit, and moved the whole block alone to a fresh page,
  orphaning the already-placed heading. Fixed by making both the
  pre-check and the real placement loop call the exact same
  requiresWholeBlock() function, so they can never disagree again.

  Run with `npx tsx lib/documentPreservation/professionalAtsHtml/paginationOrphanHardening.test.ts`.
*/
import { buildPaginationPlan } from "./paginationPlanner";
import { DENSITY_SPACING } from "./designTokens";
import type { FlatMeasurementResult, PaperSize } from "./types";
import type {
  ProfessionalAtsAssemblyDocument,
  ProfessionalAtsAssemblySection,
  ProfessionalAtsSectionKey,
  AssemblyBlock,
  KeepTogetherPolicy,
} from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

const MM_TO_PX = 96 / 25.4;
const IN_TO_PX = 96;
function usableHeightPx(paperSize: PaperSize): number {
  const paperHeight = paperSize === "letter" ? 11 * IN_TO_PX : 297 * MM_TO_PX;
  return paperHeight - 2 * DENSITY_SPACING.comfortable.pagePaddingPx;
}

/* Same orphan definition htmlValidator.ts's own check #7 uses (heading
   on page N, its section's first non-continuation block placement on a
   different page) - re-derived here directly from the plan since this
   test never runs the real HTML/browser validator. */
function findOrphans(assembly: ProfessionalAtsAssemblyDocument, plan: ReturnType<typeof buildPaginationPlan>): ProfessionalAtsSectionKey[] {
  const orphans: ProfessionalAtsSectionKey[] = [];
  for (const headingPlacement of plan.sectionHeadingPlacements) {
    const section = assembly.sections.find((s) => s.key === headingPlacement.sectionKey);
    if (!section || section.blocks.length === 0 || !section.keepHeadingWithFirstBlock) continue;
    const firstBlockPlacement = plan.blockPlacements.find((p) => p.blockId === section.blocks[0].id && !p.isContinuation);
    if (firstBlockPlacement && firstBlockPlacement.pageIndex !== headingPlacement.pageIndex) {
      orphans.push(headingPlacement.sectionKey);
    }
  }
  return orphans;
}

function makeBlock(id: string, opts: { headerHeightPx: number; subItemHeightPx: number; subItemCount: number; keepTogether: KeepTogetherPolicy; canSplit: boolean }): {
  block: AssemblyBlock;
  measuredTotalHeightPx: number;
  measuredHeaderHeightPx: number;
  measuredSubItems: { index: number; heightPx: number }[];
} {
  const bulletGap = DENSITY_SPACING.comfortable.bulletGapPx;
  const subItems = Array.from({ length: opts.subItemCount }, (_, i) => ({ index: i, heightPx: opts.subItemHeightPx }));
  const totalHeightPx = opts.subItemCount === 0 ? opts.headerHeightPx : opts.headerHeightPx + opts.subItemCount * (opts.subItemHeightPx + bulletGap);
  return {
    block: {
      id,
      kind: "custom-section",
      sourceSectionIds: [],
      sourceBlockIds: [],
      estimatedContentUnits: 1,
      minVisibleContentUnits: 1,
      breakPolicy: "avoid",
      keepTogether: opts.keepTogether,
      canSplit: opts.canSplit,
      splitStrategy: opts.canSplit ? "between-items" : "none",
      priority: 0,
      isOptional: false,
      isUncertain: false,
      payload: null,
    },
    measuredTotalHeightPx: totalHeightPx,
    measuredHeaderHeightPx: opts.headerHeightPx,
    measuredSubItems: subItems,
  };
}

function buildScenario(
  sectionKey: ProfessionalAtsSectionKey,
  paperSize: PaperSize,
  keepTogether: KeepTogetherPolicy,
  canSplit: boolean,
  subItemCount: number,
  fillerHeightPx: number
): { assembly: ProfessionalAtsAssemblyDocument; measurement: FlatMeasurementResult } {
  const headingHeightPx = 24;
  const fillerBlockDef = makeBlock("filler-block", { headerHeightPx: fillerHeightPx, subItemHeightPx: 0, subItemCount: 0, keepTogether: "whole-block", canSplit: false });
  const targetBlockDef = makeBlock(`${sectionKey}-block-0`, { headerHeightPx: 30, subItemHeightPx: 20, subItemCount, keepTogether, canSplit });

  const fillerSection: ProfessionalAtsAssemblySection = {
    key: "identity",
    label: null,
    order: 0,
    visible: true,
    visibilityReason: "has-content",
    blocks: [fillerBlockDef.block],
    keepHeadingWithFirstBlock: false,
    breakBefore: "allow",
    breakAfter: "allow",
    minBlocksToShow: 1,
    sourceSectionIds: [],
  };

  const targetSection: ProfessionalAtsAssemblySection = {
    key: sectionKey,
    label: sectionKey,
    order: 1,
    visible: true,
    visibilityReason: "has-content",
    blocks: [targetBlockDef.block],
    keepHeadingWithFirstBlock: true,
    breakBefore: "allow",
    breakAfter: "allow",
    minBlocksToShow: 1,
    sourceSectionIds: [],
  };

  const assembly: ProfessionalAtsAssemblyDocument = {
    schemaVersion: "test",
    templateId: "professional-ats-v1",
    sourceModelVersion: "test",
    sections: [fillerSection, targetSection],
    visibleSectionKeys: ["identity", sectionKey],
    hiddenSectionKeys: [],
    defaultDensity: "comfortable",
    compactionPolicy: {
      allowedDensities: ["comfortable"],
      canReduceSectionSpacing: true,
      canReduceEntrySpacing: true,
      canReduceBulletSpacing: true,
      canTightenSkillLayout: true,
      canTrimContent: false,
      canDropSections: false,
      canDropEntries: false,
      canDropBullets: false,
    },
    validation: {
      passed: true,
      visibleSectionKeys: ["identity", sectionKey],
      hiddenSectionKeys: [],
      orderViolations: [],
      volunteerPlacementViolations: [],
      missingEntryIds: [],
      duplicateEntryIds: [],
      invalidHiddenSectionsWithBlocks: [],
      destructiveCompactionFlags: [],
      warnings: [],
    },
  };

  const measurement: FlatMeasurementResult = {
    measurable: true,
    measurementErrors: [],
    contentWidthPx: 600,
    sectionHeadings: [{ sectionKey, heightPx: headingHeightPx }],
    blocks: [
      { blockId: "filler-block", totalHeightPx: fillerBlockDef.measuredTotalHeightPx, headerHeightPx: fillerBlockDef.measuredHeaderHeightPx, subItems: fillerBlockDef.measuredSubItems },
      { blockId: `${sectionKey}-block-0`, totalHeightPx: targetBlockDef.measuredTotalHeightPx, headerHeightPx: targetBlockDef.measuredHeaderHeightPx, subItems: targetBlockDef.measuredSubItems },
    ],
  };

  return { assembly, measurement };
}

/*
  The borderline-repro filler height: lands cursor.remainingPx right
  before the target section at R, chosen so the OLD (pre-fix) pre-check
  - which estimated the first block's chunk from canSplit/subItems
  alone, ignoring keepTogether - would have judged "fits" (using the
  smaller header+first-item estimate) while the real per-block
  placement loop (honoring keepTogether:"whole-entry-if-fits") would
  have required the full, larger block height and moved it alone to a
  fresh page. See this file's own header comment for the full derived
  numbers (R=130 for the canonical 3-subitem/24px-heading case).
*/
function wholeEntryIfFitsMismatchFiller(paperSize: PaperSize): number {
  const tokens = DENSITY_SPACING.comfortable;
  const headingTotalSpace = 24 + tokens.headingMarginBottomPx;
  const chunkPartial = 30 + tokens.bulletGapPx + 20; // OLD estimate: header + first sub-item
  const chunkWhole = 30 + 3 * (20 + tokens.bulletGapPx); // NEW/real requirement: whole block (3 sub-items)
  // R strictly between old-estimate-needed and new/real-needed - reproduces
  // the historical mismatch window for any density/paper-size combination.
  const oldNeeded = tokens.sectionGapPx + headingTotalSpace + chunkPartial;
  const newNeeded = tokens.sectionGapPx + headingTotalSpace + chunkWhole;
  const R = Math.round((oldNeeded + newNeeded) / 2);
  return usableHeightPx(paperSize) - R;
}

const REQUIRED_SECTION_KEYS: ProfessionalAtsSectionKey[] = [
  "professional_experience",
  "volunteer_experience",
  "education",
  "certifications_licenses",
  "projects",
  "awards",
  "publications",
  "metric_highlights",
  "additional_information",
  "core_skills",
  "professional_summary",
];

for (const paperSize of ["letter", "a4"] as PaperSize[]) {
  for (const sectionKey of REQUIRED_SECTION_KEYS) {
    const filler = wholeEntryIfFitsMismatchFiller(paperSize);
    const { assembly, measurement } = buildScenario(sectionKey, paperSize, "whole-entry-if-fits", true, 3, filler);
    const plan = buildPaginationPlan(assembly, measurement, paperSize, "comfortable");
    const orphans = findOrphans(assembly, plan);
    checkTrue(`${sectionKey}/${paperSize}: whole-entry-if-fits mismatch scenario produces zero heading orphans`, orphans.length === 0);
    checkTrue(
      `${sectionKey}/${paperSize}: target block still fully placed (content never dropped)`,
      plan.blockPlacements.some((p) => p.blockId === `${sectionKey}-block-0`)
    );
  }
}

// --- Additional variety beyond the whole-entry-if-fits mismatch: entry-header-with-first-content split-branch alignment ---
for (const paperSize of ["letter", "a4"] as PaperSize[]) {
  const tokens = DENSITY_SPACING.comfortable;
  const headingTotalSpace = 24 + tokens.headingMarginBottomPx;
  const chunk = 30 + tokens.bulletGapPx + 20; // entry-header-with-first-content: header + first item only
  const R = tokens.sectionGapPx + headingTotalSpace + chunk + 1; // just enough room
  const filler = usableHeightPx(paperSize) - R;
  const { assembly, measurement } = buildScenario("professional_experience", paperSize, "entry-header-with-first-content", true, 5, filler);
  const plan = buildPaginationPlan(assembly, measurement, paperSize, "comfortable");
  const orphans = findOrphans(assembly, plan);
  checkTrue(`experience-split-alignment/${paperSize}: entry-header-with-first-content borderline fit produces zero orphans`, orphans.length === 0);
  const firstFragment = plan.blockPlacements.find((p) => p.blockId === "professional_experience-block-0" && !p.isContinuation);
  checkTrue(`experience-split-alignment/${paperSize}: first fragment starts at sub-item 0`, firstFragment?.subRange?.startIndex === 0);
}

// --- whole-block (identity/skill-group/summary-style) borderline: no sub-items at all ---
for (const paperSize of ["letter", "a4"] as PaperSize[]) {
  const tokens = DENSITY_SPACING.comfortable;
  const headingTotalSpace = 24 + tokens.headingMarginBottomPx;
  const chunk = 40; // whole-block, header-only height (no sub-items)
  const R = tokens.sectionGapPx + headingTotalSpace + chunk - 1; // just short - must move together
  const filler = usableHeightPx(paperSize) - R;
  const { assembly, measurement } = buildScenario("core_skills", paperSize, "whole-block", false, 0, filler);
  const plan = buildPaginationPlan(assembly, measurement, paperSize, "comfortable");
  const orphans = findOrphans(assembly, plan);
  checkTrue(`whole-block-borderline/${paperSize}: heading and block move together to a fresh page, zero orphans`, orphans.length === 0);
}

// --- Positive control: heading + block comfortably fit together with room to spare ---
for (const paperSize of ["letter", "a4"] as PaperSize[]) {
  const { assembly, measurement } = buildScenario("awards", paperSize, "whole-entry-if-fits", true, 2, 100);
  const plan = buildPaginationPlan(assembly, measurement, paperSize, "comfortable");
  const orphans = findOrphans(assembly, plan);
  checkTrue(`comfortable-fit/${paperSize}: heading + block on the same page when there is ample room`, orphans.length === 0);
  const headingPage = plan.sectionHeadingPlacements.find((p) => p.sectionKey === "awards")?.pageIndex;
  const blockPage = plan.blockPlacements.find((p) => p.blockId === "awards-block-0")?.pageIndex;
  check(`comfortable-fit/${paperSize}: both land on page 0`, [headingPage, blockPage], [0, 0]);
}

// --- Large-but-fits control: a big single-fragment block (much larger than a
// typical entry, but still smaller than one entire empty page) that clearly
// cannot share the current tight remaining space with its heading - still
// must move together with the heading to a fresh page, never orphaned.
// (A block literally taller than one whole empty page is a separate,
// pre-existing, physically-unavoidable edge case - verified unchanged by
// this fix via a temporary before/after comparison - and is intentionally
// out of scope here.)
for (const paperSize of ["letter", "a4"] as PaperSize[]) {
  const { assembly, measurement } = buildScenario("publications", paperSize, "whole-entry-if-fits", false, 0, 900);
  const largeButFitsHeightPx = usableHeightPx(paperSize) - 100;
  measurement.blocks[1].totalHeightPx = largeButFitsHeightPx;
  measurement.blocks[1].headerHeightPx = largeButFitsHeightPx;
  const plan = buildPaginationPlan(assembly, measurement, paperSize, "comfortable");
  const orphans = findOrphans(assembly, plan);
  checkTrue(`large-but-fits-block/${paperSize}: still zero heading orphans for a large single-fragment block that fits on a fresh page`, orphans.length === 0);
  checkTrue(
    `large-but-fits-block/${paperSize}: block still placed (never silently dropped)`,
    plan.blockPlacements.some((p) => p.blockId === "publications-block-0")
  );
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
