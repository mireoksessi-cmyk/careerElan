/*
  TASK 7/19 - HTML/PDF/DOCX content parity, scoped exactly as spec
  section 19 defines it for this phase: confirm the DOCX renderer
  itself never diverges from the content policy Phase 3/4 already
  established (visible sections, section order, entry order, protected
  facts, source coverage) - NOT pixel/page-count parity (explicitly
  out of scope per spec section 19, deferred to a future Phase 5C
  cross-format parity engine).

  Section/entry order is derived from the DOCX's OWN extracted text
  (first-occurrence position of each section's label / each block's
  own first expected fragment) rather than re-deriving from the same
  in-memory assembly list the renderer already iterated - re-checking
  against the in-memory list would be tautological (the renderer is
  guaranteed to iterate assembly.sections in order by construction);
  checking against the actual DOCX TEXT independently verifies the
  renderer's OUTPUT, not just its input traversal.
*/
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import { expectedBlockFragments } from "../professionalAtsHtml/textPreservationValidator";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { DocxParityValidationResult, DocxSourceMapping } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validateDocxParity(assembly: ProfessionalAtsAssemblyDocument, docxText: string, sourceMapping: DocxSourceMapping[]): DocxParityValidationResult {
  const normalizedText = normalize(docxText);

  /* --- sameVisibleSections / sameSectionOrder ---
     Markers are searched with an advancing cursor (not always from
     position 0): two different sections/blocks can share the same
     short, generic marker text (e.g. a bare province abbreviation like
     "ON" when an entry has no other distinguishing field), and a
     from-0 indexOf would let a later block "re-find" an earlier
     block's already-claimed occurrence, misreporting a false
     out-of-order result. Anchoring each search to where the previous
     match ended verifies genuine relative order instead. */
  const firstOccurrenceIndices: number[] = [];
  let allVisibleLabelsPresent = true;
  let sectionSearchCursor = 0;
  for (const sectionKey of assembly.visibleSectionKeys) {
    const label = PROFESSIONAL_ATS_SECTION_LABELS[sectionKey];
    let marker: string | null = label;
    if (!marker) {
      const section = assembly.sections.find((s) => s.key === sectionKey);
      const firstBlock = section?.blocks[0];
      const fragments = firstBlock ? expectedBlockFragments(firstBlock) : [];
      marker = fragments[0] ?? null;
    }
    const normalizedMarker = marker ? normalize(marker) : null;
    const index = normalizedMarker ? normalizedText.indexOf(normalizedMarker, sectionSearchCursor) : -1;
    if (index < 0) {
      allVisibleLabelsPresent = false;
    } else {
      sectionSearchCursor = index + (normalizedMarker as string).length;
    }
    firstOccurrenceIndices.push(index);
  }
  const foundIndices = firstOccurrenceIndices.filter((i) => i >= 0);
  const sameSectionOrder = foundIndices.length === firstOccurrenceIndices.length && foundIndices.every((idx, i) => i === 0 || idx >= foundIndices[i - 1]);

  let noHiddenLabelsPresent = true;
  for (const section of assembly.sections) {
    if (section.visible) continue;
    const label = PROFESSIONAL_ATS_SECTION_LABELS[section.key];
    if (label && normalizedText.includes(normalize(label))) noHiddenLabelsPresent = false;
  }
  const sameVisibleSections = allVisibleLabelsPresent && noHiddenLabelsPresent;

  /* --- sameEntryOrder: within each visible section, blocks' first
     expected fragment should appear in the DOCX text in the same
     order the assembly lists them. --- */
  let sameEntryOrder = true;
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    let entrySearchCursor = 0;
    let lastFoundIndex = -1;
    for (const block of section.blocks) {
      const fragments = expectedBlockFragments(block);
      const marker = fragments[0];
      const normalizedMarker = marker ? normalize(marker) : null;
      const index = normalizedMarker ? normalizedText.indexOf(normalizedMarker, entrySearchCursor) : -1;
      if (index < 0) continue;
      if (index < lastFoundIndex) sameEntryOrder = false;
      lastFoundIndex = index;
      entrySearchCursor = index + normalizedMarker!.length;
    }
  }

  /* --- sameProtectedFacts: identity block's own fragments (name/
     contact) all present. --- */
  const identitySection = assembly.sections.find((s) => s.key === "identity");
  const identityBlock: AssemblyBlock | undefined = identitySection?.blocks[0];
  const identityFragments = identityBlock ? expectedBlockFragments(identityBlock) : [];
  const sameProtectedFacts = identityFragments.every((f) => normalizedText.includes(normalize(f)));

  /* --- sourceCoveragePercent --- */
  const totalVisibleBlocks = assembly.sections.filter((s) => s.visible).reduce((sum, s) => sum + s.blocks.length, 0);
  const coveredBlockIds = new Set(sourceMapping.filter((m) => !m.sourceBlockId.startsWith("section-heading:")).map((m) => m.sourceBlockId));
  const sourceCoveragePercent = totalVisibleBlocks === 0 ? 100 : Math.round((coveredBlockIds.size / totalVisibleBlocks) * 10000) / 100;

  return { sameVisibleSections, sameSectionOrder, sameEntryOrder, sameProtectedFacts, sourceCoveragePercent };
}
