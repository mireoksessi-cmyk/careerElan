"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

/*
  Two views over the same uploaded DOCX, both driven from a single shared
  call to the existing /api/resumes/[id]/preview-url endpoint (no new
  API/DB/Storage surface):

    - Original View (default): the real file rendered client-side with
      docx-preview, close to how Word itself lays it out. docx-preview is
      dynamic-imported inside a useEffect so it never loads or touches
      window/document during SSR.
    - Content View: the existing mammoth-derived structured HTML
      (resume.extracted_layout.html) - unchanged, kept as a fallback and
      as an explicit "simplified" alternative.

  A docx-preview rendering failure only switches the active tab to
  Content View; it never writes to conversion_status or any other DB
  field - this component is read-only.

  Both view containers stay mounted at all times (toggled with a CSS
  class, not conditional JSX) so switching tabs never re-fetches the
  file or re-runs docx-preview.
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

const RENDER_TIMEOUT_MS = 25000;

type ViewMode = "original" | "content";
type OriginalStatus = "idle" | "loading" | "success" | "error";
type PreviewUrls = { signedUrl: string | null; assetUrls: Record<string, string> };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RENDER_TIMEOUT")), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export default function DocxResumePreview({ resume }: { resume: any }) {
  const resumeId: string | undefined = resume?.id;
  const rawHtml: string = resume?.extracted_layout?.html || "";

  // Pure derivation from props - no extra render pass to synchronize.
  const sanitizedHtml = useMemo(() => {
    if (!rawHtml) return "";

    // Sanitized again even though it was already sanitized at write time -
    // defense in depth against anything that reaches this component from
    // elsewhere.
    return DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
  }, [rawHtml]);

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const originalContainerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("original");
  const [originalStatus, setOriginalStatus] = useState<OriginalStatus>("idle");
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls | null>(null);

  // Guards against re-fetching/re-rendering for a resume id that has
  // already been rendered in this component instance (tab switches or
  // re-renders never re-trigger the effects below).
  const fetchedForIdRef = useRef<string | null>(null);
  const renderedForIdRef = useRef<string | null>(null);

  // One shared fetch of /api/resumes/[id]/preview-url per resume id - both
  // the original-file signed URL and the content-view asset URLs come from
  // this single response.
  useEffect(() => {
    let cancelled = false;

    if (fetchedForIdRef.current !== resumeId) {
      fetchedForIdRef.current = null;
      renderedForIdRef.current = null;
      setPreviewUrls(null);
      setOriginalStatus("idle");
      setViewMode("original");

      if (originalContainerRef.current) {
        originalContainerRef.current.innerHTML = "";
      }
    }

    async function loadPreviewUrls() {
      if (!resumeId || fetchedForIdRef.current === resumeId) return;

      try {
        const res = await fetch(`/api/resumes/${resumeId}/preview-url`);
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          fetchedForIdRef.current = resumeId;
          setPreviewUrls({ signedUrl: null, assetUrls: {} });
          return;
        }

        fetchedForIdRef.current = resumeId;
        setPreviewUrls({
          signedUrl: data.signedUrl || null,
          assetUrls: data.assetUrls || {},
        });
      } catch {
        if (!cancelled) {
          fetchedForIdRef.current = resumeId;
          setPreviewUrls({ signedUrl: null, assetUrls: {} });
        }
      }
    }

    loadPreviewUrls();

    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  // Original View: render the real file with docx-preview once its
  // signed URL is known.
  useEffect(() => {
    let cancelled = false;

    async function renderOriginal() {
      if (!resumeId || renderedForIdRef.current === resumeId) return;
      if (!previewUrls) return;

      const container = originalContainerRef.current;
      if (!container) return;

      if (!previewUrls.signedUrl) {
        setOriginalStatus("error");
        setViewMode("content");
        return;
      }

      setOriginalStatus("loading");

      try {
        await withTimeout(
          (async () => {
            const fileRes = await fetch(previewUrls.signedUrl as string);

            if (!fileRes.ok) {
              throw new Error("DOWNLOAD_FAILED");
            }

            const blob = await fileRes.blob();

            // Dynamic import keeps docx-preview (a browser-only library)
            // out of any server-evaluated module graph entirely, on top
            // of only ever being called from inside this effect.
            const docxPreview = await import("docx-preview");

            if (cancelled) return;

            await docxPreview.renderAsync(blob, container, undefined, {
              // Embeds images as data URLs instead of blob object URLs,
              // so there is nothing for this component to revoke on
              // unmount or resume-id change.
              useBase64URL: true,
            });
          })(),
          RENDER_TIMEOUT_MS
        );

        if (cancelled) return;

        renderedForIdRef.current = resumeId;
        setOriginalStatus("success");
      } catch (error) {
        if (cancelled) return;

        // Never surface the raw error to the user - just fall back.
        console.error("DOCX ORIGINAL VIEW RENDER ERROR =", error);

        if (container) {
          container.innerHTML = "";
        }

        setOriginalStatus("error");
        setViewMode("content");
      }
    }

    renderOriginal();

    return () => {
      cancelled = true;
    };
  }, [resumeId, previewUrls]);

  // Unmount cleanup - clears the render container's DOM subtree. No
  // object URLs to revoke (see useBase64URL above).
  useEffect(() => {
    const container = originalContainerRef.current;

    return () => {
      if (container) {
        container.innerHTML = "";
      }
    };
  }, []);

  // Content View's own embedded images (data-asset-id) resolve against the
  // same previewUrls.assetUrls fetched above.
  useEffect(() => {
    const container = contentContainerRef.current;

    if (!container || !previewUrls) return;

    const images = Array.from(
      container.querySelectorAll<HTMLImageElement>("img[data-asset-id]")
    );

    for (const img of images) {
      const assetId = img.getAttribute("data-asset-id");
      const url = assetId && previewUrls.assetUrls[assetId];

      if (url) {
        img.setAttribute("src", url);
      }
    }
  }, [sanitizedHtml, previewUrls]);

  if (!rawHtml && originalStatus !== "success" && originalStatus !== "loading") {
    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-slate-500">
        No converted content is available for this resume.
      </div>
    );
  }

  const isFallback = viewMode === "content" && originalStatus === "error";
  const showContentDisclaimer = viewMode === "content" && originalStatus !== "error";

  return (
    <div className="mx-auto max-w-[800px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Resume
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setViewMode("original")}
            disabled={originalStatus === "error"}
            className={
              viewMode === "original"
                ? "text-xs font-bold text-blue-600 underline"
                : "text-xs font-bold text-slate-400 disabled:cursor-not-allowed disabled:text-slate-200"
            }
          >
            Original View
          </button>

          <button
            type="button"
            onClick={() => setViewMode("content")}
            className={
              viewMode === "content"
                ? "text-xs font-bold text-blue-600 underline"
                : "text-xs font-bold text-slate-400"
            }
          >
            Content View
          </button>

          {previewUrls?.signedUrl && (
            <a
              href={previewUrls.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-blue-600 underline"
            >
              Download original
            </a>
          )}
        </div>
      </div>

      {isFallback && (
        <p className="mb-3 text-xs text-slate-400">
          Showing a simplified document view because the original layout
          could not be rendered.
        </p>
      )}

      {showContentDisclaimer && (
        <p className="mb-3 text-xs text-slate-400">
          Preview preserves the document structure and images where possible.
          Some visual styling may differ from the original file.
        </p>
      )}

      {originalStatus === "loading" && viewMode === "original" && (
        <div className="h-[900px] animate-pulse rounded bg-slate-100" />
      )}

      <div
        className={
          viewMode === "original" &&
          originalStatus !== "error" &&
          originalStatus !== "loading"
            ? "overflow-x-auto"
            : "hidden"
        }
      >
        <div ref={originalContainerRef} />
      </div>

      <div
        className={
          viewMode === "content" || originalStatus === "error" ? "" : "hidden"
        }
      >
        {rawHtml ? (
          <div className="mx-auto max-w-[800px] bg-white p-8 text-slate-800">
            <div
              ref={contentContainerRef}
              className="docx-preview text-sm leading-7"
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          </div>
        ) : (
          <div className="bg-white p-8 text-sm text-slate-500">
            No converted content is available for this resume.
          </div>
        )}
      </div>
    </div>
  );
}
