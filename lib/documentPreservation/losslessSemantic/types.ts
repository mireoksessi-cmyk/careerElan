/*
  Lossless Resume Semantic Engine - Phase 1 feasibility gate. Dev-only
  side path, not wired into any production route/worker (see this
  module's own README-equivalent in the final report). Sits alongside
  lib/documentPreservation/{layoutAnalysis,contentBox} rather than
  replacing them - this module only CONSUMES their output
  (DocumentLayerModel / ContentBox), it does not reparse PDF/DOCX itself.

  Core invariant this whole module exists to protect: every source text
  element must end up in EXACTLY ONE of identityBlocks / a section's
  blocks / unassignedBlocks - never dropped, never duplicated, never
  rewritten. See validator.ts for the engine that checks this.
*/

/*
  17 known types plus "custom" - a superset of lib/brand/types.ts's
  9-key SectionKey (that type is scoped to AI-generated-text parsing;
  this module needs a wider vocabulary per this phase's own alias
  dictionary spec, section 7). Deliberately NOT reusing SectionKey
  directly - extending a shared enum silently changes AI-facing behavior
  elsewhere, which is out of scope this round.
*/
export type SemanticSectionType =
  | "summary"
  | "objective"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "awards"
  | "licenses"
  | "certifications"
  | "volunteering"
  | "publications"
  | "training"
  | "professional_development"
  | "affiliations"
  | "languages"
  | "interests"
  | "references"
  | "custom";

export type ClassificationMethod = "dictionary" | "content-rule" | "context-rule" | "fallback";

export type SemanticBlockType =
  | "heading"
  | "paragraph"
  | "bullet"
  | "entry-header"
  | "metadata"
  | "unknown";

export type SemanticBlockStyle = {
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  alignment?: string;
  bullet?: boolean;
};

export type SemanticBlockBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SemanticContentBlock = {
  /*
    Deterministic, derived from the source ContentBox id (itself already
    deterministic - "{prefix}-p{page}-b{index}", never random) plus this
    block's position among its section/unassigned bucket. Never a UUID or
    Date.now()-based id - required for TASK 6's determinism gate.
  */
  id: string;
  /*
    Deterministic ids for every underlying ElementMetadata this block
    groups, synthesized as "{page}-el{indexWithinPage}" by
    blockAdapter.ts (ElementMetadata itself carries no id - see that
    file's own comment for exactly how identity is tracked via a
    WeakMap<ElementMetadata, string> built once from
    LayoutAnalysisResult.pages, before any ContentBox grouping happens).
  */
  sourceElementIds: string[];

  /* Normalized-whitespace text, used for section-boundary/classification
     signals. Never rewritten by this module past whitespace collapsing -
     see blockAdapter.ts. */
  text: string;
  /* The exact text as the underlying ContentBox/ElementMetadata reported
     it, byte-for-byte before any whitespace normalization. This is the
     field validator.ts's text-preservation check (§11-B) compares
     against the original layout analysis output. */
  rawText: string;

  pageIndex: number;
  /* Position among ALL blocks on this page, in the same deterministic
     (y, x) order the underlying ContentBox generator already produced -
     never re-sorted by this module. */
  sourceOrder: number;

  bbox?: SemanticBlockBBox;
  style?: SemanticBlockStyle;

  blockType: SemanticBlockType;
};

export type LosslessResumeSection = {
  id: string;

  /* Verbatim heading text as found in the source document. Never
     overwritten, never normalized, never null-if-not-null. Null only
     when no heading text exists at all for this section (a no-heading
     custom section - section 16 of the spec). */
  originalHeading: string | null;
  /* trim/lowercase/unicode-normalize/punctuation-clean version of
     originalHeading, used ONLY for alias dictionary matching - never
     displayed, never fed back into originalHeading. */
  normalizedHeading: string | null;

  normalizedType: SemanticSectionType;
  /* What should be shown to a user/consumer of this section - defaults
     to originalHeading verbatim this round (section 3's own
     instruction: "이번 라운드에서는 displayHeading을 임의 표준화하지
     말고 기본적으로 originalHeading을 사용한다"). */
  displayHeading: string | null;

  sourceOrder: number;
  startPageIndex: number;
  endPageIndex: number;

  confidence: number;
  classificationMethod: ClassificationMethod;
  reasonCodes: string[];

  blocks: SemanticContentBlock[];

  /* Concatenation of blocks[].rawText in sourceOrder, joined by "\n" -
     the section-level rawText preservation check target. */
  rawText: string;

  isUncertain: boolean;
};

export type LosslessValidationReport = {
  passed: boolean;

  sourceElementCount: number;
  representedElementCount: number;

  missingElementIds: string[];
  duplicateElementIds: string[];

  missingTextSpans: string[];
  inventedTextSpans: string[];

  orderViolations: Array<{
    beforeId: string;
    afterId: string;
  }>;

  warnings: string[];
};

export type LosslessResumeDocument = {
  schemaVersion: string;

  source: {
    fileName: string;
    fileType: "pdf" | "docx";
    pageCount?: number;
  };

  identityBlocks: SemanticContentBlock[];
  sections: LosslessResumeSection[];

  unassignedBlocks: SemanticContentBlock[];

  validation: LosslessValidationReport;
};
