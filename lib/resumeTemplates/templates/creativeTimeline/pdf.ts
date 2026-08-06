/*
  Phase 6F - Template 4 PDF renderer. Same shared HTML->PDF technique.
*/
import { renderCreativeTimelineHtml, CREATIVE_TIMELINE_INTERNAL } from "./html";
import { renderHtmlToPdfBytes } from "../../pdf/renderHtmlToPdf";
import { extractPdf } from "../../parity/pdfExtraction";
import { normalizeResume } from "../../shared/contentAdapters";
import { CREATIVE_TIMELINE_COLORS } from "../../shared/colorTokens";
import { expectedFragmentsForResume } from "../../parity/textFragments";
import { buildValidationReport } from "../../parity/validateOutput";
import type { TemplatePdfResult, TemplateRenderContext } from "../../contracts/types";

export async function renderCreativeTimelinePdf(context: TemplateRenderContext): Promise<TemplatePdfResult> {
  const htmlResult = await renderCreativeTimelineHtml(context);
  const bytes = await renderHtmlToPdfBytes(htmlResult.html, context.paperSize);
  const extraction = await extractPdf(bytes);

  const normalized = normalizeResume(context.resume);
  const { headingsInOrder: mainHeadings } = CREATIVE_TIMELINE_INTERNAL.buildMainItems(normalized, CREATIVE_TIMELINE_COLORS);
  const { headingsInOrder: sidebarHeadings } = CREATIVE_TIMELINE_INTERNAL.buildSidebarItems(normalized, CREATIVE_TIMELINE_COLORS);
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
    templateId: "creative-timeline",
    format: "pdf",
    bytes: Buffer.from(bytes),
    pageCount: extraction.pageCount,
    paperSize: context.paperSize,
    density: context.density,
    hasSelectableText: extraction.pageTexts.some((t) => t.trim().length > 0),
    validation,
  };
}
