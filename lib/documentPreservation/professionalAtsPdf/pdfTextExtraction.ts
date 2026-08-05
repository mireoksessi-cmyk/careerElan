/*
  TASK 6 - Per-page native PDF text extraction via pdfjs-dist (same
  clearStalePdfjsWorker guard as pdfStructuralValidator.ts - kept as a
  second copy rather than a shared import so this module has no
  compile-time dependency on the structural validator, matching the
  "single responsibility per file" convention already used across
  professionalAtsHtml/*.ts).

  Phase 5C.1 fix: pdfjs's getTextContent() splits a single visually-
  continuous run of characters into multiple TextItems whenever
  Chromium's print pipeline emits separate text-showing operators for
  it (observed for long unbroken tokens like URLs - completely
  independent of any CSS line-wrapping, confirmed by reproducing the
  same item-splitting with and without overflow-wrap on the source
  HTML). The original unconditional `.join(" ")` inserted a bogus
  space between every such split, corrupting otherwise-intact long
  tokens (e.g. "https://example.com" -> "https //example com"). Items
  are now joined with a space ONLY when there's a real gap between
  them (different line, per hasEOL/y-position, or an actual horizontal
  gap wider than a fraction of the font size) - immediately-adjacent
  glyph runs on the same baseline are concatenated directly, matching
  how the text visually reads.
*/
function clearStalePdfjsWorker() {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

export type PdfPageText = {
  pageIndex: number;
  text: string;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

function hasTextFields(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

function joinTextItems(items: PdfTextItem[]): string {
  let text = "";
  let prev: PdfTextItem | null = null;
  for (const item of items) {
    if (item.str.length === 0) continue;
    if (prev) {
      const prevY = prev.transform[5];
      const curY = item.transform[5];
      const sameLine = Math.abs(curY - prevY) < Math.max(1, prev.height * 0.3);
      if (prev.hasEOL || !sameLine) {
        text += " ";
      } else {
        const prevEndX = prev.transform[4] + prev.width;
        const gap = item.transform[4] - prevEndX;
        const fontSize = Math.abs(prev.transform[0]) || prev.height || 10;
        if (gap > fontSize * 0.15) text += " ";
      }
    }
    text += item.str;
    prev = item;
  }
  return text;
}

export async function extractPdfPageText(bytes: Uint8Array): Promise<PdfPageText[]> {
  clearStalePdfjsWorker();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

  const pages: PdfPageText[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = (textContent.items as unknown[]).filter(hasTextFields);
    pages.push({ pageIndex: pageNumber - 1, text: joinTextItems(items) });
  }
  return pages;
}
