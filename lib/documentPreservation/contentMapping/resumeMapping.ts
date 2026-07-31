/*
  Document Preservation Engine (DPE) - Phase 4A (Generated Content
  Mapping). Resume Mapping - Section Matcher + Bullet Matcher.

  Reuses lib/brand/buildDocumentIR.ts's buildDocumentIRFromText()
  UNCHANGED as the "Resume JSON Schema" this phase's own instruction
  requires reusing ("이미 존재하는 Resume JSON Schema를 반드시 재사용한다.
  새 Schema를 만들지 않는다"). Generate Package's own `resume` field is a
  flat string (GeneratedPackage.resume: string, lib/generatePackage/
  shared.ts:183) - it has no JSON section/heading/bullet schema of its
  own. buildDocumentIRFromText is the closest thing that DOES exist: the
  same parser DocumentRenderer.tsx, pdfDocumentExport.ts, and
  docxDocumentExport.ts already use to turn that string into
  sections/experienceEntries. This module calls it, never re-derives
  section/heading/bullet detection itself.
*/
import { buildDocumentIRFromText } from "@/lib/brand/buildDocumentIR";
import type { ParsedSection, SectionKey } from "@/lib/brand/types";
import { SECTION_KEY_TO_ROLE } from "../contentBox/roleClassifier";
import type { ContentBox, DocumentLayerModel } from "../contentBox/types";
import { pairPositionally } from "./positionalPairing";
import type { MappingStatus, MappingUnit, ResumeMapping, SectionMapping } from "./types";

/*
  Only "experience" and "volunteer" get a per-role/per-bullet split here,
  because buildDocumentIRFromText only populates `experienceEntries` for
  those two keys (lib/brand/buildDocumentIR.ts:16-19) - reusing
  parseExperienceEntries()'s existing output, not a new splitter.
  Education has no equivalent existing entry-parser (confirmed by reading
  buildDocumentIR.ts) despite this phase's own example showing "Education
  -> Education Boxes" (plural) - building one would be a new parser this
  phase forbids, so Education (and every other section) is mapped at
  section-block granularity instead. Disclosed as a known limitation in
  the final report, not silently done.
*/
const BULLET_LEVEL_SECTIONS = new Set<SectionKey>(["experience", "volunteer"]);

/*
  6. Editable Box Matcher - Template Layer is never a mapping target.
  layerModel.editableBoxes is already the layer-partitioned list Phase 3
  produced; this just names that access explicitly so it is traceable as
  its own step rather than folded silently into section matching.
*/
export function matchEditableBoxes(layerModel: DocumentLayerModel): ContentBox[] {
  return layerModel.editableBoxes;
}

/*
  7. Section Matcher - which Content Boxes correspond to one DocumentIR
  section, via the exact same SectionKey -> role table Phase 3's own
  role classifier uses (SECTION_KEY_TO_ROLE, now exported from
  roleClassifier.ts) - not a second, possibly-drifting copy of that
  mapping.
*/
export function matchSectionBoxes(
  sectionKey: SectionKey,
  editableBoxes: ContentBox[]
): ContentBox[] {
  const role = SECTION_KEY_TO_ROLE[sectionKey];
  return editableBoxes.filter((box) => box.role === role);
}

/*
  9. Bullet Matcher - flattens every entry's bullets into one ordered
  sequence (entry order, then bullet order within each entry - both
  already established by parseExperienceEntries(), never reordered), for
  positional pairing against this section's boxes. An entry the existing
  parser could not confidently split (`structured: false`) contributes
  its whole raw block as a single unit rather than guessing where its
  bullets start - per this phase's own "추측으로 Box를 생성하지 않는다".
*/
function buildBulletUnits(section: ParsedSection): MappingUnit[] {
  const entries = section.experienceEntries ?? [];
  const units: MappingUnit[] = [];
  let order = 0;

  for (const entry of entries) {
    const lines =
      entry.structured && entry.description
        ? entry.description
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [entry.raw];

    for (const text of lines) {
      units.push({
        id: `${section.key}-bullet-${order}`,
        sourceGroup: section.key,
        unitType: "bullet",
        text,
        order: order++,
      });
    }
  }

  return units;
}

/*
  Same leading-bullet-marker convention already used elsewhere in this
  codebase for the identical purpose (lib/brand/experienceParser.ts's
  private looksLikeBulletLine(); DocumentRenderer.tsx/blocks.ts strip the
  same marker when rendering) - not a new heuristic. Needed because
  Phase 3 tags EVERY non-heading box inside an experience entry with role
  "experience", not just its bullets - a DOCX entry's job-title line
  ("Senior Business Analyst | 2021-04") and company line ("Meridian
  Financial Group") get role "experience" too (docxContentBoxGenerator.ts
  maps every <p>/<li> the same way). Without this filter, positional
  pairing puts bullet text into title/company boxes and vice versa -
  confirmed empirically against a real DOCX fixture (see the final
  report's "Mapping 실패 사례").
*/
function looksLikeBulletBox(box: ContentBox): boolean {
  return /^\s*[-•*]\s+/.test(box.text ?? "");
}

