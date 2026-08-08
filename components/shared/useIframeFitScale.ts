"use client";

/*
  Phase 6I.6.6 (round spec §15) - shared "Fit Page" scaling for the
  canonical resume preview iframes (Paste Job's CanonicalTemplateSelector,
  Job Tracker's JobDetail). Both previews render the SAME server-generated
  template HTML (a fixed-pixel-width page, see lib/resumeTemplates'
  pageStyles()/PAPER_DIMENSIONS) inside a <iframe srcDoc=...>, which does
  not natively scale its content to a narrower container the way normal
  flowing HTML would - without this hook the page either overflows
  (horizontal scroll/clipping) or sits shrunk-by-nothing at its native
  816px/794px width regardless of how wide the surrounding card is.

  scale = min(1, containerWidth / nativePageWidthPx) - shrink-to-fit only,
  matching this codebase's own established convention in
  lib/brand/render/A4Preview.tsx and A4DocumentPreview.tsx (never
  enlarges past 100%, so text/line-wrapping in the actual rendered
  PDF/DOCX - which this preview must visually match - is never
  misrepresented as smaller or larger than it truly prints). Height is
  measured from the iframe's own rendered content (same-origin srcDoc,
  so contentDocument is readable) once loaded, so a multi-page resume's
  real total height - not just one page - determines the wrapper's
  scroll height; onLoad plus a ResizeObserver on the outer container
  keep the scale correct across window resizes without any of the
  three call sites (this hook's two React consumers) hand-rolling their
  own transform math separately (round spec §15's own "do not apply
  arbitrary CSS transform values separately in multiple places").
*/
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type IframeFitScale = {
  scale: number;
  /* Unscaled - the iframe's own real content height, in px. Apply this
     directly as the iframe's `height` so its internal layout never
     needs its own scrollbar; the outer wrapper then uses scaledHeight
     (below) to reserve the correct POST-transform visual space. */
  nativeHeight: number | null;
  scaledHeight: number | null;
  recompute: () => void;
};

export function useIframeFitScale(
  containerRef: RefObject<HTMLElement | null>,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  nativeWidthPx: number
): IframeFitScale {
  const [scale, setScale] = useState(1);
  const [nativeHeight, setNativeHeight] = useState<number | null>(null);
  const [scaledHeight, setScaledHeight] = useState<number | null>(null);
  const lastNativeHeightRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    if (!container || !nativeWidthPx) return;

    let measuredHeight = lastNativeHeightRef.current;
    try {
      const doc = iframe?.contentDocument;
      if (doc?.documentElement) {
        const measured = Math.max(
          doc.documentElement.scrollHeight || 0,
          doc.body?.scrollHeight || 0
        );
        if (measured > 0) {
          measuredHeight = measured;
          lastNativeHeightRef.current = measured;
        }
      }
    } catch {
      // Cross-origin or not-yet-loaded - keep the last known height.
    }

    const containerWidth = container.clientWidth;
    if (!containerWidth) return;
    const nextScale = Math.min(1, containerWidth / nativeWidthPx);
    setScale(nextScale);
    setNativeHeight(measuredHeight);
    setScaledHeight(measuredHeight ? Math.ceil(measuredHeight * nextScale) : null);
  }, [containerRef, iframeRef, nativeWidthPx]);

  useEffect(() => {
    recompute();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recompute]);

  return { scale, nativeHeight, scaledHeight, recompute };
}
