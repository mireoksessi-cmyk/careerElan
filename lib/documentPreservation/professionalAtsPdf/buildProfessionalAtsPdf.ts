/*
  TASK 4-7 orchestrator - ties Phase 5A together into one
  ProfessionalAtsPdfResult. Mirrors Phase 4's own
  buildProfessionalAtsHtmlPreview orchestrator pattern: thin
  composition, no new decision logic. Requires the Phase 4 HTML
  preview to have already PASSED validation - Phase 5A's whole design
  is "confirmed-good HTML to PDF", not a second, independent place to
  re-decide pagination/section-order/visibility (see this module's own
  header note in the Phase 5A pre-implementation report, section 4/10).
  Calling this on an assembly+paperSize combination whose Phase 4
  validation did not pass is a precondition violation, not a normal
  PDF-generation failure mode, so it throws rather than returning a
  "failed" result.
*/
import { createHash } from "node:crypto";
import { buildProfessionalAtsHtmlPreview } from "../professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import { renderProfessionalAtsPdf } from "./pdfRenderer";
import { validatePdfStructure } from "./pdfStructuralValidator";
import { extractPdfPageText } from "./pdfTextExtraction";
import { validatePdfTextPreservation } from "./pdfTextPreservationValidator";
import { validatePdfParity } from "./pdfParityValidator";
import { buildSourcePagePlan } from "./sourceMapping";
import { buildPdfFileName } from "./fileName";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { ProfessionalAtsPdfResult } from "./types";

function extractApplicantName(assembly: ProfessionalAtsAssemblyDocument): string | null {
  const identitySection = assembly.sections.find((s) => s.key === "identity");
  const identityBlock = identitySection?.blocks[0];
  if (!identityBlock) return null;
  const payload = identityBlock.payload as { fullName?: { value?: string } };
  return payload.fullName?.value ?? null;
}

export async function buildProfessionalAtsPdf(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize
): Promise<ProfessionalAtsPdfResult> {
  const htmlPreview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);
  if (!htmlPreview.validation.passed) {
    throw new Error(
      `buildProfessionalAtsPdf: Phase 4 HTML validation did not pass for this assembly+${paperSize} - PDF generation requires a validated HTML plan as its precondition. Validation report: ${JSON.stringify(htmlPreview.validation)}`
    );
  }

  const { plan } = htmlPreview;
  const bytes = await renderProfessionalAtsPdf(assembly, plan, paperSize, plan.density);

  const structural = await validatePdfStructure(bytes);
  const pdfPages = structural.parseable ? await extractPdfPageText(bytes) : [];
  const text = validatePdfTextPreservation(assembly, plan, pdfPages);
  const sourcePagePlan = buildSourcePagePlan(plan);
  const parity = validatePdfParity(assembly, plan, plan.density, pdfPages, sourcePagePlan);

  const passed =
    structural.validHeader &&
    structural.parseable &&
    !structural.encrypted &&
    structural.pageCount >= 1 &&
    structural.blankPages.length === 0 &&
    text.missingFragments.length === 0 &&
    text.inventedFragments.length === 0 &&
    text.duplicateEntryIds.length === 0 &&
    parity.htmlPageCount === parity.pdfPageCount &&
    parity.sameDensity &&
    parity.sameSectionOrder &&
    parity.sourceCoveragePercent === 100;

  const applicantName = extractApplicantName(assembly);
  const fileName = buildPdfFileName(applicantName, paperSize, "professional-ats-v1");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    templateId: "professional-ats-v1",
    paperSize,
    density: plan.density,
    fileName,
    bytes,
    byteLength: bytes.byteLength,
    sha256,
    pageCount: structural.pageCount,
    sourcePagePlan,
    validation: {
      passed,
      structural,
      text,
      parity,
      warnings: [],
    },
  };
}
