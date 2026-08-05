/*
  TASK 5 - PDF format adapter. Reuses Phase 5A's own orchestrator
  (buildProfessionalAtsPdf) and text extraction (extractPdfPageText) as-
  is - no PDF rendering/validation logic is reimplemented here, only
  translated into the common NormalizedFormatSnapshot shape.
*/
import { buildProfessionalAtsPdf } from "../professionalAtsPdf/buildProfessionalAtsPdf";
import { extractPdfPageText } from "../professionalAtsPdf/pdfTextExtraction";
import { normalizeForParity } from "./parityNormalization";
import type { ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsPdfResult } from "../professionalAtsPdf/types";
import type { NormalizedFormatSnapshot } from "./types";

export async function buildPdfSnapshot(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize
): Promise<{ snapshot: NormalizedFormatSnapshot; pdfResult: ProfessionalAtsPdfResult }> {
  const pdfResult = await buildProfessionalAtsPdf(assembly, paperSize);

  const blockToSection = new Map<string, ProfessionalAtsSectionKey>();
  for (const section of assembly.sections) {
    for (const block of section.blocks) blockToSection.set(block.id, section.key);
  }

  const visibleSections: ProfessionalAtsSectionKey[] = [];
  const seenSections = new Set<ProfessionalAtsSectionKey>();
  const entryIds: string[] = [];
  const seenEntries = new Set<string>();
  const sourceByPage = [...pdfResult.sourcePagePlan].sort((a, b) => a.pageIndex - b.pageIndex);
  for (const page of sourceByPage) {
    for (const blockId of page.sourceBlockIds) {
      const sectionKey = blockToSection.get(blockId);
      if (sectionKey && !seenSections.has(sectionKey)) {
        seenSections.add(sectionKey);
        visibleSections.push(sectionKey);
      }
      if (!seenEntries.has(blockId)) {
        seenEntries.add(blockId);
        entryIds.push(blockId);
      }
    }
  }

  const pdfPages = pdfResult.validation.structural.parseable ? await extractPdfPageText(pdfResult.bytes) : [];
  const rawText = pdfPages
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((p) => p.text)
    .join(" ");
  const normalizedText = normalizeForParity(rawText);

  const snapshot: NormalizedFormatSnapshot = {
    format: "pdf",
    normalizedText,
    orderedFragments: [],
    visibleSections,
    sectionLabels: [],
    entryIds,
    paperSize,
    density: pdfResult.density,
    sourceEntryIds: entryIds,
    sourceBlockIds: entryIds,
    structureWarnings: pdfResult.validation.warnings,
    pageCount: pdfResult.pageCount,
  };

  return { snapshot, pdfResult };
}
