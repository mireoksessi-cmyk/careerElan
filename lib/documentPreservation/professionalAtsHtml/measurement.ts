/*
  TASK 5 - Real browser DOM measurement. Loads buildFlatPageHtml's own
  markup into a headless Chromium page (via the project's existing
  getSharedBrowser() singleton - same launch-once pattern as
  layoutAnalysis/docxGeometryRenderer.ts) and reads real
  getBoundingClientRect() heights, never estimated/computed values.

  What gets measured, and why NOT everything:
  - Each top-level [data-block-id] element's OWN total height (header +
    all sub-items + all internal gaps, in one real number) - used when
    placing a block whole (no split) on a page; robust against margin-
    collapsing edge cases since it's one direct measurement, not summed
    parts.
  - Each block's [data-block-header] height separately, plus each
    [data-sub-index] child's own height separately - used when a block
    needs to be SPLIT across a page boundary (TASK 6/7): the planner
    reconstructs a partial height as
    headerHeightPx + bulletGapPx*(n-1) + sum(subItem heights for the
    chosen range), using bulletGapPx from designTokens.ts (a known
    constant, not measured - only content wrapping height needs a real
    browser, fixed gap constants don't).
  - Each [data-section-heading]'s own height - keepHeadingWithFirstBlock
    math adds headingMarginBottomPx (known constant) to this.
  - #measure-page-content's clientWidth - the real content width text
    actually wraps against, for cross-checking PAPER_DIMENSIONS math.

  What is NOT measured (deliberately): inter-block/inter-section GAPS
  themselves. Those are density constants (entryGapPx/sectionGapPx) the
  planner already knows - re-deriving them from two elements' bounding
  boxes would just reintroduce floating-point/margin-collapse noise for
  a number that's already exactly known.
*/
import { getSharedBrowser } from "../sharedBrowser";
import { buildFlatPageHtml, MEASURE_CONTENT_ID } from "./htmlDocument";
import type { PaperSize } from "./types";
import type { FlatMeasurementResult } from "./types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

const MEASURE_TIMEOUT_MS = 15_000;
const MEASURE_VIEWPORT_WIDTH = 1400;
const MEASURE_VIEWPORT_HEIGHT = 20_000;

function emptyResult(error: string): FlatMeasurementResult {
  return { measurable: false, measurementErrors: [error], contentWidthPx: 0, sectionHeadings: [], blocks: [] };
}

export async function measureFlatContent(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<FlatMeasurementResult> {
  const html = await buildFlatPageHtml(assembly, paperSize, density);

  let browser;
  try {
    browser = await getSharedBrowser();
  } catch (error) {
    return emptyResult(`browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const page = await browser.newPage({ viewport: { width: MEASURE_VIEWPORT_WIDTH, height: MEASURE_VIEWPORT_HEIGHT } });

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: MEASURE_TIMEOUT_MS });

    /* Font-load-complete + one rendered-frame wait, so measurement
       reads a stable layout (spec requirement: measure only after
       document.fonts.ready and layout has settled). The font stack
       here is system Arial/Helvetica (no @font-face), so this
       resolves near-instantly - the wait exists for correctness under
       any future font-stack change, not because it's currently slow. */
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const result = await page.evaluate((contentId) => {
      const contentEl = document.getElementById(contentId);
      if (!contentEl) return { error: "measure content root not found" };

      const sectionHeadings: { sectionKey: string; heightPx: number }[] = [];
      for (const el of Array.from(document.querySelectorAll("[data-section-heading]")) as HTMLElement[]) {
        const sectionKey = el.getAttribute("data-section-heading");
        if (!sectionKey) continue;
        sectionHeadings.push({ sectionKey, heightPx: el.getBoundingClientRect().height });
      }

      const blocks: {
        blockId: string;
        totalHeightPx: number;
        headerHeightPx: number;
        subItems: { index: number; heightPx: number }[];
      }[] = [];
      for (const el of Array.from(document.querySelectorAll("[data-block-id]")) as HTMLElement[]) {
        const blockId = el.getAttribute("data-block-id");
        if (!blockId) continue;

        const headerEl = el.querySelector("[data-block-header]") as HTMLElement | null;
        const subItems: { index: number; heightPx: number }[] = [];
        for (const sub of Array.from(el.querySelectorAll("[data-sub-index]")) as HTMLElement[]) {
          const idxAttr = sub.getAttribute("data-sub-index");
          if (idxAttr === null) continue;
          const idx = Number(idxAttr);
          if (!Number.isFinite(idx)) continue;
          subItems.push({ index: idx, heightPx: sub.getBoundingClientRect().height });
        }

        blocks.push({
          blockId,
          totalHeightPx: el.getBoundingClientRect().height,
          headerHeightPx: headerEl ? headerEl.getBoundingClientRect().height : 0,
          subItems,
        });
      }

      return {
        contentWidthPx: contentEl.clientWidth,
        sectionHeadings,
        blocks,
      };
    }, MEASURE_CONTENT_ID);

    if (typeof result.error === "string") {
      return emptyResult(result.error);
    }
    if (!result.blocks) {
      return emptyResult("measurement returned an unexpected shape");
    }

    return {
      measurable: true,
      measurementErrors: [],
      contentWidthPx: result.contentWidthPx,
      sectionHeadings: result.sectionHeadings as FlatMeasurementResult["sectionHeadings"],
      blocks: result.blocks,
    };
  } catch (error) {
    return emptyResult(`measurement failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await page.close();
  }
}
