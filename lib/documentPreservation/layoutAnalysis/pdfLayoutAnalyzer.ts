/*
  Document Preservation Engine (DPE) - Phase 2 (Layout Analysis).

  PDF analyzer. Uses the same library and the same core calls as
  app/api/process-resume-design/route.ts's processPdf() (and its
  cover-letter twin, app/api/process-cover-letter-design/route.ts) -
  pdfjs-dist's getDocument() / page.getTextContent() / page.getViewport().
  That function is not exported (module-private inside the route file),
  so it could not be imported directly without modifying an unrelated
  route - seemingly re-implemented, but the extraction technique itself
  is reused verbatim, not redesigned. See the final report's "기존
  Parser의 한계" section.

  New in this analyzer, beyond what processPdf() currently reads off the
  same pdfjs TextItem/TextContent objects: `width`, `height`, and
  `fontFamily` (via TextContent.styles[fontName].fontFamily) - all three
  are real fields pdfjs-dist 6.1.200's own TextItem/TextStyle types
  declare (node_modules/pdfjs-dist/types/src/display/api.d.ts), simply
  unused by the existing preview route. `fontWeight` and `color` are NOT
  available anywhere in this API and are always null - not guessed from
  font-name substrings like "Bold".

  Read-only: never writes to Storage or the database (unlike processPdf,
  which is intentionally coupled to a `resumes` row). No page cap or
  timeout wrapper either - both are operational concerns specific to the
  existing route's own HTTP request lifecycle (Netlify's 45s budget,
  MAX_PDF_PAGES), not a property of "analyze this document."
*/

import type { DPEDocumentType } from "../types";
import type {
  ElementMetadata,
  InferredMargins,
  LayoutAnalysisResult,
  PageMetadata,
  TableInfo,
  PageOrientation,
} from "./types";

/*
  Completion pass (Phase 1-4 roadmap closure, Phase 2 item): real image
  geometry, via pdfjs-dist's OWN already-computed operator list
  (page.getOperatorList()) - not a new parser, deeper use of the same
  already-integrated library's existing public API. A PDF image is always
  painted into the unit square [0,1]x[0,1] under whatever Current
  Transformation Matrix (CTM) is active at the moment of the paint
  operator (PDF spec's imaging model - the image's own intrinsic pixel
  dimensions only affect resolution, never page-space placement), so
  tracking `save`/`restore`/`transform` operators to maintain a running
  CTM and applying it to the unit square's 4 corners gives the REAL
  on-page bounding box - straightforward affine math on data pdfjs itself
  already parsed, not a heuristic guess. If pdfjs's own operator list is
  ever missing an expected arg shape, that single image is skipped rather
  than guessed at.
*/
type Matrix = [number, number, number, number, number, number];
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

type ClipBounds = { left: number; right: number; top: number; bottom: number };

function intersectBounds(a: ClipBounds, b: ClipBounds): ClipBounds {
  return {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    top: Math.min(a.top, b.top),
  };
}

// Real 2D affine decomposition (ignoring the CTM's translation
// components e/f, which don't affect rotation/scale) - standard matrix
// math, not a heuristic: a PDF CTM [a b; c d] maps the unit basis
// vectors (1,0) and (0,1) to (a,b) and (c,d); their lengths are the real
// scale factors, and atan2(b,a) is the real rotation of the x-axis.
function decomposeRotationScale(ctm: Matrix): { rotationDegrees: number; scaleX: number; scaleY: number } {
  const [a, b, c, d] = ctm;
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotationRadians = Math.atan2(b, a);
  return { rotationDegrees: (rotationRadians * 180) / Math.PI, scaleX, scaleY };
}

