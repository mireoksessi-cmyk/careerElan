/*
  Document Preservation Engine (DPE) - Phase 4A (Generated Content
  Mapping). Cover Letter Mapping - Paragraph Matcher.

  Investigated first, per this phase's own instruction, whether an
  existing Cover Letter paragraph splitter could be reused instead of
  writing one: grepped the whole repo for cover-letter paragraph/section
  handling. Result - NONE exists. lib/brand/render (DocumentRenderer,
  buildDocumentIRFromText, the PDF/DOCX exporters) is entirely
  resume-specific; a repo-wide search for "CoverLetter"/"coverLetter"
  inside lib/brand returned zero matches. app/paste-job/page.tsx's own
  Cover Letter preview (unlike its Resume tab) renders through the plain
  flat-text A4Preview component, not any structured pipeline - confirmed
  by reading that call site directly. GeneratedPackage.coverLetter is
  just a string with no section/paragraph schema of its own to reuse
  (same as resume - see resumeMapping.ts's comment).

  Given no existing splitter to reuse, this uses the SAME blank-line
  paragraph-boundary technique already established elsewhere in this
  codebase for the same kind of "split raw text into blocks" purpose
  (lib/brand/experienceParser.ts's splitIntoBlocks(): `raw.split(/\n\s*\n+/)`)
  - not a new algorithm invented for this phase, the same standard
  paragraph-tokenization rule applied to a new input.
*/
import { pairPositionally } from "./positionalPairing";
import type { CoverLetterMapping } from "./types";
import type { DocumentLayerModel } from "../contentBox/types";
import type { MappingUnit } from "./types";

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/*
  8. Paragraph Matcher - one MappingUnit per paragraph, order preserved
  exactly as it appears in Generate Package's own coverLetter string.
*/
function buildParagraphUnits(coverLetterText: string): MappingUnit[] {
  return splitIntoParagraphs(coverLetterText).map((text, index) => ({
    id: `cover_letter-paragraph-${index}`,
    sourceGroup: "cover_letter" as const,
    unitType: "paragraph" as const,
    text,
    order: index,
  }));
}

/*
  5. Cover Letter Mapping - the orchestration entry point for one cover
  letter document. Only role "cover_letter_body" boxes are matched -
  Phase 3's role classifier only ever assigns that role for
  documentType === "cover_letter" (roleClassifier.ts), so this
  automatically excludes any Template-layer or unclassified box without
  needing its own extra layer check beyond editableBoxes.
*/
export function createCoverLetterMapping(
  generatedCoverLetterText: string,
  layerModel: DocumentLayerModel
): CoverLetterMapping {
  const boxes = layerModel.editableBoxes.filter((box) => box.role === "cover_letter_body");
  const units = buildParagraphUnits(generatedCoverLetterText);
  const pairing = pairPositionally(units, boxes);

  return {
    documentType: "cover_letter",
    status: pairing.status,
    generatedUnits: units,
    contentBoxes: boxes,
    assignments: pairing.assignments,
    unassignedUnits: pairing.unassignedUnits,
  };
}