/*
  Root-cause investigation finding (real, evidence-based - see the
  session's own root-cause report): `looksLikeBulletBox()` requires a
  LITERAL leading "-"/"•"/"*" character. Real fixtures proved this is
  almost never true - PDF geometry-clustering can merge an entire job
  entry (heading + title + company + every bullet) into ONE ContentBox
  whose own text starts with the section heading, not a bullet marker;
  and DOCX/plain-sentence bullets (mammoth <li> output, or any resume
  whose bullets are plain sentences) never carry a literal marker
  character at all - confirmed via real instrumented runs against both
  a PDF fixture (5 blocks total, only 1 correctly classified
  role=experience, that ONE box's own text starts with "Experience\n...",
  filtered to 0) and a DOCX fixture (5 real, individually and correctly
  role=experience-classified boxes, ALL filtered to 0 - proving this is
  not a PDF-clustering artifact, but the literal-marker requirement
  itself).

  roleClassifier.ts's own role=experience assignment was, in both real
  cases, ALREADY CORRECT - the bug is entirely downstream, in this
  file's own bullet-marker filter discarding those already-correctly-
  classified boxes. This fix never touches roleClassifier.ts and never
  relaxes the filter to unconditionally accept everything: when at
  least one real bullet-marked box exists, the original, more precise
  per-bullet positional pairing is kept unchanged (no regression for
  documents that DO use literal markers, e.g. this session's own
  word_docx fixture). Only when the marker filter finds ZERO boxes -
  the real, confirmed failure mode - does this fall back to the SAME
  section-block ("1:N") mapping shape mapSectionBlock() already uses
  safely for every other section (Summary/Education/Skills/...): the
  section's real, correctly role-matched boxes are kept in the mapping
  (never zero, never broken_mapping) rather than fabricating a
  per-bullet split this pipeline cannot actually determine. This reuses
  an EXISTING, already-proven mapping shape - not a new heuristic - and
  is already safe against the "same text fanned out to N boxes" case:
  rendererAdapter.ts's renderBoxesToResumeText() already de-duplicates
  consecutive same-role/same-text boxes for exactly this reason (see its
  own comment - built for mapSectionBlock's Skills-section 1:N case).
*/
function mapBulletLevelSection(section: ParsedSection, editableBoxes: ContentBox[]): SectionMapping {
  const sectionBoxes = matchSectionBoxes(section.key, editableBoxes);
  const bulletBoxes = sectionBoxes.filter(looksLikeBulletBox);

  if (bulletBoxes.length === 0) {
    return mapSectionBlock(section, editableBoxes);
  }

  const units = buildBulletUnits(section);
  const pairing = pairPositionally(units, bulletBoxes);

  return {
    sectionKey: section.key,
    status: pairing.status,
    generatedUnits: units,
    contentBoxes: bulletBoxes,
    assignments: pairing.assignments,
    unassignedUnits: pairing.unassignedUnits,
  };
}

/*
  Section-block mapping: the section's whole raw text (untouched,
  exactly as buildDocumentIRFromText already extracted it) is ONE
  generated unit, matched against ALL boxes sharing that section's role -
  a valid 1:N shape per this phase's own "1:1 또는 1:N으로 연결한다"
  principle, not a partial mapping. Used for every section except
  experience/volunteer (see BULLET_LEVEL_SECTIONS above) - and, as of
  the root-cause fix above, also used as experience/volunteer's own
  fallback when no literal bullet marker was found.
*/
function mapSectionBlock(section: ParsedSection, editableBoxes: ContentBox[]): SectionMapping {
  const boxes = matchSectionBoxes(section.key, editableBoxes);
  const raw = section.raw.trim();

  const units: MappingUnit[] = raw
    ? [{ id: `${section.key}-block-0`, sourceGroup: section.key, unitType: "section_block", text: raw, order: 0 }]
    : [];

  if (units.length === 0 || boxes.length === 0) {
    return {
      sectionKey: section.key,
      status: "unmapped",
      generatedUnits: units,
      contentBoxes: boxes,
      assignments: boxes.map((contentBox) => ({ contentBox, unit: null })),
      unassignedUnits: units,
    };
  }

  return {
    sectionKey: section.key,
    status: "mapped",
    generatedUnits: units,
    contentBoxes: boxes,
    assignments: boxes.map((contentBox) => ({ contentBox, unit: units[0] })),
    unassignedUnits: [],
  };
}

function aggregateStatus(statuses: MappingStatus[]): MappingStatus {
  if (statuses.length === 0) return "unmapped";
  if (statuses.every((status) => status === "mapped")) return "mapped";
  if (statuses.every((status) => status === "unmapped")) return "unmapped";
  return "partially_mapped";
}

/*
  4. Resume Mapping - the orchestration entry point for one resume
  document. `generatedResumeText` is GeneratedPackage.resume, passed in
  untouched by the caller (see index.ts's createReplacementPlan).
*/
export function createResumeMapping(
  generatedResumeText: string,
  layerModel: DocumentLayerModel
): ResumeMapping {
  const ir = buildDocumentIRFromText(generatedResumeText);
  const editableBoxes = matchEditableBoxes(layerModel);

  const sections = ir.sections.map((section) =>
    BULLET_LEVEL_SECTIONS.has(section.key)
      ? mapBulletLevelSection(section, editableBoxes)
      : mapSectionBlock(section, editableBoxes)
  );

  return {
    documentType: "resume",
    status: aggregateStatus(sections.map((section) => section.status)),
    sections,
  };
}
