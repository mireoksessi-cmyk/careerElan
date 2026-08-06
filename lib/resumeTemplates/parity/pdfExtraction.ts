/*
  Phase 6F - template-agnostic PDF structural + text extraction for the
  3 NEW templates. Same technique/library as the existing, unmodified
  professionalAtsPdf/pdfStructuralValidator.ts + pdfTextExtraction.ts
  (pdfjs-dist legacy build, dynamic import, the same stale-worker-guard
  pattern) - genuinely re-parses the produced PDF bytes rather than
  trusting the renderer's own bookkeeping, exactly like the existing
  validator does.
*/

function clearStalePdfjsWorker() {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

export type PdfExtractionResult = {
  validHeader: boolean;
  parseable: boolean;
  parseError: string | null;
  pageCount: number;
  blankPageIndices: number[];
  pageTexts: string[];
  fullText: string;
};

export async function extractPdf(bytes: Uint8Array): Promise<PdfExtractionResult> {
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  const validHeader = header === "%PDF-";
  if (!validHeader || bytes.byteLength === 0) {
    return { validHeader, parseable: false, parseError: validHeader ? "empty byte buffer" : `missing %PDF- header (got "${header}")`, pageCount: 0, blankPageIndices: [], pageTexts: [], fullText: "" };
  }

  clearStalePdfjsWorker();

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

    const pageTexts: string[] = [];
    const blankPageIndices: number[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items.filter((item) => "str" in item) as Array<{ str: string }>;
      const text = items.map((item) => item.str).join(" ");
      pageTexts.push(text);
      if (text.trim().length === 0) blankPageIndices.push(pageNumber - 1);
    }

    return { validHeader: true, parseable: true, parseError: null, pageCount: doc.numPages, blankPageIndices, pageTexts, fullText: pageTexts.join("\n") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { validHeader: true, parseable: false, parseError: message, pageCount: 0, blankPageIndices: [], pageTexts: [], fullText: "" };
  }
}
