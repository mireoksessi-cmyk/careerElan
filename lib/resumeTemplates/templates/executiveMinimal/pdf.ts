/*
  Phase 6F - Template 3 PDF renderer. Reuses this round's own shared
  HTML->PDF technique (renderHtmlToPdfBytes, real Playwright
  page.pdf() over the SAME already-paginated HTML the HTML renderer
  produces - no independent layout decision here) and re-parses the
  produced bytes for validation via the shared parity engine, exactly
  mirroring how the existing professionalAtsPdf module treats its own
  Phase 4 HTML preview as its precondition.
*/
import { renderExecutiveMinimalHtml } from "./html";
import { renderHtmlToPdfBytes } from "../../pdf/renderHtmlToPdf";
import { extractPdf } from "../../parity/pdfExtraction";
import { normalizeResume } from "../../shared/contentAdapters";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import { EXECUTIVE_MINIMAL_SECTION_ORDER, EXECUTIVE_MINIMAL_SECTION_LABELS } from "./sectionPolicy";
import type { TemplatePdfResult, TemplateRenderContext } from "../../contracts/types";

export async function renderExecutiveMinimalPdf(context: TemplateRenderContext): Promise<TemplatePdfResult> {
  const htmlResult = await renderExecutiveMinimalHtml(context);
  const bytes = await renderHtmlToPdfBytes(htmlResult.html, context.paperSize);
  const extraction = await extractPdf(bytes);

  const normalized = normalizeResume(context.resume);
  const expectedFragments = expectedFragmentsForResume(normalized);
  const headingsInOrder = EXECUTIVE_MINIMAL_SECTION_ORDER.filter((k) => k !== "identity")
    .map((k) => EXECUTIVE_MINIMAL_SECTION_LABELS[k])
    .filter((label): label is string => Boolean(label));

  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extraction.fullText,
    sectionHeadingsInOrder: headingsInOrder.filter((label) => extraction.fullText.toLowerCase().includes(label.toLowerCase())),
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: extraction.validHeader && extraction.parseable && extraction.blankPageIndices.length === 0 && extraction.pageCount === htmlResult.pageCount,
    structuralIssues: extraction.blankPageIndices.map((p) => ({ code: "blank-page", message: `page ${p}` })),
  });

  return {
    templateId: "executive-minimal",
    format: "pdf",
    bytes: Buffer.from(bytes),
    pageCount: extraction.pageCount,
    paperSize: context.paperSize,
    density: context.density,
    hasSelectableText: extraction.pageTexts.some((t) => t.trim().length > 0),
    validation,
  };
}
