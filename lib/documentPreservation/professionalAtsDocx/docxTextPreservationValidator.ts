/*
  TASK 6 - DOCX text preservation. Unlike Phase 5A's PDF validator
  (which scopes checks per-page because a PDF has real, inspectable
  page boundaries), a mammoth-extracted DOCX text is one flat
  document-wide string with no natural sub-scope to check against - so
  both the missing and invented checks run against the WHOLE document
  text. This is still false-positive-safe: the longest-fragment-first
  removal (ported from Phase 4/5A's own textPreservationValidator.ts
  header comment on why this is required) prevents a short fragment
  that's a substring of a longer one (e.g. "Toronto" inside "Toronto
  Metropolitan University") from corrupting the leftover computation,
  regardless of whether the check is scoped per-block, per-page, or
  whole-document - length-ordering is what actually fixes that bug,
  not scoping. Missing-fragment checks stay attributed PER BLOCK (for
  useful error messages) even though the search space is the whole
  document text.

  Reuses expectedBlockFragments() from Phase 4's own
  textPreservationValidator.ts (read-only import). Uses its own local
  boundaryPattern (not Phase 4's or Phase 5A's) with the same hyphen-
  tolerant matching Phase 5A's PDF validator needed - mammoth's HTML
  output can also introduce incidental whitespace at run/paragraph
  boundaries that a strict adjacent-character match would miss.
*/
import { expectedBlockFragments } from "../professionalAtsHtml/textPreservationValidator";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { DocxTextValidationResult } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function boundaryPattern(fragment: string): RegExp {
  const escaped = escapeRegExp(fragment).replace(/-/g, "-\\s?").replace(/\//g, "/\\s?");
  const startsAlnum = /^[A-Za-z0-9]/.test(fragment);
  const endsAlnum = /[A-Za-z0-9]$/.test(fragment);
  return new RegExp(`${startsAlnum ? "\\b" : ""}${escaped}${endsAlnum ? "\\b" : ""}`, "g");
}

function flattenVisibleBlocks(assembly: ProfessionalAtsAssemblyDocument): AssemblyBlock[] {
  const blocks: AssemblyBlock[] = [];
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    blocks.push(...section.blocks);
  }
  return blocks;
}

export function validateDocxTextPreservation(assembly: ProfessionalAtsAssemblyDocument, docxText: string): DocxTextValidationResult {
  const blocks = flattenVisibleBlocks(assembly);
  const normalizedText = normalize(docxText);

  const missingFragments: string[] = [];
  let expectedFragmentCount = 0;
  let foundFragmentCount = 0;
  const allFragments: string[] = [];

  for (const section of assembly.sections) {
    if (section.visible) {
      const label = PROFESSIONAL_ATS_SECTION_LABELS[section.key];
      if (label) allFragments.push(label);
    }
  }

  for (const block of blocks) {
    const expected = expectedBlockFragments(block);
    expectedFragmentCount += expected.length;
    for (const fragment of expected) {
      allFragments.push(fragment);
      if (boundaryPattern(fragment).test(normalizedText)) {
        foundFragmentCount++;
      } else {
        missingFragments.push(`${block.id}: ${fragment}`);
      }
    }
  }

  /* Invented text: whole-document longest-first removal. */
  let leftover = normalizedText;
  const byLengthDesc = [...allFragments].sort((a, b) => b.length - a.length);
  for (const fragment of byLengthDesc) {
    leftover = leftover.replace(boundaryPattern(fragment), " ");
  }
  leftover = leftover.replace(/[·,\-—:/]/g, " ").replace(/\s+/g, " ").trim();
  const inventedFragments = leftover.length > 0 ? [leftover] : [];

  /* Structural duplicate check: same block appearing with more than
     one distinct sourceEntryId grouping is not possible in this flat
     renderer (one AssemblyBlock always renders exactly once), so this
     is always empty for this renderer's own output - kept as an
     explicit field (rather than omitted) so the report shape matches
     spec section 24 and stays meaningful if a future renderer variant
     ever did risk duplication. */
  const duplicateEntryIds: string[] = [];

  return { expectedFragmentCount, foundFragmentCount, missingFragments, inventedFragments, duplicateEntryIds };
}
