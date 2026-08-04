/*
  TASK 6 - Per-page native PDF text extraction via pdfjs-dist (same
  clearStalePdfjsWorker guard as pdfStructuralValidator.ts - kept as a
  second copy rather than a shared import so this module has no
  compile-time dependency on the structural validator, matching the
  "single responsibility per file" convention already used across
  professionalAtsHtml/*.ts).
*/
function clearStalePdfjsWorker() {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

export type PdfPageText = {
  pageIndex: number;
  text: string;
};

export async function extractPdfPageText(bytes: Uint8Array): Promise<PdfPageText[]> {
  clearStalePdfjsWorker();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

  const pages: PdfPageText[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push({ pageIndex: pageNumber - 1, text });
  }
  return pages;
}