// PDFPageProxy is not part of pdfjs-dist's flat public export surface
// under legacy/build/pdf.mjs (same reason the text-extraction code below
// already uses `any` for TextItem) - typed structurally via the one
// method this function actually calls instead.
async function extractPdfImageElements(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }> },
  viewportHeight: number
): Promise<ElementMetadata[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { OPS } = pdfjs;

  const opList = await page.getOperatorList();
  const images: ElementMetadata[] = [];

  const stack: { ctm: Matrix; clip: ClipBounds | null }[] = [];
  let ctm: Matrix = IDENTITY_MATRIX;
  let clip: ClipBounds | null = null;
  // Set by OPS.rectangle, read (not necessarily cleared) by whichever
  // operator follows - a clip (W/W*), a fill (f/f*), a stroke (S), or
  // real PDFs sometimes several of these in sequence for the SAME
  // declared rectangle. The next OPS.rectangle simply overwrites this
  // before the next shape, so no explicit invalidation is needed.
  let pendingRect: ClipBounds | null = null;

  const DIVIDER_THIN_PX = 3;
  const DIVIDER_MIN_LENGTH_PX = 20;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      stack.push({ ctm, clip });
    } else if (fn === OPS.restore) {
      const popped = stack.pop();
      ctm = popped?.ctm ?? IDENTITY_MATRIX;
      clip = popped?.clip ?? null;
    } else if (fn === OPS.transform && Array.isArray(args) && args.length === 6) {
      const [a, b, c, d, e, f] = args as number[];
      ctm = multiplyMatrix([a, b, c, d, e, f], ctm);
    } else if (fn === OPS.rectangle && Array.isArray(args) && args.length === 4) {
      const [rx, ry, rw, rh] = args as number[];
      const corners = [
        applyMatrix(ctm, rx, ry),
        applyMatrix(ctm, rx + rw, ry),
        applyMatrix(ctm, rx, ry + rh),
        applyMatrix(ctm, rx + rw, ry + rh),
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      pendingRect = { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
    } else if ((fn === OPS.clip || fn === OPS.eoClip) && pendingRect) {
      clip = clip ? intersectBounds(clip, pendingRect) : pendingRect;
    } else if (
      (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fillStroke || fn === OPS.closeFillStroke) &&
      pendingRect
    ) {
      // A thin filled/stroked rectangle is the real, existing-data signal
      // for a drawn divider line (PDF has no dedicated "line" primitive -
      // a horizontal/vertical rule is conventionally drawn as exactly
      // this shape). Real dimension check, not a guess: one axis must be
      // very thin AND the other must be a real, non-trivial length -
      // otherwise this is just an ordinary small filled shape (a bullet
      // glyph, a checkbox), not a divider.
      const width = pendingRect.right - pendingRect.left;
      const height = pendingRect.top - pendingRect.bottom;

      if (height <= DIVIDER_THIN_PX && width >= DIVIDER_MIN_LENGTH_PX) {
        images.push({
          type: "unknown",
          text: null,
          x: pendingRect.left,
          y: viewportHeight - pendingRect.top,
          width,
          height,
          fontSize: null,
          fontFamily: null,
          fontWeight: null,
          color: null,
          dividerInfo: { orientation: "horizontal", thicknessPx: height },
        });
      } else if (width <= DIVIDER_THIN_PX && height >= DIVIDER_MIN_LENGTH_PX) {
        images.push({
          type: "unknown",
          text: null,
          x: pendingRect.left,
          y: viewportHeight - pendingRect.top,
          width,
          height,
          fontSize: null,
          fontFamily: null,
          fontWeight: null,
          color: null,
          dividerInfo: { orientation: "vertical", thicknessPx: width },
        });
      }
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const corners = [
        applyMatrix(ctm, 0, 0),
        applyMatrix(ctm, 1, 0),
        applyMatrix(ctm, 0, 1),
        applyMatrix(ctm, 1, 1),
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      // PDF user space is bottom-left origin; this analyzer's own
      // convention (matching the text extraction just below) is
      // top-left, via the same "viewportHeight - y" flip.
      const topPdf = Math.max(...ys);
      const bottomPdf = Math.min(...ys);

      const width = right - left;
      const height = topPdf - bottomPdf;
      if (!(width > 0) || !(height > 0)) continue;

      const { rotationDegrees, scaleX, scaleY } = decomposeRotationScale(ctm);

      let clipped = false;
      let visibleWidth: number | null = null;
      let visibleHeight: number | null = null;
      if (clip) {
        const visible = intersectBounds(clip, { left, right, top: topPdf, bottom: bottomPdf });
        visibleWidth = Math.max(0, visible.right - visible.left);
        visibleHeight = Math.max(0, visible.top - visible.bottom);
        clipped = visibleWidth < width - 0.5 || visibleHeight < height - 0.5;
      }

      images.push({
        type: "image",
        text: null,
        x: left,
        y: viewportHeight - topPdf,
        width,
        height,
        fontSize: null,
        fontFamily: null,
        fontWeight: null,
        color: null,
        imageInfo: { rotationDegrees, scaleX, scaleY, clipped, visibleWidth, visibleHeight },
      });
    }
  }

  return images;
}

const MARGIN_MODE_BUCKET_PX = 3;
// A mode needs to cover a real, meaningful share of all blocks (not just
// 2 elements coincidentally sharing a position) to count as a genuine
// "most content aligns here" signal, rather than the min/max fallback.
const MARGIN_MODE_MIN_SHARE = 0.3;

/*
  Real mode (most frequent value, bucketed to MARGIN_MODE_BUCKET_PX) of a
  set of edge positions - "where most blocks actually start", a more
  robust real signal than a single min/max outlier (e.g. one page-number
  block sitting closer to the edge than every other block would badly
  skew a min/max-only margin). Falls back to the given extremum function
  when no value's share of the total meets MARGIN_MODE_MIN_SHARE -
  disclosed via the returned confidence, never silently treated as
  equally reliable.
*/
function modeOrExtremum(
  values: number[],
  extremum: (values: number[]) => number
): { value: number; highConfidence: boolean } {
  const buckets = new Map<number, number[]>();
  for (const v of values) {
    const b = Math.round(v / MARGIN_MODE_BUCKET_PX);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(v);
  }

  let bestBucketValues: number[] | null = null;
  for (const bucketValues of buckets.values()) {
    if (!bestBucketValues || bucketValues.length > bestBucketValues.length) {
      bestBucketValues = bucketValues;
    }
  }

  if (bestBucketValues && bestBucketValues.length / values.length >= MARGIN_MODE_MIN_SHARE) {
    return { value: extremum(bestBucketValues), highConfidence: true };
  }

  return { value: extremum(values), highConfidence: false };
}

function inferPageMargins(elements: ElementMetadata[], pageWidth: number, pageHeight: number): InferredMargins | null {
  const withGeometry = elements.filter(
    (el) => el.x !== null && el.y !== null && el.width !== null && el.height !== null
  );
  if (withGeometry.length === 0) return null;

  const lefts = withGeometry.map((el) => el.x as number);
  const tops = withGeometry.map((el) => el.y as number);
  const rights = withGeometry.map((el) => (el.x as number) + (el.width as number));
  const bottoms = withGeometry.map((el) => (el.y as number) + (el.height as number));

  const leftResult = modeOrExtremum(lefts, (vals) => Math.min(...vals));
  const topResult = modeOrExtremum(tops, (vals) => Math.min(...vals));
  const rightResult = modeOrExtremum(rights, (vals) => Math.max(...vals));
  const bottomResult = modeOrExtremum(bottoms, (vals) => Math.max(...vals));

  const allHighConfidence =
    leftResult.highConfidence && topResult.highConfidence && rightResult.highConfidence && bottomResult.highConfidence;

  return {
    top: Math.max(0, topResult.value),
    left: Math.max(0, leftResult.value),
    right: Math.max(0, pageWidth - rightResult.value),
    bottom: Math.max(0, pageHeight - bottomResult.value),
    confidence: allHighConfidence ? "high" : "low",
  };
}

/*
  Phase 2-4 hardening pass (Table Geometry item, PDF side). PDF has no
  native "table" element (pdfjs only ever gives real positioned text
  runs) - a genuine grid is only detectable as a REAL geometric pattern:
  3+ rows (Y-bands) each containing elements whose LEFT edges align
  (within a small tolerance) to the SAME 2+ X positions across every one
  of those rows. This is deliberately conservative (real resumes rarely
  contain an actual grid; date-aligned bullet lists do NOT qualify
  because they only share ONE common X, not 2+) - a page with no such
  repeating multi-column grid correctly reports no table candidate,
  never a guessed one. Synthesized as an ADDITIONAL element (never
  replacing the real text elements already extracted).
*/
const TABLE_X_TOLERANCE_PX = 3;
const TABLE_Y_BAND_TOLERANCE_PX = 4;
const TABLE_MIN_ROWS = 3;
const TABLE_MIN_COLUMNS = 2;

function detectPdfTableCandidates(elements: ElementMetadata[]): ElementMetadata[] {
  const withGeometry = elements.filter(
    (el): el is ElementMetadata & { x: number; y: number; width: number; height: number } =>
      el.x !== null && el.y !== null && el.width !== null && el.height !== null
  );
  if (withGeometry.length === 0) return [];

  // Group into Y-bands (rows) first.
  const sorted = [...withGeometry].sort((a, b) => a.y - b.y);
  const rows: (typeof withGeometry)[] = [];
  for (const el of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(el.y - lastRow[0].y) <= TABLE_Y_BAND_TOLERANCE_PX) {
      lastRow.push(el);
    } else {
      rows.push([el]);
    }
  }

  if (rows.length < TABLE_MIN_ROWS) return [];

  // Real shared X positions: bucket every element's left edge, then find
  // buckets present in at least TABLE_MIN_ROWS different rows.
  const bucketOf = (x: number) => Math.round(x / TABLE_X_TOLERANCE_PX);
  const bucketToRows = new Map<number, Set<number>>();
  rows.forEach((row, rowIndex) => {
    for (const el of row) {
      const b = bucketOf(el.x);
      if (!bucketToRows.has(b)) bucketToRows.set(b, new Set());
      bucketToRows.get(b)!.add(rowIndex);
    }
  });

  const sharedBuckets = Array.from(bucketToRows.entries()).filter(([, rowSet]) => rowSet.size >= TABLE_MIN_ROWS);
  if (sharedBuckets.length < TABLE_MIN_COLUMNS) return [];

  // Rows that actually participate in the shared grid (appear in at
  // least TABLE_MIN_COLUMNS of the shared buckets).
  const participatingRowIndices = new Set<number>();
  for (const [, rowSet] of sharedBuckets) {
    for (const rowIndex of rowSet) participatingRowIndices.add(rowIndex);
  }
  const gridRows = Array.from(participatingRowIndices).map((i) => rows[i]);
  if (gridRows.length < TABLE_MIN_ROWS) return [];

  const gridElements = gridRows.flat();
  const x = Math.min(...gridElements.map((el) => el.x));
  const y = Math.min(...gridElements.map((el) => el.y));
  const right = Math.max(...gridElements.map((el) => el.x + el.width));
  const bottom = Math.max(...gridElements.map((el) => el.y + el.height));

  const tableInfo: TableInfo = {
    rowCount: gridRows.length,
    columnCount: sharedBuckets.length,
    cellCount: gridElements.length,
    estimatedColumnWidth: (right - x) / sharedBuckets.length,
  };

  return [
    {
      type: "table",
      text: null,
      x,
      y,
      width: right - x,
      height: bottom - y,
      fontSize: null,
      fontFamily: null,
      fontWeight: null,
      color: null,
      tableInfo,
    },
  ];
}

