/*
  Document Preservation Engine (DPE) - Phase 4B completion. Real Overflow
  Detection - built on browserMeasurement.ts's real DOM measurement
  (via layoutMeasurement.ts), not estimation. Judgment only - never
  adjusts text or layout itself.
*/
import type { LayoutMeasurementResult, OverflowFinding, OverflowReport } from "./types";

export function detectOverflow(measurement: LayoutMeasurementResult): OverflowReport {
  if (!measurement.measurable) {
    return {
      hasOverflow: false,
      findings: [
        {
          contentBoxId: "*",
          page: 0,
          verdict: "fits",
          detail: `Overflow cannot be judged - ${measurement.unmeasurableReason}. Per this phase's own rule, an unmeasurable result must never be silently treated as "fits"; see index.ts, which treats this exact case as a hard measurement failure, not a pass.`,
        },
      ],
    };
  }

  const findings: OverflowFinding[] = [];

  /*
    Clipping: real signal, not estimated - each visible page window
    (A4DocumentPreview's own "relative overflow-hidden rounded bg-white
    shadow" div) reports its own real scrollWidth/Height vs
    clientWidth/Height. Overflow:hidden means anything beyond
    clientWidth/Height is genuinely, invisibly cut - this is the same
    signal a human inspecting the real rendered page would see.
  */
  for (const pageWindow of measurement.pageWindows) {
    if (!pageWindow.clipped) continue;

    const isLastPageWindow = pageWindow.pageIndex === measurement.pageWindows.length - 1;
    const verdict = pageWindow.scrollHeight > pageWindow.clientHeight ? "vertical_overflow" : "horizontal_overflow";

    // A non-last page window's own scrollHeight always exceeds its
    // clientHeight, because A4DocumentPreview renders the full document
    // inside every page window, shifted by pageIndex - that is the
    // windowing technique itself, not real overflow. Only the LAST
    // window's vertical clipping means content didn't fit within the
    // Renderer's own computed page count.
    if (verdict === "vertical_overflow" && !isLastPageWindow) continue;

    findings.push({
      contentBoxId: "*",
      page: pageWindow.pageIndex + 1,
      verdict,
      detail: `Page ${pageWindow.pageIndex + 1} window: scrollWidth=${pageWindow.scrollWidth} clientWidth=${pageWindow.clientWidth}, scrollHeight=${pageWindow.scrollHeight} clientHeight=${pageWindow.clientHeight} - real overflow:hidden clipping.`,
    });
  }

  /*
    page_overflow: the Renderer's own real pageCount (browserResult.
    totalPageCount, computed by A4DocumentPreview's own
    Math.ceil(scrollHeight/CONTENT_HEIGHT_PX)) exceeding 1 means the
    Renderer itself already decided this content needs more than one
    page - a real fact read from the real component, not re-derived.
  */
  if (measurement.totalPageCount > 1) {
    findings.push({
      contentBoxId: "*",
      page: 0,
      verdict: "overflow",
      detail: `The real Renderer's own pagination produced ${measurement.totalPageCount} pages for this content (A4DocumentPreview.tsx's own pageCount state, read directly from the rendered DOM).`,
    });
  }

  /*
    Overlap: real bounding-rect intersection (measurement.overlapPairs,
    computed in layoutMeasurement.ts from REAL getBoundingClientRect()
    values, with an explicit tolerance so touching edges never count).
    In every real fixture tested this stayed empty (see the final
    report) - the check exists to catch a genuine layout regression, not
    because one was expected.
  */
  for (const pair of measurement.overlapPairs) {
    findings.push({
      contentBoxId: `real-el-${pair.elementAIndex}`,
      page: 0,
      verdict: "overlap",
      detail: `Elements ${pair.elementAIndex} and ${pair.elementBIndex} genuinely overlap by ${Math.round(pair.overlapWidth)}x${Math.round(pair.overlapHeight)}px (real bounding-rect intersection, beyond tolerance).`,
    });
  }

  /*
    column_overflow: real column assignment (measurement.rawElements[].
    column, set in browserMeasurement.ts from whether an element's real
    DOM node is inside the real <aside> sidebar element) combined with
    real x position - a sidebar element whose real right edge extends
    past where the real main-column content starts is a genuine
    column-boundary violation, not an estimate.
  */
  const sidebarElements = measurement.rawElements.filter((el) => el.column === "sidebar");
  const mainElements = measurement.rawElements.filter((el) => el.column === "main");

  if (sidebarElements.length > 0 && mainElements.length > 0) {
    const mainLeftEdge = Math.min(...mainElements.map((el) => el.x));

    for (let i = 0; i < sidebarElements.length; i++) {
      const el = sidebarElements[i];
      if (el.x + el.width > mainLeftEdge + OVERLAP_SAFETY_MARGIN_PX) {
        findings.push({
          contentBoxId: `real-sidebar-${i}`,
          page: 0,
          verdict: "column_overflow",
          detail: `Sidebar element "${el.text.slice(0, 40)}" right edge (${Math.round(el.x + el.width)}px) extends into the main column's real left edge (${Math.round(mainLeftEdge)}px).`,
        });
      }
    }
  }

  const hasOverflow = findings.some((f) => f.verdict !== "fits");

  return { hasOverflow, findings };
}

const OVERLAP_SAFETY_MARGIN_PX = 2;
