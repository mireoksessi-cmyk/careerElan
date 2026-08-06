/*
  Phase 6F - shared HTML->PDF renderer for the 3 NEW templates. Same
  technique as the existing, unmodified professionalAtsPdf/pdfRenderer.ts:
  real Playwright page.pdf() (Chromium print-to-PDF) over already-built
  HTML, reusing the SAME shared browser singleton - genuine selectable-
  text PDF, never a screenshot/rasterized image.
*/
import { getSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { PAPER_DIMENSIONS } from "../shared/paperSizes";
import type { PaperSize } from "../contracts/types";

export async function renderHtmlToPdfBytes(html: string, paperSize: PaperSize): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const dims = PAPER_DIMENSIONS[paperSize];
    const buffer = await page.pdf({
      width: dims.widthCss,
      height: dims.heightCss,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return buffer;
  } finally {
    await page.close();
  }
}
