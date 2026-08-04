/*
  Professional ATS PDF Renderer - Phase 5A feasibility gate. Consumes
  Phase 4's ProfessionalAtsHtmlPreviewDocument (already-validated HTML
  plan/measurement for one assembly+paperSize) and produces real PDF
  bytes via Playwright's page.pdf() over the SAME paginated HTML Phase
  4 already builds - no independent layout/pagination logic. This
  module does NOT export DOCX, does NOT connect to Career Memory/
  Generate Package/Job Tracker/Save Package, and does NOT touch the
  existing jsPDF-based production download paths.
*/
import type { PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";

/* --- Source mapping (Phase 4's own PaginationPlan, projected per PDF page) --- */

export type PdfSourcePage = {
  pageIndex: number;
  sourceBlockIds: string[];
  sourceEntryIds: string[];
};

/* --- Structural validation (spec section 10) --- */

export type PdfMediaBox = {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
};

export type PdfStructuralValidationResult = {
  validHeader: boolean;
  parseable: boolean;
  parseError: string | null;
  encrypted: boolean;
  pageCount: number;
  blankPages: number[];
  mediaBoxes: PdfMediaBox[];
};

/* --- Text preservation (spec section 9) --- */

export type PdfTextValidationResult = {
  expectedFragmentCount: number;
  foundFragmentCount: number;
  missingFragments: string[];
  inventedFragments: string[];
  duplicateEntryIds: string[];
};

/* --- HTML/PDF parity (spec section 5/12) --- */

export type PdfParityValidationResult = {
  htmlPageCount: number;
  pdfPageCount: number;
  sameDensity: boolean;
  sameSectionOrder: boolean;
  sourceCoveragePercent: number;
};

export type ProfessionalAtsPdfValidationReport = {
  passed: boolean;
  structural: PdfStructuralValidationResult;
  text: PdfTextValidationResult;
  parity: PdfParityValidationResult;
  warnings: string[];
};

/* --- Top-level result --- */

export type ProfessionalAtsPdfResult = {
  templateId: "professional-ats-v1";
  paperSize: PaperSize;
  density: AssemblyDensity;

  fileName: string;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;

  pageCount: number;
  sourcePagePlan: PdfSourcePage[];

  validation: ProfessionalAtsPdfValidationReport;
};
