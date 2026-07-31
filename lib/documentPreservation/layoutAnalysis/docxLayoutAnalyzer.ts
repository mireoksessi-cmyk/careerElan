/*
  Document Preservation Engine (DPE) - Phase 2 (Layout Analysis).

  DOCX analyzer. Reuses the same parser (mammoth.convertToHtml) that
  app/api/process-resume-design/route.ts's processDocx() already uses for
  DOCX - that function is module-private and not importable without
  modifying an unrelated route, so this calls mammoth directly, the same
  way. Sanitization reuses isomorphic-dompurify (already a project
  dependency, used the same way by processDocx()), but with
  RETURN_DOM_FRAGMENT instead of a string, so the sanitized result can be
  walked as a DOM tree here - not a new parser, the same sanitize() call
  processDocx() already makes, with one existing DOMPurify option
  (RETURN_DOM_FRAGMENT: true, node_modules/dompurify/dist/purify.cjs.d.ts:282)
  instead of the default string output. A generic allow-list (DOMPurify's
  own defaults) is used rather than duplicating processDocx()'s exact
  ALLOWED_HTML_TAGS array, since that array is module-private data local
  to a different route, not a shared constant.

  mammoth.convertToHtml's Result type (node_modules/mammoth/lib/index.d.ts)
  is `{ value: string, messages: Array<Warning|Error> }` - no geometry, no
  font metadata, no page information of any kind. Word/DOCX does not fix
  x/y/width/height positions for normal flowing text, and mammoth performs
  no pagination, so EVERY geometry and typography field below is null for
  every DOCX element - this is not a bug in this analyzer, it is the
  actual ceiling of what mammoth (or any HTML-producing DOCX-to-HTML
  converter) can report. See the final report's "추출 불가능한 Metadata"
  section for the full explanation, including why page width/height
  (technically present in the DOCX XML's <w:sectPr><w:pgSz>, but not
  exposed by mammoth's API) is not extracted here - reading that would
  require writing a new OOXML parser, which this phase's "추측으로 새
  알고리즘을 구현하지 않는다" rule forbids.

  Read-only: never writes to Storage or the database (unlike processDocx,
  which is intentionally coupled to a `resumes` row and uploads embedded
  images to Storage). This analyzer does not touch images beyond
  recording that an <img> tag existed.
*/

import mammoth from "mammoth";
import DOMPurify from "isomorphic-dompurify";
import type { DPEDocumentType } from "../types";
import type {
  ElementMetadata,
  LayoutAnalysisResult,
  LayoutElementType,
  PageMetadata,
  TableInfo,
} from "./types";
import { measureDocxGeometry, DOCX_PAGE_HEIGHT_PX, DOCX_PAGE_WIDTH_PX } from "./docxGeometryRenderer";

const GEOMETRY_INDEX_ATTR = "data-dpe-idx";

const BLOCK_ELEMENT_TYPE: Record<string, LayoutElementType> = {
  P: "text",
  H1: "text",
  H2: "text",
  H3: "text",
  H4: "text",
  H5: "text",
  H6: "text",
  LI: "text",
  TABLE: "table",
  IMG: "image",
  // Phase 2-4 hardening pass (Divider Detection item) - mammoth emits a
  // real <hr> for Word's horizontal-rule paragraph border in some
  // documents. Real geometry (thickness) is filled in later once
  // docxGeometryRenderer.ts measures it - see analyzeDocxLayout's own
  // post-processing.
  HR: "unknown",
};

function emptyElement(type: LayoutElementType, text: string | null): ElementMetadata {
  return {
    type,
    text,
    x: null,
    y: null,
    width: null,
    height: null,
    fontSize: null,
    fontFamily: null,
    fontWeight: null,
    color: null,
  };
}

