/*
  Phase 6F - Template 1, Professional ATS. A thin registry wrapper
  around the EXISTING, unmodified Phase 3/4/5A/5B pipeline
  (professionalAtsAssembly/Html/Pdf/Docx) - zero reimplementation, so
  this template inherits that pipeline's own already-passing
  validation. Only translates: (a) TemplateRenderContext.resume ->
  buildProfessionalAtsAssembly() directly (no runtime-level adapter
  needed here since the context already carries a resolved
  ResumeStructuredModel), and (b) each layer's own validation report
  shape into the shared TemplateValidationReport contract.
*/
import { buildProfessionalAtsAssembly } from "../../../documentPreservation/professionalAtsAssembly/buildProfessionalAtsAssembly";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../../../documentPreservation/professionalAtsAssembly/types";
import { buildProfessionalAtsHtmlPreview } from "../../../documentPreservation/professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import { buildPaginatedPageHtml } from "../../../documentPreservation/professionalAtsHtml/paginatedHtmlString";
import { buildProfessionalAtsPdf } from "../../../documentPreservation/professionalAtsPdf/buildProfessionalAtsPdf";
import { buildProfessionalAtsDocx } from "../../../documentPreservation/professionalAtsDocx/buildProfessionalAtsDocx";
import type { TemplateRenderer } from "../../contracts/templateContract";
import type { TemplateDensity, TemplateDocxResult, TemplateHtmlResult, TemplatePdfResult, TemplateRenderContext, TemplateValidationReport } from "../../contracts/types";
import { registerTemplate } from "../../registry/templateRegistry";
import { PROFESSIONAL_ATS_CAPABILITIES } from "../../registry/templateMetadata";

function toAssemblyDensity(density: TemplateDensity): AssemblyDensity {
  if (density === "spacious") return "comfortable";
  if (density === "comfortable") return "comfortable";
  if (density === "balanced") return "balanced";
  return "compact";
}

function fromAssemblyDensity(density: AssemblyDensity): TemplateDensity {
  if (density === "ultra-compact") return "compact";
  return density;
}

function buildAssembly(context: TemplateRenderContext): ProfessionalAtsAssemblyDocument {
  return buildProfessionalAtsAssembly(context.resume);
}

function htmlValidationToShared(assembly: ProfessionalAtsAssemblyDocument, html: Awaited<ReturnType<typeof buildProfessionalAtsHtmlPreview>>): TemplateValidationReport {
  const v = html.validation;
  const av = assembly.validation;
  return {
    passed: v.passed && av.passed,
    missingTextCount: v.missingTextFragments.length,
    inventedTextCount: v.inventedTextFragments.length,
    duplicateTextCount: v.duplicateTextFragments.length,
    sectionOrderPreserved: v.sectionOrderViolations.length === 0 && av.orderViolations.length === 0,
    entryOrderPreserved: av.missingEntryIds.length === 0 && av.duplicateEntryIds.length === 0,
    protectedFactsUnchanged: av.destructiveCompactionFlags.length === 0,
    issues: [
      ...v.missingTextFragments.map((m) => ({ code: "missing-text", message: m })),
      ...v.inventedTextFragments.map((m) => ({ code: "invented-text", message: m })),
      ...v.duplicateTextFragments.map((m) => ({ code: "duplicate-text", message: m })),
      ...v.sectionHeadingOrphans.map((k) => ({ code: "section-heading-orphan", message: String(k), sectionKey: String(k) })),
      ...v.entryHeaderOrphans.map((id) => ({ code: "entry-header-orphan", message: id, entryId: id })),
    ],
  };
}

function pdfValidationToShared(result: Awaited<ReturnType<typeof buildProfessionalAtsPdf>>): TemplateValidationReport {
  const v = result.validation;
  return {
    passed: v.passed,
    missingTextCount: v.text.missingFragments.length,
    inventedTextCount: v.text.inventedFragments.length,
    duplicateTextCount: v.text.duplicateEntryIds.length,
    sectionOrderPreserved: v.parity.sameSectionOrder,
    entryOrderPreserved: v.text.duplicateEntryIds.length === 0,
    protectedFactsUnchanged: v.parity.sourceCoveragePercent === 100,
    issues: [
      ...v.text.missingFragments.map((m) => ({ code: "missing-text", message: m })),
      ...v.text.inventedFragments.map((m) => ({ code: "invented-text", message: m })),
      ...v.structural.blankPages.map((p) => ({ code: "blank-page", message: `page ${p}` })),
    ],
  };
}

function docxValidationToShared(result: Awaited<ReturnType<typeof buildProfessionalAtsDocx>>): TemplateValidationReport {
  const v = result.validation;
  return {
    passed: v.passed,
    missingTextCount: v.text.missingFragments.length,
    inventedTextCount: v.text.inventedFragments.length,
    duplicateTextCount: v.text.duplicateEntryIds.length,
    sectionOrderPreserved: v.parity.sameSectionOrder,
    entryOrderPreserved: v.parity.sameEntryOrder,
    protectedFactsUnchanged: v.parity.sameProtectedFacts,
    issues: [
      ...v.text.missingFragments.map((m) => ({ code: "missing-text", message: m })),
      ...v.text.inventedFragments.map((m) => ({ code: "invented-text", message: m })),
      ...v.paginationIntent.violations.map((m) => ({ code: "pagination-violation", message: m })),
    ],
  };
}

async function renderHtml(context: TemplateRenderContext): Promise<TemplateHtmlResult> {
  const assembly = buildAssembly(context);
  const preview = await buildProfessionalAtsHtmlPreview(assembly, context.paperSize);
  const html = await buildPaginatedPageHtml(assembly, preview.plan, context.paperSize, preview.plan.density);
  return {
    templateId: "professional-ats",
    format: "html",
    html,
    pageCount: preview.plan.pageCount,
    paperSize: context.paperSize,
    density: fromAssemblyDensity(preview.plan.density),
    validation: htmlValidationToShared(assembly, preview),
  };
}

async function renderPdf(context: TemplateRenderContext): Promise<TemplatePdfResult> {
  const assembly = buildAssembly(context);
  const result = await buildProfessionalAtsPdf(assembly, context.paperSize);
  return {
    templateId: "professional-ats",
    format: "pdf",
    bytes: Buffer.from(result.bytes),
    pageCount: result.pageCount,
    paperSize: context.paperSize,
    density: fromAssemblyDensity(result.density),
    hasSelectableText: result.validation.text.foundFragmentCount > 0,
    validation: pdfValidationToShared(result),
  };
}

async function renderDocx(context: TemplateRenderContext): Promise<TemplateDocxResult> {
  const assembly = buildAssembly(context);
  const result = await buildProfessionalAtsDocx(assembly, context.paperSize, toAssemblyDensity(context.density));
  return {
    templateId: "professional-ats",
    format: "docx",
    bytes: Buffer.from(result.bytes),
    paperSize: context.paperSize,
    density: fromAssemblyDensity(result.density),
    isEditableNativeDocx: result.validation.structural.parseableZip && result.validation.structural.requiredPartsPresent,
    validation: docxValidationToShared(result),
  };
}

export const professionalAtsRenderer: TemplateRenderer = { renderHtml, renderPdf, renderDocx };

export function registerProfessionalAtsTemplate(): void {
  registerTemplate({ capabilities: PROFESSIONAL_ATS_CAPABILITIES, renderer: professionalAtsRenderer });
}
