/*
  Document Preservation Engine (DPE) - Phase 2 (Layout Analysis).

  Read-only analysis result types. LayoutAnalysisResult is intentionally
  NOT wired into Phase 1's DPEDocument/DPELayout (lib/documentPreservation/
  types.ts) yet - Phase 1's files are unmodified this phase (see the final
  report). A later phase decides how Layout Analysis output maps onto
  DPEDocument once Content Box / Template Layer work begins.

  documentType reuses Phase 1's DPEDocumentType rather than a new parallel
  union - the only cross-reference this phase takes into lib/documentPreservation.
*/
import type { DPEDocumentType } from "../types";

export type LayoutSourceFormat = "pdf" | "docx";

export type PageOrientation = "portrait" | "landscape" | "unknown";

export type LayoutElementType = "text" | "image" | "table" | "unknown";

/*
  Every geometry/typography field is nullable on purpose. Phase 2's own
  spec: "존재하지 않는 정보는 추측으로 생성하지 않는다 - nullable 또는
  unknown으로 둔다." A field is populated only when the underlying parser
  (pdfjs-dist for PDF, mammoth for DOCX) actually returns that value at
  runtime - see pdfLayoutAnalyzer.ts / docxLayoutAnalyzer.ts for exactly
  which fields each parser can and cannot supply.
*/
/*
  Phase 2-4 hardening pass (Table Geometry item). Real, derivable table
  structure - never a claim about the source document's authored table
  design. `estimatedColumnWidth` is exactly what its name says
  (width / columnCount), not a per-column measurement (neither parser
  exposes per-column boundaries directly - see each analyzer's own
  comment on how rowCount/columnCount/cellCount were actually obtained).
*/
export type TableInfo = {
  rowCount: number;
  columnCount: number;
  cellCount: number;
  estimatedColumnWidth: number | null;
};

/*
  Phase 2-4 hardening pass (PDF Image Geometry item). Real decomposition
  of the Current Transformation Matrix active when a PDF image was
  painted (standard 2D affine decomposition - rotationDegrees =
  atan2(b,a), scale = sqrt(a^2+b^2)/sqrt(c^2+d^2) - not a heuristic, the
  actual math for what that matrix does to the image). `clipped`/
  `visibleWidth`/`visibleHeight` are only ever populated when the active
  clip region (if any) was a SIMPLE axis-aligned rectangle (PDF's `re`
  operator) - a curved/complex clip path is not tracked (would require a
  full path rasterizer, out of this phase's scope) and leaves these
  fields null, never a guessed intersection.
*/
export type ImageInfo = {
  rotationDegrees: number;
  scaleX: number;
  scaleY: number;
  clipped: boolean;
  visibleWidth: number | null;
  visibleHeight: number | null;
};

/*
  Phase 2-4 hardening pass (Divider Detection item). PDF: a thin filled
  or stroked rectangle (OPS.rectangle immediately followed by a
  fill/stroke operator, not a clip - see pdfLayoutAnalyzer.ts's own
  comment), real CTM-transformed geometry, classified thin/not-thin by a
  real aspect-ratio threshold - never inferred from text. DOCX: an <hr>
  tag, or a real computed border-* CSS property from the Playwright
  render (docxGeometryRenderer.ts measures real getComputedStyle(), so a
  genuine border width > 0 is a real signal, not a guess).
*/
export type DividerInfo = {
  orientation: "horizontal" | "vertical";
  thicknessPx: number;
};

export type ElementMetadata = {
  type: LayoutElementType;
  text: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  fontSize: number | null;
  fontFamily: string | null;
  fontWeight: string | null;
  color: string | null;
  tableInfo?: TableInfo | null;
  imageInfo?: ImageInfo | null;
  dividerInfo?: DividerInfo | null;
};

/*
  Not the document's authored margin/padding (PDF/DOCX expose no such
  property to read - a page is just a canvas of positioned content, and
  DOCX's own <w:pgMar> is inside the OOXML XML mammoth never parses).
  This is the page's REAL, OBSERVED content bounding box vs. the page's
  own bounds - i.e. "how much blank space surrounds the actual content on
  this page" - a real, derivable quantity, explicitly disclosed as
  inferred rather than a claim about the source document's own layout
  properties (Phase 2 completion pass's "가능한 정보는... 조합해서
  생성한다").
*/
/*
  Phase 2-4 hardening pass: `confidence` distinguishes a margin backed by
  a real REPEATED block-start position (multiple elements' edges cluster
  at the same X/Y, i.e. this is genuinely where most content aligns to)
  from the earlier, cruder single min/max-of-all-elements estimate (only
  "high" when that mode/majority pattern was actually found - otherwise
  "low", still using min/max as the honest fallback, never silently
  upgraded).
*/
export type InferredMargins = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  confidence: "high" | "low";
};

export type PageMetadata = {
  pageNumber: number;
  width: number | null;
  height: number | null;
  orientation: PageOrientation;
  elements: ElementMetadata[];
  inferredMargins?: InferredMargins | null;
};

export type DocumentMetadata = {
  sourceFormat: LayoutSourceFormat;
  /*
    Duplicated at the LayoutAnalysisResult top level too, per this phase's
    own spec listing "pageCount" under both the top-level result (item 4)
    and Document Metadata (item 7) - kept as two fields rather than
    reconciled into one, so neither example from the spec is dropped.
  */
  pageCount: number | null;
  /*
    The actual installed parser library's version string, read from its
    own runtime export when one exists (pdfjs-dist exports `version`).
    Left null when the library exposes no such export (mammoth does not) -
    never hardcoded from package.json, to avoid silently drifting from
    whatever version is actually running.
  */
  parserVersion: string | null;
};

export type LayoutAnalysisResult = {
  documentType: DPEDocumentType;
  pageCount: number | null;
  pages: PageMetadata[];
  metadata: DocumentMetadata;
};

export type LayoutAnalyzerInput = {
  documentType: DPEDocumentType;
  buffer: Buffer;
};

/*
  Every LayoutAnalyzer (PDF, DOCX) implements this same shape - analyze()
  only reads the buffer and returns a result; it never mutates, reorders,
  or renders anything (see this phase's "Analyzer는 Read Only" design
  principle).
*/
export type LayoutAnalyzer = {
  sourceFormat: LayoutSourceFormat;
  analyze: (input: LayoutAnalyzerInput) => Promise<LayoutAnalysisResult>;
};
