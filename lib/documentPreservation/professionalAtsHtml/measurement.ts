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

/*
  Diagnostic-only instrumentation. Production reached browser_launch_success and
  then failed with "browser.newPage: Target crashed", and this file had no
  logging at all, so which stage died was invisible server-side - the message
  only ever reached the client through the route's JSON body. These events add
  no control flow: every original return value, thrown error and code path is
  preserved exactly, including the deliberate placement of newPage OUTSIDE the
  try below, whose failures propagate to the caller rather than degrading to an
  empty result - which is how the crash surfaced at all.
*/
const MAX_ATS_ERROR_CHARS = 8000;
const RE_QUERY = /\?[A-Za-z0-9_%\-.=&+/:]+/g;

/*
  Correlates these stages with the browser_* events already logged from the same
  execution environment. pid and the two Lambda log-name variables are not
  credentials, and no user, document or request value is read.
*/
function atsEnvironmentIdentity(): Record<string, unknown> {
  return {
    pid: process.pid,
    logStream: process.env.AWS_LAMBDA_LOG_STREAM_NAME || null,
    logGroup: process.env.AWS_LAMBDA_LOG_GROUP_NAME || null,
  };
}

/*
  Chromium/Playwright crash text is the point of this log, so sanitisation is
  narrow: only query strings are stripped, in case a signed URL ever appears.
  Nothing here reads process.env.
*/
function boundedAtsErrorMessage(raw: string): string {
  const redacted = raw.replace(RE_QUERY, "?<redacted>");
  return redacted.length > MAX_ATS_ERROR_CHARS
    ? redacted.slice(0, MAX_ATS_ERROR_CHARS) + "…[truncated " + (redacted.length - MAX_ATS_ERROR_CHARS) + " chars]"
    : redacted;
}

/* Metadata only - never HTML, resume text, ids, or user values. */
function logAtsEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ domain: "professionalAtsRender", event, ...detail }));
}

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

  const measureStartedAt = Date.now();
  logAtsEvent("professional_ats_measure_start", {
    ...atsEnvironmentIdentity(),
    paperSize,
    density,
    htmlBytes: html.length,
    viewportWidth: MEASURE_VIEWPORT_WIDTH,
    viewportHeight: MEASURE_VIEWPORT_HEIGHT,
  });

  /* newPage deliberately stays OUTSIDE the try, exactly as before, so its
     failure still propagates to the caller instead of degrading to an empty
     result. It is only observed here and rethrown unchanged. */
  logAtsEvent("professional_ats_measure_page_open_start", { ...atsEnvironmentIdentity() });
  const page = await (async () => {
    try {
      const opened = await browser.newPage({ viewport: { width: MEASURE_VIEWPORT_WIDTH, height: MEASURE_VIEWPORT_HEIGHT } });
      logAtsEvent("professional_ats_measure_page_open_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - measureStartedAt });
      return opened;
    } catch (error) {
      logAtsEvent("professional_ats_measure_failure", {
        ...atsEnvironmentIdentity(),
        stage: "newPage",
        elapsedMs: Date.now() - measureStartedAt,
        errorName: error instanceof Error ? error.name : "Unknown",
        message: boundedAtsErrorMessage(error instanceof Error ? String(error.message) : String(error)),
        viewportWidth: MEASURE_VIEWPORT_WIDTH,
        viewportHeight: MEASURE_VIEWPORT_HEIGHT,
      });
      throw error;
    }
  })();

  let stage = "setContent";
  try {
    logAtsEvent("professional_ats_measure_set_content_start", { ...atsEnvironmentIdentity(), htmlBytes: html.length });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: MEASURE_TIMEOUT_MS });
    logAtsEvent("professional_ats_measure_set_content_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - measureStartedAt });

    /* Font-load-complete + one rendered-frame wait, so measurement
       reads a stable layout (spec requirement: measure only after
       document.fonts.ready and layout has settled). The font stack
       here is system Arial/Helvetica (no @font-face), so this
       resolves near-instantly - the wait exists for correctness under
       any future font-stack change, not because it's currently slow. */
    stage = "fontsReady";
    logAtsEvent("professional_ats_measure_fonts_ready_start", { ...atsEnvironmentIdentity() });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    logAtsEvent("professional_ats_measure_fonts_ready_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - measureStartedAt });

    stage = "evaluate";
    logAtsEvent("professional_ats_measure_evaluate_start", { ...atsEnvironmentIdentity() });
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
    logAtsEvent("professional_ats_measure_evaluate_success", {
      ...atsEnvironmentIdentity(),
      elapsedMs: Date.now() - measureStartedAt,
      sectionHeadingCount: Array.isArray(result.sectionHeadings) ? result.sectionHeadings.length : null,
      blockCount: Array.isArray(result.blocks) ? result.blocks.length : null,
      contentWidthPx: typeof result.contentWidthPx === "number" ? result.contentWidthPx : null,
    });

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
    logAtsEvent("professional_ats_measure_failure", {
      ...atsEnvironmentIdentity(),
      stage,
      elapsedMs: Date.now() - measureStartedAt,
      errorName: error instanceof Error ? error.name : "Unknown",
      message: boundedAtsErrorMessage(error instanceof Error ? String(error.message) : String(error)),
      viewportWidth: MEASURE_VIEWPORT_WIDTH,
      viewportHeight: MEASURE_VIEWPORT_HEIGHT,
    });
    return emptyResult(`measurement failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    logAtsEvent("professional_ats_measure_page_close_start", { ...atsEnvironmentIdentity() });
    await page.close();
    logAtsEvent("professional_ats_measure_page_close_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - measureStartedAt });
  }
}
