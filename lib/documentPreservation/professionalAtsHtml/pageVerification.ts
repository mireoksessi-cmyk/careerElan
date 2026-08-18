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

  const verifyStartedAt = Date.now();
  logAtsEvent("professional_ats_verify_start", {
    ...atsEnvironmentIdentity(),
    paperSize,
    density,
    htmlBytes: html.length,
    plannedPageCount: plan.pageCount,
    viewportWidth: VERIFY_VIEWPORT_WIDTH,
    viewportHeight: VERIFY_VIEWPORT_HEIGHT,
  });

  /* newPage deliberately stays OUTSIDE the try, exactly as before, so its
     failure still propagates to the caller instead of degrading to an empty
     summary. It is only observed here and rethrown unchanged. */
  logAtsEvent("professional_ats_verify_page_open_start", { ...atsEnvironmentIdentity() });
  const page = await (async () => {
    try {
      const opened = await browser.newPage({ viewport: { width: VERIFY_VIEWPORT_WIDTH, height: VERIFY_VIEWPORT_HEIGHT } });
      logAtsEvent("professional_ats_verify_page_open_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - verifyStartedAt });
      return opened;
    } catch (error) {
      logAtsEvent("professional_ats_verify_failure", {
        ...atsEnvironmentIdentity(),
        stage: "newPage",
        elapsedMs: Date.now() - verifyStartedAt,
        errorName: error instanceof Error ? error.name : "Unknown",
        message: boundedAtsErrorMessage(error instanceof Error ? String(error.message) : String(error)),
        viewportWidth: VERIFY_VIEWPORT_WIDTH,
        viewportHeight: VERIFY_VIEWPORT_HEIGHT,
      });
      throw error;
    }
  })();

  let stage = "setContent";
  try {
    logAtsEvent("professional_ats_verify_set_content_start", { ...atsEnvironmentIdentity(), htmlBytes: html.length });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: VERIFY_TIMEOUT_MS });
    logAtsEvent("professional_ats_verify_set_content_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - verifyStartedAt });

    stage = "fontsReady";
    logAtsEvent("professional_ats_verify_fonts_ready_start", { ...atsEnvironmentIdentity() });
    await page.evaluate(() => document.fonts.ready);
    logAtsEvent("professional_ats_verify_fonts_ready_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - verifyStartedAt });

    stage = "evaluate";
    logAtsEvent("professional_ats_verify_evaluate_start", { ...atsEnvironmentIdentity() });
    const result = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll(".ats-page")) as HTMLElement[];
      if (pages.length === 0) return { error: "no .ats-page elements found" };
      return {
        contentWidthPx: pages[0].clientWidth,
        heights: pages.map((el) => el.getBoundingClientRect().height),
      };
    });
    logAtsEvent("professional_ats_verify_evaluate_success", {
      ...atsEnvironmentIdentity(),
      elapsedMs: Date.now() - verifyStartedAt,
      renderedPageCount: Array.isArray(result.heights) ? result.heights.length : null,
      contentWidthPx: typeof result.contentWidthPx === "number" ? result.contentWidthPx : null,
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
    logAtsEvent("professional_ats_verify_failure", {
      ...atsEnvironmentIdentity(),
      stage,
      elapsedMs: Date.now() - verifyStartedAt,
      errorName: error instanceof Error ? error.name : "Unknown",
      message: boundedAtsErrorMessage(error instanceof Error ? String(error.message) : String(error)),
      viewportWidth: VERIFY_VIEWPORT_WIDTH,
      viewportHeight: VERIFY_VIEWPORT_HEIGHT,
    });
    return emptySummary([`verification failed: ${error instanceof Error ? error.message : String(error)}`], paperSize);
  } finally {
    logAtsEvent("professional_ats_verify_page_close_start", { ...atsEnvironmentIdentity() });
    await page.close();
    logAtsEvent("professional_ats_verify_page_close_success", { ...atsEnvironmentIdentity(), elapsedMs: Date.now() - verifyStartedAt });
  }
}
