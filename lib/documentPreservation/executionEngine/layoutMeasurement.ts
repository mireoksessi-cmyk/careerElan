/*
  Document Preservation Engine (DPE) - Phase 4B completion. Real Layout
  Measurement - replaces the earlier character-density ESTIMATION
  entirely with actual headless-browser DOM measurement
  (browserMeasurement.ts) of the real, unmodified Renderer. Unified
  across PDF and DOCX: both measure the SAME final rendered output text,
  not the original source format's own (present-for-PDF-only,
  absent-for-DOCX) geometry - the PDF-vs-DOCX asymmetry that limited the
  earlier version no longer applies here.

  Signature is now async and takes the FINAL rendered text + templateId
  (not ContentBoxes/PageMetadata) - measurement happens after Renderer
  Adapter produces its text, not before, since a real render is the only
  way to get real geometry. See index.ts/retryEngine.ts for the updated
  call order (renderBoxesToResumeText() -> measureLayout()).

  Page geometry constants (210mm x 297mm A4, 15/17mm margins) are the
  same physical values A4DocumentPreview.tsx uses - kept here (not
  imported) for the same reason as before: this phase's own emphasis on
  not touching Renderer files beyond the one new dev-only harness page.
*/
import { measureRenderedLayout } from "./browserMeasurement";
import type {
  BoxMeasurement,
  LayoutMeasurementResult,
  PageMeasurement,
  RealOverlapPair,
} from "./types";

const TOP_MARGIN_MM = 15;
const BOTTOM_MARGIN_MM = 17;
const MM_TO_PX = 96 / 25.4;
const TOP_MARGIN_PX = TOP_MARGIN_MM * MM_TO_PX;
const CONTENT_HEIGHT_PX = (297 - TOP_MARGIN_MM - BOTTOM_MARGIN_MM) * MM_TO_PX;

// Two rects touching at an exact edge (0px real intersection) are not an
// overlap - only a genuine positive-area intersection counts, and only
// beyond this small tolerance (sub-pixel antialiasing/rounding), per
// this phase's own "단순히 경계가 닿는 것은 overlap으로 처리하지 않는다".
const OVERLAP_TOLERANCE_PX = 0.5;

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): { overlapWidth: number; overlapHeight: number } | null {
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

  if (overlapWidth > OVERLAP_TOLERANCE_PX && overlapHeight > OVERLAP_TOLERANCE_PX) {
    return { overlapWidth, overlapHeight };
  }
  return null;
}

export function pageIndexForY(y: number): number {
  return Math.max(0, Math.floor((y - TOP_MARGIN_PX) / CONTENT_HEIGHT_PX));
}

export { CONTENT_HEIGHT_PX, TOP_MARGIN_PX };

const UNMEASURABLE_RESULT: Omit<LayoutMeasurementResult, "measurable" | "unmeasurableReason"> = {
  pages: [],
  rawElements: [],
  pageWindows: [],
  overlapPairs: [],
  totalPageCount: 0,
};

export async function measureLayout(
  finalText: string,
  templateId: string
): Promise<LayoutMeasurementResult> {
  const browserResult = await measureRenderedLayout(finalText, templateId || "classic");

  if (!browserResult.measurable) {
    return {
      ...UNMEASURABLE_RESULT,
      measurable: false,
      unmeasurableReason: browserResult.measurementErrors.join("; ") || "Unknown measurement failure.",
    };
  }

  const elements = browserResult.elements;

  // Real bounding-rect intersection across EVERY pair of leaf elements -
  // O(n^2) but n is a resume's own line/bullet count (tens, not
  // thousands), so this is not a performance concern in practice.
  const overlapPairs: RealOverlapPair[] = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const overlap = rectsOverlap(elements[i], elements[j]);
      if (overlap) {
        overlapPairs.push({ elementAIndex: i, elementBIndex: j, ...overlap });
      }
    }
  }

  const pageCount = Math.max(1, browserResult.totalPageCount);
  const pages: PageMeasurement[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const elementsOnPage = elements.filter((el) => pageIndexForY(el.y) === pageIndex);

    const boxMeasurements: BoxMeasurement[] = elementsOnPage.map((el, idx) => ({
      contentBoxId: `real-el-${pageIndex}-${idx}`,
      available: true,
      lineCount: el.lineHeight > 0 ? Math.max(1, Math.round(el.height / el.lineHeight)) : null,
      renderedWidth: el.width,
      renderedHeight: el.height,
      reason: null,
    }));

    const pageWindow = browserResult.pageWindows[pageIndex];

    pages.push({
      page: pageIndex + 1,
      boxMeasurements,
      contentHeightUsed: pageWindow ? pageWindow.scrollHeight : null,
      contentHeightLimit: pageWindow ? pageWindow.clientHeight : CONTENT_HEIGHT_PX,
    });
  }

  return {
    pages,
    measurable: true,
    unmeasurableReason: null,
    rawElements: elements,
    pageWindows: browserResult.pageWindows,
    overlapPairs,
    totalPageCount: browserResult.totalPageCount,
  };
}