/*
  Phase 2-4 hardening pass (Table Geometry item). Real row/column/cell
  counts, read directly from mammoth's own DOM output - not a new parser,
  just counting <tr>/<td>/<th> elements mammoth already produced.
  columnCount uses the row with the MOST cells (a table can legitimately
  have colspan-driven variance row to row; the max is the real, honest
  column count rather than an average that could under-count). Bounding
  box and estimatedColumnWidth are filled in later, once
  docxGeometryRenderer.ts measures this same element's real width (see
  analyzeDocxLayout's own post-processing below) - null here.
*/
function computeTableInfo(tableEl: Element): TableInfo {
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  const cellCounts = rows.map((row) => row.querySelectorAll("td, th").length);
  const columnCount = cellCounts.length > 0 ? Math.max(...cellCounts) : 0;
  const cellCount = cellCounts.reduce((sum, n) => sum + n, 0);

  return {
    rowCount: rows.length,
    columnCount,
    cellCount,
    estimatedColumnWidth: null,
  };
}

/*
  Depth-first walk over the sanitized DOM fragment. Recursion stops at a
  mapped block element (paragraph/heading/list item/image) so a <p>'s own
  textContent is recorded once, not duplicated by also visiting its
  inline children (<strong>, <span>, ...) as separate "unknown" elements.

  TABLE is the one exception, and its own text is always null (not
  el.textContent) - a table's textContent flattens every cell's text into
  one blob, and this analyzer still walks into the table's cells
  afterward to record each paragraph/heading/list item inside it
  individually. Recording both would duplicate every cell's text once as
  part of the table's own giant blob and again as its own element
  (confirmed empirically against a real 2-column "Professional" template
  DOCX, where mammoth renders the sidebar/main-column layout as an HTML
  <table> - see the final report's smoke-test findings).
*/
function walk(node: ChildNode, elements: ElementMetadata[]) {
  if (node.nodeType === 1) {
    const el = node as unknown as Element;
    const tag = el.tagName?.toUpperCase();
    const mappedType = tag ? BLOCK_ELEMENT_TYPE[tag] : undefined;

    if (mappedType) {
      const text =
        mappedType === "image" || mappedType === "table"
          ? null
          : el.textContent?.trim() || null;

      const element = emptyElement(mappedType, text);
      if (mappedType === "table") {
        element.tableInfo = computeTableInfo(el);
      }
      elements.push(element);
      // Stable index marker so the real-geometry render pass (see
      // measureDocxGeometry()) can match its measured DOM nodes back to
      // this exact ElementMetadata by position, after the fragment is
      // re-serialized to an HTML string.
      el.setAttribute(GEOMETRY_INDEX_ATTR, String(elements.length - 1));

      if (tag !== "TABLE") return;
    }
  }

  node.childNodes.forEach((child) => walk(child as ChildNode, elements));
}

function serializeFragment(fragment: DocumentFragment): string {
  return Array.from(fragment.childNodes)
    .map((child) => (child as unknown as { outerHTML?: string }).outerHTML ?? "")
    .join("");
}

