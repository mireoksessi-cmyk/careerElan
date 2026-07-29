"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildDocumentIRFromText } from "../buildDocumentIR";
import { getRenderer } from "./renderer";

type Props = {
  text: string;
  templateId?: string | null;
};

/*
  Read-only production entry point for the new DocumentIR pipeline -
  parses resume_text with buildDocumentIRFromText() and renders it with
  the selected Renderer (see renderer.ts / templateId.ts for the single
  normalization + default used everywhere in this pipeline).

  Deliberately has no `onChange` - unlike A4Preview, this does not
  support inline text editing. app/paste-job/page.tsx's resume tab uses
  this as its default "Preview" mode and keeps the original flat-text
  A4Preview available behind an explicit "Edit" toggle - a DocumentIR
  block tree has no defined mapping back to "the user typed a character
  here," so live editing through structured blocks is out of scope. See
  the Template End-to-End Integration migration's final report.

  Pagination (Phase 8): same A4 page geometry (297mm tall, 15mm top/
  bottom margin -> 267mm usable height) that A4Preview.tsx and
  pdfDocumentExport.ts already use, converted to px at 96dpi. Renders the
  SAME content tree once per page inside a fixed-height, overflow-hidden
  "window" shifted up by one page-height per page (a `translateY` clip,
  the same technique CSS print-preview tools use) - this genuinely
  splits arbitrary React output across page boundaries without needing
  per-element page-break logic. Known limitation: page breaks land at a
  physical mm offset, not at content-aware boundaries (a bullet or
  entry-header line can be visually cut across two pages) - the real
  downloaded PDF (pdfDocumentExport.ts) does not share this limitation,
  since it measures each line independently via jsPDF.
*/

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const TOP_MARGIN_MM = 15;
const BOTTOM_MARGIN_MM = 17;
const MM_TO_PX = 96 / 25.4;

const PAGE_WIDTH_PX = PAGE_WIDTH_MM * MM_TO_PX;
const PAGE_HEIGHT_PX = PAGE_HEIGHT_MM * MM_TO_PX;
const CONTENT_HEIGHT_PX = (PAGE_HEIGHT_MM - TOP_MARGIN_MM - BOTTOM_MARGIN_MM) * MM_TO_PX;

export default function A4DocumentPreview({ text, templateId }: Props) {
  const ir = useMemo(() => buildDocumentIRFromText(text), [text]);
  const renderer = getRenderer(templateId);
  const RendererView = renderer.React;

  const measureRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    function recompute(target: HTMLDivElement) {
      setPageCount(Math.max(1, Math.ceil(target.scrollHeight / CONTENT_HEIGHT_PX)));
    }

    recompute(el);

    const observer = new ResizeObserver(() => recompute(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ir, templateId]);

  useEffect(() => {
    function updateScale() {
      const containerWidth = containerRef.current?.clientWidth || 0;
      if (containerWidth > 0) setScale(Math.min(1, (containerWidth - 24) / PAGE_WIDTH_PX));
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full max-h-[900px] overflow-y-auto rounded-xl bg-[#f3f3f3] p-5"
    >
      {/* Hidden measuring pass - real content, zero visual footprint. */}
      <div className="pointer-events-none absolute -z-10 opacity-0" aria-hidden="true">
        <div ref={measureRef} style={{ width: PAGE_WIDTH_PX }}>
          <RendererView ir={ir} />
        </div>
      </div>

      <div className="flex flex-col items-center gap-8">
        {Array.from({ length: pageCount }, (_, pageIndex) => (
          <div
            key={pageIndex}
            style={{
              width: PAGE_WIDTH_PX * scale,
              height: PAGE_HEIGHT_PX * scale,
              flexShrink: 0,
            }}
          >
            <div
              className="relative overflow-hidden rounded bg-white shadow"
              style={{
                width: PAGE_WIDTH_PX,
                height: PAGE_HEIGHT_PX,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: TOP_MARGIN_MM * MM_TO_PX - pageIndex * CONTENT_HEIGHT_PX,
                  left: 0,
                  width: PAGE_WIDTH_PX,
                }}
              >
                <RendererView ir={ir} />
              </div>
              {pageCount > 1 && (
                <div className="absolute bottom-1 right-2 text-[10px] font-semibold text-slate-400">
                  Page {pageIndex + 1} of {pageCount}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
