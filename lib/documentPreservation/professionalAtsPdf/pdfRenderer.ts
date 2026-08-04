/*
  TASK 4 - Real Playwright page.pdf() renderer. Prints Phase 5A's
  buildPrintablePdfHtml() output on the SAME shared Chromium singleton
  every other Phase 4/DPE consumer uses (sharedBrowser.ts) - this is
  the first caller of page.pdf() anywhere in this codebase (see the
  Phase 5A pre-implementation report's PDF asset audit: page.pdf() was
  previously completely unused/untested here).

  width/height are passed as the exact same CSS length strings
  (PAPER_DIMENSIONS's "8.5in"/"11in"/"210mm"/"297mm") the HTML's own
  `.ats-page` CSS already uses, so there is only ONE source of truth
  for paper size - never a second constant that could drift.
  preferCSSPageSize stays false (default): no @page CSS rule exists in
  this HTML, so width/height fully control page size.

  printBackground: true preserves `.ats-page`'s white background
  (Chromium omits all backgrounds by default otherwise) - safe here
  since professional-ats-v1 has no other background/branding to worry
  about leaking into print.
*/
import { getSharedBrowser } from "../sharedBrowser";
import { buildPrintablePdfHtml } from "./printableHtml";
import { PAPER_DIMENSIONS } from "../professionalAtsHtml/designTokens";
import type { PaginationPlan, PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

const RENDER_TIMEOUT_MS = 20_000;

export async function renderProfessionalAtsPdf(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<Uint8Array> {
  const paper = PAPER_DIMENSIONS[paperSize];
  const html = await buildPrintablePdfHtml(assembly, plan, paperSize, density);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);

    const buffer = await page.pdf({
      width: paper.width,
      height: paper.height,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return new Uint8Array(buffer);
  } finally {
    await page.close();
  }
}