/*
  Same globalThis.pdfjsWorker guard as processPdf() in
  app/api/process-resume-design/route.ts (reused verbatim, not
  rediscovered) - pdf-parse-new, used elsewhere in this same long-lived
  Node process by lib/documentAnalysis/resumeAnalysisCore.ts, can stamp a
  mismatched fake worker onto this process-wide global before pdfjs-dist
  ever runs, permanently breaking every PDF open in the process. See that
  file's comment for the full diagnosis.
*/
function clearStalePdfjsWorker() {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

function resolveOrientation(width: number, height: number): PageOrientation {
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "unknown";
}

export async function analyzePdfLayout(
  documentType: DPEDocumentType,
  buffer: Buffer
): Promise<LayoutAnalysisResult> {
  clearStalePdfjsWorker();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages: PageMetadata[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    // pdfjs-dist's TextItem type is not part of its public export surface
    // (only reachable via an internal types/ path) - process-resume-design/
    // route.ts's own processPdf() has the same `any` for the same reason.
    const elements: ElementMetadata[] = textContent.items
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any) =>
          typeof item.str === "string" && item.str.trim().length > 0
      )
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any): ElementMetadata => {
          const style = textContent.styles?.[item.fontName];

          return {
            type: "text",
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            width: typeof item.width === "number" ? item.width : null,
            height: typeof item.height === "number" ? item.height : null,
            fontSize: Math.abs(item.transform[3]) || null,
            fontFamily: style?.fontFamily ?? null,
            fontWeight: null,
            color: null,
          };
        }
      );

    let imageElements: ElementMetadata[] = [];
    try {
      imageElements = await extractPdfImageElements(page, viewport.height);
    } catch {
      // A malformed/unusual operator list must never break text
      // extraction, which this analyzer's callers actually depend on -
      // images are a real-but-optional enrichment (Phase 2 completion),
      // so failure here degrades to "no image elements this page", not a
      // thrown error.
      imageElements = [];
    }

    const tableElements = detectPdfTableCandidates(elements);
    const allElements = [...elements, ...imageElements, ...tableElements];

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      orientation: resolveOrientation(viewport.width, viewport.height),
      elements: allElements,
      inferredMargins: inferPageMargins(allElements, viewport.width, viewport.height),
    });
  }

  return {
    documentType,
    pageCount: doc.numPages,
    pages,
    metadata: {
      sourceFormat: "pdf",
      pageCount: doc.numPages,
      parserVersion: typeof pdfjs.version === "string" ? pdfjs.version : null,
    },
  };
}
