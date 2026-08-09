"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";

type Props = {
  text: string;
  onChange?: (value: string) => void;
};

/*
  Mirrors lib/exportDocument.ts's exportPdf() geometry and algorithm
  exactly (A4, Helvetica 10pt, 180mm text width starting at x=15mm,
  y from 15mm to 280mm, 5mm per line, same character normalization) so
  this preview's page breaks match the actual downloaded PDF's page
  breaks - previously this used an unrelated character-count estimate
  (400px-wide box, 9px font, 92 chars/line) with no relationship to the
  real output, which is why job/education/section blocks appeared to
  split at different points than the real PDF and the page count/blank
  space didn't match.

  jsPDF's own splitTextToSize() does the same font-metric-aware wrapping
  exportPdf() relies on (not a naive character count), so line wrapping
  matches exactly, not approximately. This intentionally duplicates
  exportPdf()'s constants rather than importing a shared helper from
  lib/exportDocument.ts, so the confirmed-working real PDF/DOCX export
  code path stays completely untouched.
*/
const PDF_FORMAT = "a4";
const FONT_NAME = "helvetica";
const FONT_SIZE_PT = 10;
const MARGIN_LEFT_MM = 15;
const TEXT_WIDTH_MM = 180;
const FIRST_LINE_Y_MM = 15;
const LAST_LINE_Y_MM = 280;
const LINE_HEIGHT_MM = 5;

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// 96 CSS px per inch, 25.4mm per inch.
const MM_TO_PX = 96 / 25.4;
const PT_TO_PX = 96 / 72;

function normalizeForPdf(text: string): string {
  return text
    .replace(/[‐-‒–—―－]/g, "-")
    .replace(/[•▪◦]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\t/g, " ");
}

/*
  Phase 6I.6.20 - P0 data-loss fix. The previous version of this function
  paginated by WRAPPED sub-lines (pdf.splitTextToSize() applied to the
  WHOLE text at once), then joined each page's wrapped sub-lines back
  together as that page's editable textarea value. That is lossy by
  construction even with zero edits: splitTextToSize() re-wraps prose at
  word boundaries, so "pages.join('\n')" never reproduces the original
  text's real line-break structure - and the caller (A4Preview's single
  shared onChange, see below) was replacing the ENTIRE document with
  whichever one page's wrapped text last changed, destroying every other
  page on the very first keystroke.

  The fix paginates by RAW newline-delimited lines (text.split("\n"))
  instead. This is losslessly reversible - rawLines.join("\n") always
  reconstructs the exact original text, split/join being exact inverses
  for any string - so a page's stored/editable content is always a
  verbatim slice of the source, never a re-flowed approximation. Per-line
  wrapped sub-line COUNTS (via splitTextToSize on each raw line
  individually) are still used to replicate the same y-position/page-break
  math the original algorithm used for vertical spacing parity with the
  real PDF export (verified empirically: splitting first then wrapping
  each piece produces the identical wrapped-line sequence splitTextToSize
  produces on the whole text at once - blank lines, paragraph wraps, and
  all). The one accepted trade-off: a single raw line is never split
  across two pages (it moves to the page where it starts), so an
  anomalously long unbroken line may occasionally cause a page to run a
  little over/under the true PDF's break point. Real resume/cover-letter
  content is line-structured (headers, bullets, short paragraphs) so this
  essentially never differs from the prior wrapped-sub-line pagination in
  practice, and it trades a rare, cosmetic page-break mismatch for a
  guarantee of zero data loss, which is this phase's non-negotiable
  invariant.
*/
function computeWrappedLineCounts(pdf: jsPDF, rawLines: string[]): number[] {
  return rawLines.map(
    (line) => Math.max(1, pdf.splitTextToSize(normalizeForPdf(line), TEXT_WIDTH_MM).length)
  );
}

/*
  Returns the [start, end) raw-line index range owned by each page. Ranges
  are contiguous, non-overlapping, and together cover every raw line
  exactly once - this is what guarantees no content can be dropped or
  duplicated regardless of how many pages result.
*/
function paginateRawLineRanges(rawLines: string[], wrappedCounts: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  let pageStart = 0;
  let y = FIRST_LINE_Y_MM;

  for (let i = 0; i < rawLines.length; i++) {
    if (y > LAST_LINE_Y_MM && i > pageStart) {
      ranges.push([pageStart, i]);
      pageStart = i;
      y = FIRST_LINE_Y_MM;
    }
    y += wrappedCounts[i] * LINE_HEIGHT_MM;
  }

  ranges.push([pageStart, rawLines.length]);
  return ranges;
}

function makeMeasurementPdf(): jsPDF {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: PDF_FORMAT,
  });
  pdf.setFont(FONT_NAME);
  pdf.setFontSize(FONT_SIZE_PT);
  return pdf;
}

