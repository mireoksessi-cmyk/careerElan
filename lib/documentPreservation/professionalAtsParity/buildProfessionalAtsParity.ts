/*
  TASK 6 - Top-level Phase 5C orchestrator. Mirrors Phase 3/4/5A/5B's
  own thin-composition orchestrator pattern: builds the canonical
  manifest, generates HTML/PDF/DOCX from the SAME assembly, converts
  each to a NormalizedFormatSnapshot, and produces the
  CrossFormatParityReport. No new decision logic of its own.

  Density: HTML is auto-fit (Phase 4's own policy, unchanged); PDF
  inherits HTML's chosen density by construction (Phase 5A's own
  precondition, unchanged - buildProfessionalAtsPdf() calls
  buildProfessionalAtsHtmlPreview() internally itself). DOCX is
  explicitly given the SAME density HTML/PDF converged on, so density
  parity holds by construction, not just by comparison - the
  layoutPolicy.sameDensity field in the report is then a regression-
  safety-net check, not the primary guarantee.
*/
import { buildHtmlSnapshot } from "./htmlFormatAdapter";
import { buildPdfSnapshot } from "./pdfFormatAdapter";
import { buildDocxSnapshot } from "./docxFormatAdapter";
import { buildCanonicalParityManifest } from "./canonicalParityManifest";
import { buildCrossFormatParityReport } from "./crossFormatParityValidator";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { CrossFormatParityReport } from "./types";

export type ProfessionalAtsParityResult = {
  report: CrossFormatParityReport;
  htmlPageCount: number;
  pdfPageCount: number;
  pdfByteLength: number;
  docxByteLength: number;
  docxFileName: string;
  pdfFileName: string;
};

export async function buildProfessionalAtsParity(assembly: ProfessionalAtsAssemblyDocument, paperSize: PaperSize): Promise<ProfessionalAtsParityResult> {
  const { snapshot: htmlSnapshot, htmlPreview } = await buildHtmlSnapshot(assembly, paperSize);
  const { snapshot: pdfSnapshot, pdfResult } = await buildPdfSnapshot(assembly, paperSize);
  const { snapshot: docxSnapshot, docxResult } = await buildDocxSnapshot(assembly, paperSize, htmlPreview.plan.density);

  const manifest = buildCanonicalParityManifest(assembly, paperSize, htmlPreview.plan.density);
  const report = buildCrossFormatParityReport(manifest, htmlSnapshot, pdfSnapshot, docxSnapshot);

  return {
    report,
    htmlPageCount: htmlPreview.plan.pageCount,
    pdfPageCount: pdfResult.pageCount,
    pdfByteLength: pdfResult.byteLength,
    docxByteLength: docxResult.byteLength,
    docxFileName: docxResult.fileName,
    pdfFileName: pdfResult.fileName,
  };
}
