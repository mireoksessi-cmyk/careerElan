/*
  Document Preservation Engine (DPE) - Layout Analysis (Phase 2 completion
  pass, Phase 1-4 roadmap-closure effort). Real geometry for DOCX-derived
  content, via a headless-browser render of mammoth's OWN HTML/DOM
  structure (docxLayoutAnalyzer.ts's already-sanitized fragment, tag-
  annotated with `data-dpe-idx`) - not this product's resume-template CSS
  (measuring that would describe OUR template, not the original DOCX),
  and not a new DOCX parser (mammoth's own output is the only input read
  here).

  Page geometry is a disclosed GENERIC approximation (A4 @ 96dpi, 20mm
  margins, a plain sans-serif stack) - the actual DOCX page size/margins
  live in <w:sectPr> XML mammoth's API never exposes (see
  docxLayoutAnalyzer.ts's own comment on why reading that would require a
  new OOXML parser, forbidden). This is "as close as the existing parser
  allows", not a claim of the source document's real page setup.
*/
import { getSharedBrowser } from "../sharedBrowser";

const MM_TO_PX = 96 / 25.4;
export const DOCX_PAGE_WIDTH_PX = Math.round(210 * MM_TO_PX);
export const DOCX_PAGE_HEIGHT_PX = Math.round(297 * MM_TO_PX);
const MARGIN_PX = Math.round(20 * MM_TO_PX);

const MEASURE_TIMEOUT_MS = 15_000;

export type DocxElementGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number | null;
  fontFamily: string | null;
  fontWeight: string | null;
  color: string | null;
};

export type DocxGeometryMeasurement = {
  measurable: boolean;
  byIndex: Record<number, DocxElementGeometry>;
  totalContentHeight: number;
};

function buildGenericPageHtml(annotatedFragmentHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #dpe-docx-page {
    width: ${DOCX_PAGE_WIDTH_PX}px;
    padding: ${MARGIN_PX}px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #1a1a1a;
  }
  #dpe-docx-page h1 { font-size: 20pt; font-weight: 700; margin: 0 0 8px; }
  #dpe-docx-page h2 { font-size: 16pt; font-weight: 700; margin: 10px 0 6px; }
  #dpe-docx-page h3 { font-size: 13pt; font-weight: 700; margin: 8px 0 4px; }
  #dpe-docx-page h4, #dpe-docx-page h5, #dpe-docx-page h6 { font-size: 11pt; font-weight: 700; margin: 6px 0 4px; }
  #dpe-docx-page p { margin: 0 0 6px; }
  #dpe-docx-page li { margin: 0 0 4px; }
  #dpe-docx-page table { border-collapse: collapse; width: 100%; }
  #dpe-docx-page img { max-width: 100%; }
</style>
</head>
<body>
  <div id="dpe-docx-page">${annotatedFragmentHtml}</div>
</body>
</html>`;
}

export async function measureDocxGeometry(
  annotatedFragmentHtml: string,
  expectedCount: number
): Promise<DocxGeometryMeasurement> {
  if (expectedCount === 0) {
    return { measurable: false, byIndex: {}, totalContentHeight: 0 };
  }

  let browser;
  try {
    browser = await getSharedBrowser();
  } catch {
    return { measurable: false, byIndex: {}, totalContentHeight: 0 };
  }

  const page = await browser.newPage({ viewport: { width: DOCX_PAGE_WIDTH_PX + 100, height: 1200 } });

  try {
    await page.setContent(buildGenericPageHtml(annotatedFragmentHtml), {
      waitUntil: "domcontentloaded",
      timeout: MEASURE_TIMEOUT_MS,
    });

    const result = await page.evaluate(() => {
      const container = document.getElementById("dpe-docx-page");
      if (!container) return { error: "container not found" };

      const nodes = Array.from(container.querySelectorAll("[data-dpe-idx]")) as HTMLElement[];
      const byIndex: Record<number, unknown> = {};

      for (const node of nodes) {
        const idxAttr = node.getAttribute("data-dpe-idx");
        if (idxAttr === null) continue;
        const idx = Number(idxAttr);
        if (!Number.isFinite(idx)) continue;

        const rect = node.getBoundingClientRect();
        const cs = getComputedStyle(node);

        byIndex[idx] = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fontSize: parseFloat(cs.fontSize) || null,
          fontFamily: cs.fontFamily || null,
          fontWeight: cs.fontWeight || null,
          color: cs.color || null,
        };
      }

      return {
        byIndex,
        totalContentHeight: container.scrollHeight,
      };
    });

    if ("error" in result) {
      return { measurable: false, byIndex: {}, totalContentHeight: 0 };
    }

    return {
      measurable: true,
      byIndex: result.byIndex as Record<number, DocxElementGeometry>,
      totalContentHeight: result.totalContentHeight,
    };
  } catch {
    return { measurable: false, byIndex: {}, totalContentHeight: 0 };
  } finally {
    await page.close();
  }
}
