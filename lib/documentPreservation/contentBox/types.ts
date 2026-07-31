/*
  Document Preservation Engine (DPE) - Phase 3 (Content Box & Template
  Layer). Consumes Phase 2's LayoutAnalysisResult as-is - no new PDF/DOCX
  parsing happens here (see pdfContentBoxGenerator.ts / docxContentBoxGenerator.ts
  for exactly how each source format's Content Boxes are derived from
  Phase 2's already-extracted ElementMetadata).

  One shared model for both PDF and DOCX, but `source`/`confidence`
  always disclose which generation strategy produced a given box (PDF:
  "geometry", real x/y/width/height clustering; DOCX: "logical", HTML
  element order/type only, no coordinates) - per this phase's own
  instruction: "정밀도가 다르다는 사실을 명시적으로 표현한다."
*/
import type { DPEDocumentType } from "../types";
import type { ElementMetadata, LayoutSourceFormat } from "../layoutAnalysis/types";

export type ContentBoxSource = "geometry" | "logical" | "unknown";
export type ContentBoxLayer = "template" | "editable" | "unknown";
export type ContentBoxConfidence = "high" | "medium" | "low";

/*
  Template roles are ones this phase's own spec listed as classifiable
  "가능한 범위에서" - in practice, several of these are NEVER assigned by
  either generator (see the final report's "unknown/null로 남긴 정보와
  이유" section for exactly which, and why). Kept in the type because a
  later phase's data may support them even where this phase's generators
  cannot.
*/
export type TemplateRole =
  | "background"
  | "decoration"
  | "branding"
  | "sidebar"
  | "divider"
  | "border"
  | "header"
  | "footer"
  | "page_number"
  | "unknown";

/*
  "heading" covers the section-heading line itself (e.g. the literal text
  "Skills"); the roles below it are the section's BODY content, extended
  beyond this phase's own example list ("languages"/"volunteer"/
  "references") to match every SectionKey lib/brand/sectionParser.ts
  already recognizes, rather than collapsing those three into "unknown"
  when a confident heading match exists for them too.
*/
export type EditableRole =
  | "heading"
  | "summary"
  | "experience"
  | "project"
  | "education"
  | "certification"
  | "skills"
  | "languages"
  | "volunteer"
  | "references"
  | "cover_letter_body"
  | "unknown";

export type ContentBoxRole = TemplateRole | EditableRole;

export type ContentBoxGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/*
  Completion pass (Phase 1-4 roadmap closure): flow/repetition attributes
  a real Template Region classifier can now populate (see
  templateRegionClassifier.ts). All default to the "safe editable content"
  values (flowing: true, everything else false/null) when a box was never
  evaluated against page-repetition evidence - never guessed positively.
*/
export type ContentBoxFlowAttributes = {
  /* True only for a TEMPLATE-layer box confirmed to repeat (same text +
     geometry) on 2+ pages - never true for editable content, and never
     true for a single-page document (repetition cannot be observed with
     only one page to compare). */
  repeatable: boolean;
  /* True only when a repeatable box was observed on page 1 but confirmed
     ABSENT (by the same geometry+text check) on every later page. */
  firstPageOnly: boolean;
  /* True only when a repeatable box was observed on the LAST page but
     confirmed absent on every earlier page. */
  lastPageOnly: boolean;
  /* Editable content flows/reflows across pages by default (true). A
     template region box that must stay fixed in place (a repeating
     header/footer/sidebar frame) is false. */
  flowing: boolean;
  /* Non-null groups 2+ boxes that must never be split across a page
     break (e.g. a job title box + its first bullet box) - populated by
     Phase 4's continuation planning, never by the classifier itself. */
  unbreakableGroup: string | null;
};

export function defaultFlowAttributes(): ContentBoxFlowAttributes {
  return { repeatable: false, firstPageOnly: false, lastPageOnly: false, flowing: true, unbreakableGroup: null };
}

export type ContentBox = {
  id: string;
  page: number;
  type: "text" | "image" | "table" | "unknown";
  layer: ContentBoxLayer;
  role: ContentBoxRole;
  source: ContentBoxSource;
  confidence: ContentBoxConfidence;
  /*
    Human-readable, not machine-parsed - e.g.
    "pdf_geometry_vertical_gap_clustering" or "docx_logical_1to1". Exists
    so a box's classification is always traceable back to which specific
    technique produced it, per this phase's "생성 방식과 신뢰도를
    기록해야 한다" requirement.
  */
  generationMethod: string;
  /*
    Only ever non-null for PDF boxes (real coordinates from Phase 2) and,
    as of this completion pass, real-geometry DOCX boxes (see
    docxGeometryRenderer.ts). Still null for any DOCX box the geometry
    renderer could not match back to a real measured element - never
    invented.
  */
  boundingBox: ContentBoxGeometry | null;
  text: string | null;
  /*
    The Phase 2 ElementMetadata entries this box groups - exactly 1 for
    every DOCX box (1:1 mapping, see docxContentBoxGenerator.ts), 1 or
    more for PDF boxes (geometry clustering can merge several text runs
    into one box).
  */
  elements: ElementMetadata[];
  /*
    Which Template Region (a box with layer "template") this box's own
    geometry falls inside, e.g. an editable "skills" box physically
    located within a classified "sidebar" region. Null when no Template
    Region was classified for this document/page, or when this box IS
    itself a template-layer box (a region does not nest inside itself).
  */
  templateRegionId: string | null;
  flow: ContentBoxFlowAttributes;
};

/*
  A geometric REGION (e.g. "the narrow left column on page 1 is a
  sidebar"), distinct from a ContentBox - a region is not itself content,
  it is a descriptor that one or more already-existing editable/unknown
  boxes are located inside (via ContentBox.templateRegionId). Kept
  separate from `boxes` specifically to avoid ever duplicating real
  content into a second box just to represent "this is a region" -  a
  region with real member content (e.g. a sidebar containing a real
  "skills" box) never needs its own copy of that text.
*/
export type TemplateRegionDescriptor = {
  id: string;
  role: TemplateRole;
  page: number;
  boundingBox: ContentBoxGeometry;
  memberBoxIds: string[];
  generationMethod: string;
};

export type DocumentLayerModel = {
  documentType: DPEDocumentType;
  sourceFormat: LayoutSourceFormat;
  boxes: ContentBox[];
  templateBoxes: ContentBox[];
  editableBoxes: ContentBox[];
  unknownBoxes: ContentBox[];
  templateRegions: TemplateRegionDescriptor[];
  /*
    Human-readable disclosure of what the Template Region classifier
    (templateRegionClassifier.ts) did and did not find, and why - always
    populated (never omitted) once generateContentBoxes() runs the
    classification pass, per this phase's own "Template Layer가 발견되지
    않는 경우에는 reason을 기록한다" requirement.
  */
  templateRegionReasons: string[];
};
