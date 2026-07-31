/*
  Document Preservation Engine (DPE) - Phase 4A (Generated Content
  Mapping). Types only - no text is replaced here (see this phase's own
  "실제 Replacement는 다음 Phase에서 수행한다"). A ReplacementPlan records
  WHICH generated content unit is destined for WHICH Content Box; it never
  writes into a box's `text`/`elements` fields.
*/
import type { SectionKey } from "@/lib/brand/types";
import type { ContentBox } from "../contentBox/types";

export type MappingStatus = "mapped" | "partially_mapped" | "unmapped";

/*
  One piece of Generate Package's own output text, already split by an
  EXISTING utility (buildDocumentIRFromText for resume sections/bullets,
  a plain blank-line split for cover letter paragraphs - see
  coverLetterMapping.ts for why no existing splitter exists there to
  reuse). `sourceGroup` names the SectionKey (or "cover_letter") this
  unit came from purely for traceability in the final report - it is not
  used for matching logic.
*/
export type MappingUnit = {
  id: string;
  sourceGroup: SectionKey | "cover_letter";
  unitType: "section_block" | "bullet" | "paragraph";
  text: string;
  order: number;
};

/*
  One resolved pairing (or deliberate non-pairing) between a Content Box
  and a generated unit. `unit: null` means this box exists but no
  generated content was assigned to it (a real, disclosed case - not an
  error). Never invents a ContentBox that Phase 3 did not already
  produce.
*/
export type ContentBoxAssignment = {
  contentBox: ContentBox;
  unit: MappingUnit | null;
};

export type SectionMapping = {
  sectionKey: SectionKey;
  status: MappingStatus;
  generatedUnits: MappingUnit[];
  contentBoxes: ContentBox[];
  assignments: ContentBoxAssignment[];
  /* Generated units that could not be assigned any box (Generate output
     has more units than Content Boxes for this section). */
  unassignedUnits: MappingUnit[];
};

export type ResumeMapping = {
  documentType: "resume";
  status: MappingStatus;
  sections: SectionMapping[];
};

export type CoverLetterMapping = {
  documentType: "cover_letter";
  status: MappingStatus;
  generatedUnits: MappingUnit[];
  contentBoxes: ContentBox[];
  assignments: ContentBoxAssignment[];
  unassignedUnits: MappingUnit[];
};

export type ReplacementPlan = ResumeMapping | CoverLetterMapping;
