/*
  TASK 4 - Wraps Phase 4's buildPaginatedPageHtml() output with a
  print-only <style media="print"> block, injected via plain string
  splicing (no re-parsing/re-rendering of the content tree). Phase 4's
  paginatedHtmlString.ts is NOT modified - this stays a Phase-5A-local
  file so Phase 4's own committed gate is never re-opened for a new,
  unrelated consumer.

  What changes for print, and why (see the Phase 5A pre-implementation
  report's section 6/PDF asset audit for the full reasoning):
  - `html, body { background: #fff }` removes the #e5e5e5 screen-preview
    backdrop, which would otherwise print as a solid grey PDF page
    background/border.
  - `.ats-page { margin: 0 }` removes the `0 auto 16px` screen-stacking
    centering/gap - meaningless once each `.ats-page` becomes its own
    physical PDF page.
  - `.ats-page { break-after: page }` (except the last) forces Chromium's
    print engine to start a new physical page at each `.ats-page`
    boundary - nothing in the screen CSS does this (it relies on
    min-height + real content height for on-screen separation only).

  page.pdf() implicitly renders using the 'print' CSS media type, so
  this block activates automatically without any page.emulateMedia()
  call at the renderer call site.

  Content, text, section order, and density are untouched - this is a
  pure presentational splice for physical-page-boundary control.
*/
import { buildPaginatedPageHtml } from "../professionalAtsHtml/paginatedHtmlString";
import type { PaginationPlan, PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

const PRINT_STYLE_BLOCK = `<style media="print">
  html, body { background: #ffffff !important; }
  .ats-page {
    margin: 0 !important;
    break-after: page;
  }
  .ats-page:last-child {
    break-after: auto;
  }
</style>`;

export async function buildPrintablePdfHtml(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<string> {
  const baseHtml = await buildPaginatedPageHtml(assembly, plan, paperSize, density);
  const headCloseIndex = baseHtml.indexOf("</head>");
  if (headCloseIndex === -1) {
    throw new Error("buildPrintablePdfHtml: base HTML has no </head> to splice print styles before");
  }
  return baseHtml.slice(0, headCloseIndex) + PRINT_STYLE_BLOCK + baseHtml.slice(headCloseIndex);
}
