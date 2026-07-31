/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  These types describe the shape DPE will eventually populate once Layout
  Analysis (PDF/DOCX bounding boxes, font/column/table detection, Phase 2+)
  exists. Phase 1 defines the interface only - nothing in this repo
  constructs a DPEDocument with real geometry yet, and DPELayout/DPEElement
  are intentionally minimal so a later phase can extend them without
  guessing at a geometry schema now.

  Reuse note: this is NOT a replacement for lib/brand/types.ts's
  DocumentIR (the existing, working section/bullet model parsed from
  Generate Package's flat output text). DocumentIR remains the input to
  the existing Renderer and is unchanged. DPEDocument is a separate,
  higher-level wrapper describing the ORIGINAL uploaded document that a
  future phase will map generated text onto - see rendererAdapter.ts for
  how the two connect.
*/

/*
  Extensible on purpose (see the master DPE spec's "Future Expansion"
  section): more document types (Personal Statement, SOP, Recommendation
  Letter, ...) get added here later, not as a parallel type.
*/
export type DPEDocumentType = "resume" | "cover_letter";

/*
  Populated starting in the Layout Analysis phase (PDF/DOCX bounding
  boxes, font metadata, column/table structure). Left empty in Phase 1 -
  do not add fields here by guessing at a shape; the phase that
  implements Layout Analysis defines this based on what the parser can
  actually extract.
*/
export type DPELayout = Record<string, never>;

export type DPEElementType = "text" | "image" | "table" | "unknown";

/*
  One region of the original document. `editable`/`protected` and the
  source/replacement text fields exist now so later phases (Editable Text
  Layer separation, Text Replacement) have a place to write into without
  a breaking type change - Phase 1 never sets replacementText itself.
*/
export type DPEElement = {
  id: string;
  type: DPEElementType;
  editable: boolean;
  protected: boolean;
  sourceText?: string;
  replacementText?: string;
};

export type DPEPage = {
  pageIndex: number;
  elements: DPEElement[];
};

export type DPEMetadata = {
  /*
    Reserved for a future sourceDocumentId column/concept. The
    investigation for this DPE effort confirmed no such field currently
    exists anywhere in the schema or app code (resumes.id /
    cover_letters.id are the closest things) - kept nullable so Phase 1
    doesn't invent a new identifier scheme.
  */
  sourceDocumentId: string | null;
  documentType: DPEDocumentType;
  originalFileType?: string | null;
};

export type DPEDocument = {
  documentType: DPEDocumentType;
  metadata: DPEMetadata;
  pages: DPEPage[];
  layout: DPELayout;
};