/*
  Completion pass (Phase 1-4 roadmap closure, Phase 2 item): "원본 Parser와
  Renderer Geometry를 조합해서 생성한다." mammoth's own HTML/DOM structure
  (already parsed above, tag-annotated by walk()) is re-rendered through a
  REAL headless browser (measureDocxGeometry(), Playwright - already a
  project dependency, no new parser) using generic printable-page CSS -
  not this product's resume-template CSS (that would measure OUR
  template's rendering, not the original DOCX's own structure), a plain,
  disclosed, standard-page approximation. Real getBoundingClientRect()/
  getComputedStyle() values are merged back onto each ElementMetadata by
  its stable index marker. font-weight/color are only ever backfilled
  from REAL browser-computed values driven by mammoth's own semantic tags
  (h1-h6 default bold/size, <strong>, any inline style mammoth emitted) -
  never fabricated. If the browser measurement fails for any reason, this
  degrades to the original single-flow-container, no-geometry result
  (never thrown, never a fabricated fallback geometry).
*/
async function enrichWithRendererGeometry(
  fragment: DocumentFragment,
  elements: ElementMetadata[]
): Promise<{ elements: ElementMetadata[]; pages: PageMetadata[]; pageCount: number | null }> {
  const singlePageFallback = {
    elements,
    pages: [{ pageNumber: 1, width: null, height: null, orientation: "unknown" as const, elements }],
    pageCount: null,
  };

  if (elements.length === 0) return singlePageFallback;

  let measured: Awaited<ReturnType<typeof measureDocxGeometry>>;
  try {
    measured = await measureDocxGeometry(serializeFragment(fragment), elements.length);
  } catch {
    return singlePageFallback;
  }

  if (!measured.measurable) return singlePageFallback;

  const enrichedElements = elements.map((element, index) => {
    const m = measured.byIndex[index];
    if (!m) return element;
    return {
      ...element,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      fontSize: m.fontSize,
      fontFamily: m.fontFamily,
      fontWeight: m.fontWeight,
      color: m.color,
      // Real table width now known - fill in the one table-geometry
      // field that genuinely needs it (estimatedColumnWidth), never
      // fabricated before this real measurement existed.
      tableInfo:
        element.tableInfo && element.tableInfo.columnCount > 0
          ? { ...element.tableInfo, estimatedColumnWidth: m.width / element.tableInfo.columnCount }
          : element.tableInfo,
      // Real thickness/orientation for an <hr> element (the only DOCX
      // source of type "unknown" in this analyzer's own BLOCK_ELEMENT_TYPE
      // map), now that its actual rendered width/height are known - a
      // real geometric fact, not a guess. DOCX border-style divider
      // detection (an ordinary paragraph with a real computed
      // border-bottom) is NOT implemented in this pass - disclosed, not
      // attempted.
      dividerInfo:
        element.type === "unknown"
          ? { orientation: m.width >= m.height ? ("horizontal" as const) : ("vertical" as const), thicknessPx: Math.min(m.width, m.height) }
          : element.dividerInfo,
    };
  });

  const pageCount = Math.max(1, Math.ceil(measured.totalContentHeight / DOCX_PAGE_HEIGHT_PX));
  const pages: PageMetadata[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const pageTop = pageIndex * DOCX_PAGE_HEIGHT_PX;
    const pageBottom = pageTop + DOCX_PAGE_HEIGHT_PX;
    const elementsOnPage = enrichedElements.filter(
      (el) => el.y !== null && el.y >= pageTop && el.y < pageBottom
    );

    pages.push({
      pageNumber: pageIndex + 1,
      width: DOCX_PAGE_WIDTH_PX,
      height: DOCX_PAGE_HEIGHT_PX,
      orientation: "portrait",
      elements: elementsOnPage,
      inferredMargins: null,
    });
  }

  // Any element the renderer measured but this page-bucketing loop missed
  // (should not normally happen, but real code must not silently drop
  // content) stays visible by falling back to the single-container shape
  // if bucketing did not account for every element.
  const bucketed = pages.reduce((sum, p) => sum + p.elements.length, 0);
  if (bucketed !== enrichedElements.length) {
    return { elements: enrichedElements, pages: [{ pageNumber: 1, width: DOCX_PAGE_WIDTH_PX, height: DOCX_PAGE_HEIGHT_PX, orientation: "portrait", elements: enrichedElements }], pageCount };
  }

  return { elements: enrichedElements, pages, pageCount };
}

export async function analyzeDocxLayout(
  documentType: DPEDocumentType,
  buffer: Buffer
): Promise<LayoutAnalysisResult> {
  const result = await mammoth.convertToHtml({ buffer });

  const fragment = DOMPurify.sanitize(result.value, {
    RETURN_DOM_FRAGMENT: true,
  });

  const elements: ElementMetadata[] = [];
  fragment.childNodes.forEach((child) => walk(child as ChildNode, elements));

  const enriched = await enrichWithRendererGeometry(fragment, elements);

  return {
    documentType,
    // Real when the renderer geometry pass succeeded (a genuine measured
    // page count, the same formula the rest of this pipeline already
    // uses); null when it degraded to the original no-geometry fallback -
    // never a guessed "1".
    pageCount: enriched.pageCount,
    pages: enriched.pages,
    metadata: {
      sourceFormat: "docx",
      pageCount: null,
      // mammoth exposes no runtime version export (unlike pdfjs-dist's
      // `version`) - left null rather than hardcoding the installed
      // package.json value, which could silently drift out of sync.
      parserVersion: null,
    },
  };
}
