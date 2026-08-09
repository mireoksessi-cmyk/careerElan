/*
  Phase 6F - Template 2 PDF renderer. Same shared HTML->PDF technique
  as Executive Minimal's pdf.ts.
*/
import { renderModernSidebarHtml, MODERN_SIDEBAR_INTERNAL } from "./html";
import { renderHtmlToPdfBytes } from "../../pdf/renderHtmlToPdf";
import { extractPdf } from "../../parity/pdfExtraction";
import { normalizeResume } from "../../shared/contentAdapters";
import { MODERN_SIDEBAR_COLORS } from "../../shared/colorTokens";
import { HTML_DENSITY_SPACING } from "../../shared/spacing";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import type { TemplatePdfResult, TemplateRenderContext } from "../../contracts/types";

export async function renderModernSidebarPdf(context: TemplateRenderContext): Promise<TemplatePdfResult> {
  const htmlResult = await renderModernSidebarHtml(context);
  const bytes = await renderHtmlToPdfBytes(htmlResult.html, context.paperSize);
  const extraction = await extractPdf(bytes);

  const normalized = normalizeResume(context.resume);
  const { headingsInOrder: mainHeadings } = MODERN_SIDEBAR_INTERNAL.buildMainItems(normalized, MODERN_SIDEBAR_COLORS, HTML_DENSITY_SPACING[context.density]);
  const { headingsInOrder: sidebarHeadings } = MODERN_SIDEBAR_INTERNAL.buildSidebarItems(normalized, MODERN_SIDEBAR_COLORS);
  const expectedFragments = expectedFragmentsForResume(normalized);

  const validation = buildValidationReport({
    expectedFragments,
    extractedText: extraction.fullText,
    sectionHeadingsInOrder: [...mainHeadings, ...sidebarHeadings].filter((label) => extraction.fullText.toLowerCase().includes(label.toLowerCase())),
    independentOrderedSequences: [mainHeadings, sidebarHeadings],
    identityFragments: [normalized.identity.fullName, normalized.identity.email].filter(Boolean),
    structuralPassed: extraction.validHeader && extraction.parseable && extraction.blankPageIndices.length === 0 && extraction.pageCount === htmlResult.pageCount,
    structuralIssues: extraction.blankPageIndices.map((p) => ({ code: "blank-page", message: `page ${p}` })),
  });

  return {
    templateId: "modern-sidebar",
    format: "pdf",
    bytes: Buffer.from(bytes),
    pageCount: extraction.pageCount,
    paperSize: context.paperSize,
    density: context.density,
    hasSelectableText: extraction.pageTexts.some((t) => t.trim().length > 0),
    validation,
  };
}
