/*
  TASK 5 - PDF structural validation via pdfjs-dist (already installed,
  same dynamic-import-of-legacy-build pattern as
  layoutAnalysis/pdfLayoutAnalyzer.ts's analyzePdfLayout()). The
  globalThis.pdfjsWorker guard below is reused verbatim from that
  file's own clearStalePdfjsWorker() (not exported there, so
  duplicated here rather than exporting a private helper across an
  unrelated module boundary) - pdf-parse-new, used elsewhere in this
  same long-lived Node process, can stamp a mismatched fake worker onto
  this process-wide global before pdfjs-dist ever runs, permanently
  breaking every subsequent PDF open in the process unless cleared
  first.

  "blank page" detection: a page whose getTextContent().items is empty
  AND whose operator list contains no paint/fill/stroke/image ops would
  be a genuinely blank page. Professional ATS v1 is text-only (no
  images/backgrounds), so an empty text layer is sufficient evidence of
  a blank page for this template - no operator-list inspection needed.
*/
import type { PdfStructuralValidationResult } from "./types";

const PT_PER_INCH = 72;
const PT_PER_MM = PT_PER_INCH / 25.4;

function clearStalePdfjsWorker() {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

export const EXPECTED_MEDIABOX_PT: Record<"letter" | "a4", { widthPt: number; heightPt: number }> = {
  letter: { widthPt: 8.5 * PT_PER_INCH, heightPt: 11 * PT_PER_INCH },
  a4: { widthPt: 210 * PT_PER_MM, heightPt: 297 * PT_PER_MM },
};

export async function validatePdfStructure(bytes: Uint8Array): Promise<PdfStructuralValidationResult> {
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  const validHeader = header === "%PDF-";

  if (!validHeader || bytes.byteLength === 0) {
    return {
      validHeader,
      parseable: false,
      parseError: validHeader ? "empty byte buffer" : `missing %PDF- header (got "${header}")`,
      encrypted: false,
      pageCount: 0,
      blankPages: [],
      mediaBoxes: [],
    };
  }

  clearStalePdfjsWorker();

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

    const mediaBoxes: PdfStructuralValidationResult["mediaBoxes"] = [];
    const blankPages: number[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const pageIndex = pageNumber - 1;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      mediaBoxes.push({ pageIndex, widthPt: viewport.width, heightPt: viewport.height });

      const textContent = await page.getTextContent();
      const hasText = textContent.items.some((item) => "str" in item && item.str.trim().length > 0);
      if (!hasText) blankPages.push(pageIndex);
    }

    return {
      validHeader: true,
      parseable: true,
      parseError: null,
      encrypted: false,
      pageCount: doc.numPages,
      blankPages,
      mediaBoxes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = /password|encrypt/i.test(message);
    return {
      validHeader: true,
      parseable: false,
      parseError: message,
      encrypted,
      pageCount: 0,
      blankPages: [],
      mediaBoxes: [],
    };
  }
}
