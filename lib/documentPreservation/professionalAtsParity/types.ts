/*
  Professional ATS Cross-Format Parity Engine - Phase 5C feasibility
  gate. Pure validation layer: no new renderer, no new template. Reuses
  Phase 4 HTML/Phase 5A PDF/Phase 5B DOCX orchestrators and validators
  as-is (see the pre-implementation report's audit) and compares their
  outputs against a single renderer-independent CanonicalParityManifest
  derived directly from Phase 3's ProfessionalAtsAssemblyDocument - not
  from any renderer's output, and not from HTML treated as a de facto
  reference (that would let identical upstream loss in all three
  formats silently pass every pairwise comparison).
*/
import type { PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

/* --- Canonical Parity Manifest (spec section 4) --- */

export type ParityFragmentKind =
  | "section-label"
  | "identity"
  | "contact"
  | "summary"
  | "skill"
  | "organization"
  | "role"
  | "location"
  | "date"
  | "bullet"
  | "education"
  | "credential"
  | "project"
  | "award"
  | "publication"
  | "custom"
  | "metric";

export type ParityFragmentOccurrence = "exactly-once" | "at-least-once" | "ordered";

export type ParityFragment = {
  id: string;
  kind: ParityFragmentKind;

  value: string;
  sectionKey?: ProfessionalAtsSectionKey;
  entryId?: string;
  sourceBlockIds: string[];

  required: boolean;
  occurrence: ParityFragmentOccurrence;
};

export type CanonicalParitySectionEntry = {
  key: ProfessionalAtsSectionKey;
  label: string | null;
  order: number;
};

export type CanonicalParityEntry = {
  entryId: string;
  sectionKey: ProfessionalAtsSectionKey;
  order: number;

  organization?: string;
  role?: string;
  location?: string;
  date?: string;

  paragraphs: string[];
  bullets: string[];

  sourceBlockIds: string[];
  protectedFacts: string[];
};

export type CanonicalParityManifest = {
  schemaVersion: string;
  templateId: "professional-ats-v1";

  paperSize: PaperSize;
  density: AssemblyDensity;

  visibleSections: CanonicalParitySectionEntry[];
  hiddenSections: ProfessionalAtsSectionKey[];

  entries: CanonicalParityEntry[];

  identity: {
    name?: string;
    headline?: string;
    contactFragments: string[];
  };

  expectedTextFragments: ParityFragment[];
};

/* --- Format adapter output (spec section 5) --- */

export type FormatName = "html" | "pdf" | "docx";

export type NormalizedFragment = {
  fragmentId: string;
  value: string;
  index: number;
};

export type NormalizedFormatSnapshot = {
  format: FormatName;

  normalizedText: string;
  orderedFragments: NormalizedFragment[];

  visibleSections: ProfessionalAtsSectionKey[];
  sectionLabels: string[];
  entryIds: string[];

  paperSize: PaperSize;
  density: AssemblyDensity;

  sourceEntryIds: string[];
  sourceBlockIds: string[];

  structureWarnings: string[];

  /* Page count is format-specific and not part of the required parity
     contract (DOCX page count is explicitly not compared - spec
     section 3/12) but is carried through for the report/diagnostics. */
  pageCount?: number;
};

/* --- Cross-format validation report (spec section 13) --- */

export type ParityReasonCode =
  | "MISSING_FRAGMENT"
  | "INVENTED_FRAGMENT"
  | "DUPLICATE_ENTRY"
  | "SECTION_ORDER_VIOLATION"
  | "ENTRY_ORDER_VIOLATION"
  | "BULLET_ORDER_VIOLATION"
  | "PROTECTED_FACT_CHANGED"
  | "HIDDEN_SECTION_RENDERED"
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "PAPER_SIZE_MISMATCH"
  | "DENSITY_MISMATCH";

export type ParityMismatch = {
  reasonCode: ParityReasonCode;
  format: FormatName | "pairwise";
  sectionKey?: ProfessionalAtsSectionKey;
  entryId?: string;
  fragmentId?: string;
  expected?: string;
  actual?: string;
  detail: string;
};

export type FormatParityResult = {
  format: FormatName;
  passed: boolean;

  missingFragments: ParityMismatch[];
  inventedFragments: ParityMismatch[];
  duplicateEntries: ParityMismatch[];
  sectionOrderViolations: ParityMismatch[];
  entryOrderViolations: ParityMismatch[];
  bulletOrderViolations: ParityMismatch[];
  protectedFactViolations: ParityMismatch[];
  hiddenSectionViolations: ParityMismatch[];
  /* SOURCE_COVERAGE_INCOMPLETE / PAPER_SIZE_MISMATCH / DENSITY_MISMATCH -
     policy-level mismatches that aren't about a specific text fragment. */
  policyViolations: ParityMismatch[];

  sourceCoveragePercent: number;
  paperSizeMatches: boolean;
  densityMatches: boolean;
};

export type PairwiseParityResult = {
  formatA: FormatName;
  formatB: FormatName;
  sameVisibleSections: boolean;
  sameSectionOrder: boolean;
  sameEntryOrder: boolean;
  mismatches: ParityMismatch[];
};

export type CrossFormatParityReport = {
  passed: boolean;

  manifest: {
    fragmentCount: number;
    sectionCount: number;
    entryCount: number;
    sourceCoveragePercent: number;
  };

  formats: {
    html: FormatParityResult;
    pdf: FormatParityResult;
    docx: FormatParityResult;
  };

  pairwise: {
    htmlVsPdf: PairwiseParityResult;
    htmlVsDocx: PairwiseParityResult;
    pdfVsDocx: PairwiseParityResult;
  };

  sections: {
    expected: ProfessionalAtsSectionKey[];
    html: ProfessionalAtsSectionKey[];
    pdf: ProfessionalAtsSectionKey[];
    docx: ProfessionalAtsSectionKey[];
    mismatches: string[];
  };

  entries: {
    expectedIds: string[];
    missingByFormat: Record<FormatName, string[]>;
    duplicateByFormat: Record<FormatName, string[]>;
    orderViolationsByFormat: Record<FormatName, string[]>;
  };

  facts: {
    missing: ParityMismatch[];
    changed: ParityMismatch[];
    invented: ParityMismatch[];
  };

  bullets: {
    missing: ParityMismatch[];
    duplicated: ParityMismatch[];
    reordered: ParityMismatch[];
  };

  layoutPolicy: {
    samePaperSize: boolean;
    sameDensity: boolean;
    htmlPdfPageParity: boolean;
    docxPageParityRequired: false;
  };

  warnings: string[];
};
