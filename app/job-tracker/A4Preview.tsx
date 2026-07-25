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

function paginateLikeExportPdf(text: string): string[] {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: PDF_FORMAT,
  });

  pdf.setFont(FONT_NAME);
  pdf.setFontSize(FONT_SIZE_PT);

  const lines: string[] = pdf.splitTextToSize(
    normalizeForPdf(text),
    TEXT_WIDTH_MM
  );

  const pages: string[] = [];
  let current: string[] = [];
  let y = FIRST_LINE_Y_MM;

  for (const line of lines) {
    if (y > LAST_LINE_Y_MM) {
      pages.push(current.join("\n"));
      current = [];
      y = FIRST_LINE_Y_MM;
    }

    current.push(line);
    y += LINE_HEIGHT_MM;
  }

  if (current.length > 0 || pages.length === 0) {
    pages.push(current.join("\n"));
  }

  return pages;
}

export default function A4Preview({
  text,
  onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const pages = useMemo(() => paginateLikeExportPdf(text), [text]);

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
                onChange={(e) => onChange?.(e.target.value)}
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
