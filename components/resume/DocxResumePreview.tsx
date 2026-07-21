"use client";

import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "isomorphic-dompurify";

/*
  Renders the HTML mammoth produced from an uploaded DOCX
  (resume.extracted_layout = {type:"docx_html", html}). Images are never
  referenced by URL in the stored HTML - each <img> instead carries a
  permanent data-asset-id pointing into resume.extracted_assets. After the
  sanitized HTML is mounted, this component fetches short-lived signed
  URLs from /api/resumes/[id]/preview-url and sets each image's src
  directly on the live DOM node, so nothing that expires is ever persisted.
*/

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "sup", "sub",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "a", "img", "span", "div",
];

const ALLOWED_ATTR = [
  "href", "alt", "colspan", "rowspan", "class", "data-asset-id",
];

export default function DocxResumePreview({ resume }: { resume: any }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rawHtml: string = resume?.extracted_layout?.html || "";

  // Pure derivation from props - a useMemo, not an effect + setState, so
  // there's no extra render pass and nothing to synchronize.
  const sanitizedHtml = useMemo(() => {
    if (!rawHtml) return "";

    // Sanitized again here even though it was already sanitized at write
    // time - defense in depth against anything that reaches this component
    // from elsewhere.
    return DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
  }, [rawHtml]);

  useEffect(() => {
    let cancelled = false;

    async function resolveAssetImages() {
      const container = containerRef.current;

      if (!container) return;

      const images = Array.from(
        container.querySelectorAll<HTMLImageElement>("img[data-asset-id]")
      );

      if (images.length === 0) return;

      try {
        const res = await fetch(`/api/resumes/${resume.id}/preview-url`);
        const data = await res.json();

        if (cancelled || !res.ok || !data.assetUrls) return;

        for (const img of images) {
          const assetId = img.getAttribute("data-asset-id");
          const url = assetId && data.assetUrls[assetId];

          if (url) {
            img.setAttribute("src", url);
          }
        }
      } catch {
        /*
          Asset URLs failing to resolve shouldn't block the rest of the
          preview - the text/structure still renders, just without images.
        */
      }
    }

    resolveAssetImages();

    return () => {
      cancelled = true;
    };
  }, [sanitizedHtml, resume?.id]);

  if (!rawHtml) {
    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-slate-500">
        No converted content is available for this resume.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-slate-800">
      <p className="mb-1 text-sm font-black uppercase tracking-wide text-blue-600">
        Uploaded Resume (Original Layout)
      </p>

      <p className="mb-4 text-xs text-slate-400">
        Preview preserves the document structure and images where possible.
        Some visual styling may differ from the original file.
      </p>

      <div
        ref={containerRef}
        className="docx-preview text-sm leading-7"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    </div>
  );
}
