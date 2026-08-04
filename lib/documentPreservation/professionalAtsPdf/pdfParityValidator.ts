/*
  TASK 7 - HTML/PDF parity: page count, density, section order, source
  coverage. Section order is checked against the PDF's own concatenated
  native text directly (first-occurrence position of each visible
  section's own heading label, or its first block's own first
  fragment for headingless sections like identity) - not a re-check of
  the plan against itself, so a genuine Chromium print-reflow bug that
  silently reordered content would still be caught here.
*/
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { expectedBlockFragments } from "../professionalAtsHtml/textPreservationValidator";
import type { PaginationPlan } from "../professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { PdfPageText } from "./pdfTextExtraction";
import type { PdfParityValidationResult, PdfSourcePage } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validatePdfParity(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  htmlDensity: AssemblyDensity,
  pdfPages: PdfPageText[],
  sourcePagePlan: PdfSourcePage[]
): PdfParityValidationResult {
  const fullText = normalize(
    pdfPages
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .map((p) => p.text)
      .join(" ")
  );

  const firstOccurrenceIndices: number[] = [];
  for (const sectionKey of assembly.visibleSectionKeys) {
    const label = PROFESSIONAL_ATS_SECTION_LABELS[sectionKey];
    let marker: string | null = label;
    if (!marker) {
      const section = assembly.sections.find((s) => s.key === sectionKey);
      const firstBlock = section?.blocks[0];
      const fragments = firstBlock ? expectedBlockFragments(firstBlock) : [];
      marker = fragments[0] ?? null;
    }
    const index = marker ? fullText.indexOf(normalize(marker)) : -1;
    firstOccurrenceIndices.push(index);
  }

  const foundIndices = firstOccurrenceIndices.filter((i) => i >= 0);
  const sameSectionOrder =
    foundIndices.length === firstOccurrenceIndices.length && foundIndices.every((idx, i) => i === 0 || idx >= foundIndices[i - 1]);

  const totalVisibleBlocks = assembly.sections.filter((s) => s.visible).reduce((sum, s) => sum + s.blocks.length, 0);
  const coveredBlockIds = new Set(sourcePagePlan.flatMap((p) => p.sourceBlockIds));
  const sourceCoveragePercent = totalVisibleBlocks === 0 ? 100 : Math.round((coveredBlockIds.size / totalVisibleBlocks) * 10000) / 100;

  return {
    htmlPageCount: plan.pageCount,
    pdfPageCount: pdfPages.length,
    sameDensity: plan.density === htmlDensity,
    sameSectionOrder,
    sourceCoveragePercent,
  };
}
