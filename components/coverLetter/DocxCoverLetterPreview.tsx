"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

/*
  Cover-letter counterpart of components/resume/DocxResumePreview.tsx -
  identical two-view (Original/Content) behavior, pointed at
  /api/cover-letters/[id]/preview-url.
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

export default function DocxCoverLetterPreview({ coverLetter }: { coverLetter: any }) {
  const coverLetterId: string | undefined = coverLetter?.id;
  const rawHtml: string = coverLetter?.extracted_layout?.html || "";

  const sanitizedHtml = useMemo(() => {
    if (!rawHtml) return "";

    return DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
  }, [rawHtml]);

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const originalContainerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("original");
  const [originalStatus, setOriginalStatus] = useState<OriginalStatus>("idle");
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls | null>(null);

  const fetchedForIdRef = useRef<string | null>(null);
  const renderedForIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (fetchedForIdRef.current !== coverLetterId) {
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
      if (!coverLetterId || fetchedForIdRef.current === coverLetterId) return;

      try {
        const res = await fetch(`/api/cover-letters/${coverLetterId}/preview-url`);
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          fetchedForIdRef.current = coverLetterId;
          setPreviewUrls({ signedUrl: null, assetUrls: {} });
          return;
        }

        fetchedForIdRef.current = coverLetterId;
        setPreviewUrls({
          signedUrl: data.signedUrl || null,
          assetUrls: data.assetUrls || {},
        });
      } catch {
        if (!cancelled) {
          fetchedForIdRef.current = coverLetterId;
          setPreviewUrls({ signedUrl: null, assetUrls: {} });
        }
      }
    }

    loadPreviewUrls();

    return () => {
      cancelled = true;
    };
  }, [coverLetterId]);

  useEffect(() => {
    let cancelled = false;

    async function renderOriginal() {
      if (!coverLetterId || renderedForIdRef.current === coverLetterId) return;
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

            const docxPreview = await import("docx-preview");

            if (cancelled) return;

            await docxPreview.renderAsync(blob, container, undefined, {
              useBase64URL: true,
            });
          })(),
          RENDER_TIMEOUT_MS
        );

        if (cancelled) return;

        renderedForIdRef.current = coverLetterId;
        setOriginalStatus("success");
      } catch (error) {
        if (cancelled) return;

        console.error("COVER LETTER DOCX ORIGINAL VIEW RENDER ERROR =", error);

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
  }, [coverLetterId, previewUrls]);

  useEffect(() => {
    const container = originalContainerRef.current;

    return () => {
      if (container) {
        container.innerHTML = "";
      }
    };
  }, []);

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
        No converted content is available for this cover letter.
      </div>
    );
  }

  const isFallback = viewMode === "content" && originalStatus === "error";
  const showContentDisclaimer = viewMode === "content" && originalStatus !== "error";

  return (
    <div className="mx-auto max-w-[800px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Cover Letter
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
            No converted content is available for this cover letter.
          </div>
        )}
      </div>
    </div>
  );
}
