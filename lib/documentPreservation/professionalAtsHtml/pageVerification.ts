/*
  TASK 9/orchestrator - real per-page VERIFY pass. This is the second
  half of the "measure once, gap-adjust in TS, verify once per
  density" design (measurement.ts's own header comment): after
  paginationPlanner.ts/densityAutoFit.ts pick a candidate plan using
  the flat measurement + known gap constants, this does ONE real
  render+measure of the actual PAGINATED HTML to confirm zero overflow
  at that specific density - catching CSS rounding/edge-case
  discrepancies the arithmetic-based planning can't see (see
  htmlValidator.ts's own header comment on exactly this class of bug,
  found and fixed during this task's development).

  `clipped` is always false in this implementation: `.ats-page` uses
  min-height (never a fixed height with overflow:hidden), so
  overflowing content grows the box taller rather than being visually
  clipped - `overflowPx > 0` already carries the "content exceeds one
  physical page" fact; `clipped` stays false to accurately describe
  this renderer's actual behavior, not a hypothetical fixed-height one.
*/
import { getSharedBrowser } from "../sharedBrowser";
import { buildPaginatedPageHtml } from "./paginatedHtmlString";
import { PAPER_DIMENSIONS } from "./designTokens";
import type { PaginationPlan, PageVerificationSummary, PageVerificationResult, PaperSize } from "./types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

const VERIFY_TIMEOUT_MS = 15_000;
const VERIFY_VIEWPORT_WIDTH = 1400;
const VERIFY_VIEWPORT_HEIGHT = 40_000;

const MM_TO_PX = 96 / 25.4;
const IN_TO_PX = 96;
function paperDimensionsPx(paperSize: PaperSize): { widthPx: number; heightPx: number } {
  return paperSize === "letter" ? { widthPx: 8.5 * IN_TO_PX, heightPx: 11 * IN_TO_PX } : { widthPx: 210 * MM_TO_PX, heightPx: 297 * MM_TO_PX };
}

function emptySummary(errors: string[], paperSize: PaperSize): PageVerificationSummary {
  const dims = paperDimensionsPx(paperSize);
  return {
    measurable: false,
    measurementErrors: errors,
    pageWidthPx: dims.widthPx,
    pageHeightPx: dims.heightPx,
    contentWidthPx: 0,
    contentHeightPx: 0,
    pages: [],
    overflowDetected: false,
  };
}

export async function verifyPaginatedPages(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<PageVerificationSummary> {
  const dims = paperDimensionsPx(paperSize);
  const html = await buildPaginatedPageHtml(assembly, plan, paperSize, density);

  let browser;
  try {
    browser = await getSharedBrowser();
  } catch (error) {
    return emptySummary([`browser launch failed: ${error instanceof Error ? error.message : String(error)}`], paperSize);
  }

  const page = await browser.newPage({ viewport: { width: VERIFY_VIEWPORT_WIDTH, height: VERIFY_VIEWPORT_HEIGHT } });
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: VERIFY_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);

    const result = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll(".ats-page")) as HTMLElement[];
      if (pages.length === 0) return { error: "no .ats-page elements found" };
      return {
        contentWidthPx: pages[0].clientWidth,
        heights: pages.map((el) => el.getBoundingClientRect().height),
      };
    });

    if (typeof result.error === "string") {
      return emptySummary([result.error], paperSize);
    }
    if (!result.heights) {
      return emptySummary(["verification returned an unexpected shape"], paperSize);
    }

    const pageResults: PageVerificationResult[] = result.heights.map((h, pageIndex) => {
      const overflowPx = Math.max(0, h - dims.heightPx);
      return { pageIndex, contentHeightPx: h, contentMaxHeightPx: dims.heightPx, overflowPx, clipped: false };
    });

    return {
      measurable: true,
      measurementErrors: [],
      pageWidthPx: dims.widthPx,
      pageHeightPx: dims.heightPx,
      contentWidthPx: result.contentWidthPx,
      contentHeightPx: Math.max(...result.heights),
      pages: pageResults,
      overflowDetected: pageResults.some((p) => p.overflowPx > 0),
    };
  } catch (error) {
    return emptySummary([`verification failed: ${error instanceof Error ? error.message : String(error)}`], paperSize);
  } finally {
    await page.close();
  }
}
