/*
  TASK 5 - DOCX format adapter. Reuses Phase 5B's own orchestrator
  (buildProfessionalAtsDocx) and text extraction (extractDocxText) as-
  is - no DOCX rendering/validation logic is reimplemented here, only
  translated into the common NormalizedFormatSnapshot shape.
*/
import { buildProfessionalAtsDocx } from "../professionalAtsDocx/buildProfessionalAtsDocx";
import { extractDocxText } from "../professionalAtsDocx/docxTextExtraction";
import { normalizeForParity } from "./parityNormalization";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsDocxResult } from "../professionalAtsDocx/types";
import type { NormalizedFormatSnapshot } from "./types";

const SECTION_HEADING_PREFIX = "section-heading:";

export async function buildDocxSnapshot(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<{ snapshot: NormalizedFormatSnapshot; docxResult: ProfessionalAtsDocxResult }> {
  const docxResult = await buildProfessionalAtsDocx(assembly, paperSize, density);

  /* Section visibility can't be derived from "section-heading:" mapping
     entries alone - identity has no heading label (matches Phase 4's
     own convention, PROFESSIONAL_ATS_SECTION_LABELS.identity === null)
     so it never gets one of those, yet it's still a visible section.
     Instead look up each entry's own section via the assembly (same
     approach the PDF adapter uses), which covers identity correctly. */
  const blockToSection = new Map<string, ProfessionalAtsSectionKey>();
  for (const section of assembly.sections) {
    for (const block of section.blocks) blockToSection.set(block.id, section.key);
  }

  const visibleSections: ProfessionalAtsSectionKey[] = [];
  const entryIds: string[] = [];
  for (const mapping of docxResult.sourceMapping) {
    if (mapping.sourceBlockId.startsWith(SECTION_HEADING_PREFIX)) continue;
    if (!entryIds.includes(mapping.sourceBlockId)) entryIds.push(mapping.sourceBlockId);
    const sectionKey = blockToSection.get(mapping.sourceBlockId);
    if (sectionKey && !visibleSections.includes(sectionKey)) visibleSections.push(sectionKey);
  }

  const rawText = docxResult.validation.structural.parseableZip ? await extractDocxText(docxResult.bytes) : "";
  const normalizedText = normalizeForParity(rawText);

  const snapshot: NormalizedFormatSnapshot = {
    format: "docx",
    normalizedText,
    orderedFragments: [],
    visibleSections,
    sectionLabels: [],
    entryIds,
    paperSize,
    density: docxResult.density,
    sourceEntryIds: entryIds,
    sourceBlockIds: entryIds,
    structureWarnings: docxResult.validation.warnings,
    pageCount: undefined,
  };

  return { snapshot, docxResult };
}
