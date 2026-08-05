/*
  Professional ATS DOCX Renderer - Phase 5B feasibility gate. Consumes
  Phase 3's ProfessionalAtsAssemblyDocument directly (same visibility/
  order/labels/payload Phase 4's HTML and Phase 5A's PDF already
  consume) and produces real editable OOXML DOCX bytes via the `docx`
  npm package - no HTML/PDF DOM is embedded or screenshotted. This
  module does NOT touch Phase 4's HTML renderer or Phase 5A's PDF
  renderer, does NOT connect to Career Memory/Generate Package/Job
  Tracker/Save Package, and does NOT touch the existing jsPDF/docx-
  based production download paths.
*/
import type { PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";

/* --- Source mapping (per generated paragraph) --- */

export type DocxSourceMapping = {
  sourceBlockId: string;
  sourceEntryId?: string;
  paragraphIndexes: number[];
};

/* --- Structural validation (spec section 15) --- */

export type DocxPageSizeResult = {
  widthTwips: number;
  heightTwips: number;
  orientation: "portrait" | "landscape";
};

export type DocxStructuralValidationResult = {
  validZipHeader: boolean;
  parseableZip: boolean;
  requiredPartsPresent: boolean;
  missingParts: string[];
  parseableXml: boolean;
  macroFree: boolean;
  encrypted: boolean;
  externalRelationships: string[];
  pageSize: DocxPageSizeResult;
};

/* --- Text preservation (spec section 16) --- */

export type DocxTextValidationResult = {
  expectedFragmentCount: number;
  foundFragmentCount: number;
  missingFragments: string[];
  inventedFragments: string[];
  duplicateEntryIds: string[];
};

/* --- Pagination intent (spec section 12/24) --- */

export type DocxPaginationIntentResult = {
  headingsWithKeepNext: number;
  entryHeadersWithKeepNext: number;
  bulletsWithKeepLines: number;
  violations: string[];
};

/* --- HTML/PDF/DOCX content parity (spec section 19 - content only, no page-count parity) --- */

export type DocxParityValidationResult = {
  sameVisibleSections: boolean;
  sameSectionOrder: boolean;
  sameEntryOrder: boolean;
  sameProtectedFacts: boolean;
  sourceCoveragePercent: number;
};

export type ProfessionalAtsDocxValidationReport = {
  passed: boolean;
  structural: DocxStructuralValidationResult;
  text: DocxTextValidationResult;
  paginationIntent: DocxPaginationIntentResult;
  parity: DocxParityValidationResult;
  warnings: string[];
};

/* --- Top-level result --- */

export type ProfessionalAtsDocxStructureSummary = {
  paragraphCount: number;
  textRunCount: number;
  bulletCount: number;
  sectionCount: number;
};

export type ProfessionalAtsDocxResult = {
  templateId: "professional-ats-v1";
  paperSize: PaperSize;
  density: AssemblyDensity;

  fileName: string;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;

  structure: ProfessionalAtsDocxStructureSummary;
  sourceMapping: DocxSourceMapping[];

  validation: ProfessionalAtsDocxValidationReport;
};
