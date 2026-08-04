/*
  Professional ATS HTML Preview - Phase 4 feasibility gate. Consumes
  Phase 3's ProfessionalAtsAssemblyDocument and renders it to real HTML,
  measured in a real headless browser, and paginated for Letter/A4
  print output. This module does NOT export PDF/DOCX, does NOT connect
  to Career Memory/Generate Package/Job Tracker/Save Package, and does
  NOT touch the existing production download paths.

  Design note on why block-level content heights are measured only
  ONCE (at "comfortable" density) rather than re-measured per density
  step: per spec section 5, density steps are only allowed to change
  spacing (page padding, section/entry/bullet gaps, line-height) - never
  font-size or content. Since content width and font-size never change
  across density levels, a block's own internal wrapped-text height is
  constant across every density level; only the GAPS between blocks
  change. paginationPlanner.ts exploits this: one flat measurement pass
  produces per-block/per-subitem content heights, and the packer tries
  each density's gap constants purely in TypeScript, only triggering a
  real-browser re-render+re-measure to VERIFY a candidate plan has zero
  overflow (guards against CSS gap rounding, not a re-measurement of
  content itself).
*/
import type { AssemblyDensity, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

export type PaperSize = "letter" | "a4";

/* --- Measurement (real browser, real pixels) --- */

export type MeasuredSubItem = {
  index: number;
  heightPx: number;
};

export type MeasuredBlock = {
  blockId: string;
  /* Full natural height of the block's own content, unpaginated. */
  totalHeightPx: number;
  /* Height of just the block's "header" portion (e.g. an experience
     entry's organization/role/date line, before its first bullet) -
     used to enforce keepTogether's "header stays with first item"
     rule. Equals totalHeightPx for blocks with no separately
     measurable header (identity, summary, skill-group). */
  headerHeightPx: number;
  /* Per-bullet/per-paragraph/per-detail heights, in source order.
     Empty for blocks whose canSplit is false. */
  subItems: MeasuredSubItem[];
};

export type MeasuredSectionHeading = {
  sectionKey: ProfessionalAtsSectionKey;
  heightPx: number;
};

export type FlatMeasurementResult = {
  measurable: boolean;
  measurementErrors: string[];
  contentWidthPx: number;
  sectionHeadings: MeasuredSectionHeading[];
  blocks: MeasuredBlock[];
};

export type PageVerificationResult = {
  pageIndex: number;
  contentHeightPx: number;
  contentMaxHeightPx: number;
  overflowPx: number;
  clipped: boolean;
};

export type PageVerificationSummary = {
  measurable: boolean;
  measurementErrors: string[];
  pageWidthPx: number;
  pageHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  pages: PageVerificationResult[];
  overflowDetected: boolean;
};

/* --- Pagination plan (pure, computed from real measurements) --- */

export type BlockPlacement = {
  pageIndex: number;
  sectionKey: ProfessionalAtsSectionKey;
  blockId: string;
  /* Present only when this placement is a fragment of a block split
     across pages - the inclusive sub-item index range rendered on THIS
     page. Absent means the whole block renders on this page. */
  subRange?: { startIndex: number; endIndex: number };
  isContinuation: boolean;
};

export type SectionHeadingPlacement = {
  pageIndex: number;
  sectionKey: ProfessionalAtsSectionKey;
};

export type PaginationPlan = {
  density: AssemblyDensity;
  pageCount: number;
  sectionHeadingPlacements: SectionHeadingPlacement[];
  blockPlacements: BlockPlacement[];
};

/* --- Final validation (spec section 12, checks A-R) --- */

export type ProfessionalAtsHtmlValidationReport = {
  passed: boolean;

  missingTextFragments: string[];
  inventedTextFragments: string[];
  duplicateTextFragments: string[];

  sectionOrderViolations: string[];
  hiddenSectionDomCount: number;
  emptyHeadingCount: number;

  overflowPageIndices: number[];
  sectionHeadingOrphans: ProfessionalAtsSectionKey[];
  entryHeaderOrphans: string[];
  invalidSplitBoundaries: string[];

  densityUsed: AssemblyDensity;
  destructiveCompactionFlags: string[];

  domOrderMatchesReadingOrder: boolean;

  warnings: string[];
};

export type ProfessionalAtsHtmlPreviewDocument = {
  schemaVersion: string;
  templateId: "professional-ats-v1";
  sourceModelVersion: string;
  paperSize: PaperSize;

  plan: PaginationPlan;
  measurement: PageVerificationSummary;
  validation: ProfessionalAtsHtmlValidationReport;

  /* Diagnostic history of density fallback attempts, in order tried -
     e.g. ["comfortable", "balanced"] if comfortable overflowed and
     balanced succeeded. Always non-empty; last entry equals
     plan.density. */
  densityFallbackHistory: AssemblyDensity[];
};