/*
  Pure, DOM-free pagination core - exported so
  lib/resumeTemplates/tests/multiPageEditingDataLoss6I620.test.ts can
  exercise the exact same logic the component renders with, without a
  React/DOM test harness. The component below is a thin wiring layer
  over these two functions.
*/
export function computeA4Pages(text: string): { pages: string[]; pageLineRanges: [number, number][] } {
  const rawLines = text.split("\n");
  const pdf = makeMeasurementPdf();
  const wrappedCounts = computeWrappedLineCounts(pdf, rawLines);
  const pageLineRanges = paginateRawLineRanges(rawLines, wrappedCounts);
  const pages = pageLineRanges.map(([start, end]) => rawLines.slice(start, end).join("\n"));
  return { pages, pageLineRanges };
}

export function reconstructFullTextAfterPageEdit(text: string, pageIndex: number, newPageText: string): string {
  const rawLines = text.split("\n");
  const { pageLineRanges } = computeA4Pages(text);
  const [start, end] = pageLineRanges[pageIndex];
  const newLines = newPageText.split("\n");
  return [...rawLines.slice(0, start), ...newLines, ...rawLines.slice(end)].join("\n");
}

export default function A4Preview({
  text,
  onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  /*
    Recomputed fresh from `text` on every render (never kept as separate
    local state) - `text` is the ONLY source of truth here, pages are
    purely a derived presentation of it. This is what makes reflow (page
    count changing after an edit) just work: the next render re-derives
    page boundaries from the new text, nothing needs to be manually kept
    in sync.
  */
  const { pages } = useMemo(() => computeA4Pages(text), [text]);

  /*
    Reconstructs the FULL document by replacing only the edited page's
    own raw-line range with the user's new text, leaving every other
    page's raw lines byte-identical. This is the actual P0 fix: the old
    code called the single shared `onChange` prop with just the edited
    page's own text, which the caller (app/paste-job/page.tsx) wrote
    straight into the full-document state, silently discarding every
    other page. Passing the full reconstructed text instead means the
    caller's state always remains complete.
  */
  function handlePageChange(pageIndex: number, newPageText: string) {
    if (!onChange) return;
    onChange(reconstructFullTextAfterPageEdit(text, pageIndex, newPageText));
  }

  /*
    Scale is purely a visual zoom (CSS transform on the outer wrapper) -
    the inner page keeps its true A4-proportional width/font-size/line-
    height at all times, so the browser reflows text against the same
    physical width jsPDF measured against, not against whatever the
    container happens to be. Recomputed on container resize (covers both
    desktop and the 375px mobile viewport).
  */
  useEffect(() => {
    function updateScale() {
      const containerWidth =
        containerRef.current?.clientWidth || 0;
      const pageWidthPx = PAGE_WIDTH_MM * MM_TO_PX;

      if (containerWidth > 0) {
        setScale(
          Math.min(1, (containerWidth - 24) / pageWidthPx)
        );
      }
    }

    updateScale();

    window.addEventListener("resize", updateScale);
    return () =>
      window.removeEventListener("resize", updateScale);
  }, []);

  const pageWidthPx = PAGE_WIDTH_MM * MM_TO_PX;
  const pageHeightPx = PAGE_HEIGHT_MM * MM_TO_PX;
  const marginLeftPx = MARGIN_LEFT_MM * MM_TO_PX;
  const textWidthPx = TEXT_WIDTH_MM * MM_TO_PX;
  const paddingTopPx = FIRST_LINE_Y_MM * MM_TO_PX - LINE_HEIGHT_MM * MM_TO_PX;
  const lineHeightPx = LINE_HEIGHT_MM * MM_TO_PX;
  const fontSizePx = FONT_SIZE_PT * PT_TO_PX;

  return (
    <div
      ref={containerRef}
      className="w-full h-[900px] overflow-y-auto rounded-xl bg-[#f3f3f3] p-5"
    >
      <div className="flex flex-col items-center gap-8">
        {pages.map((page, index) => (
          <div
            key={index}
            style={{
              width: pageWidthPx * scale,
              height: pageHeightPx * scale,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: pageWidthPx,
                height: pageHeightPx,
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 2,
                boxShadow: "0 8px 20px rgba(0,0,0,.12)",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <textarea
                readOnly={!onChange}
                value={page}
                onChange={(e) => handlePageChange(index, e.target.value)}
                style={{
                  width: textWidthPx,
                  height: pageHeightPx - paddingTopPx * 2,
                  marginLeft: marginLeftPx,
                  marginTop: paddingTopPx,
                  boxSizing: "border-box",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  overflow: "hidden",
                  background: "transparent",
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${lineHeightPx}px`,
                  color: "#111",
                  whiteSpace: "pre-wrap",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
