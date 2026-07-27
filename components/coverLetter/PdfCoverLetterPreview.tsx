"use client";

import { useEffect, useState, type ReactNode } from "react";

/*
  Cover-letter counterpart of components/resume/PdfResumePreview.tsx -
  identical behavior, pointed at /api/cover-letters/[id]/preview-url.
  coverLetter.preview_mode is either:
    "pdf_original"       - always show the real uploaded PDF (guaranteed baseline)
    "pdf_reconstructed"  - best-effort text-position layout, with a
                           one-click escape hatch back to the original
*/

type PdfBlock = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
};

type PdfPage = {
  width: number;
  height: number;
  blocks: PdfBlock[];
};

export default function PdfCoverLetterPreview({
  coverLetter,
  onOriginalUnavailable,
}: {
  coverLetter: any;
  onOriginalUnavailable?: () => ReactNode;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setSignedUrl(null);
    setError("");
    setShowOriginal(true);

    async function load() {
      try {
        const res = await fetch(`/api/cover-letters/${coverLetter.id}/preview-url`);
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok || !data.signedUrl) {
          setError("This file is no longer available.");
          return;
        }

        setSignedUrl(data.signedUrl);
      } catch {
        if (!cancelled) {
          setError("Failed to load the original PDF.");
        }
      }
    }

    if (coverLetter?.id) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [coverLetter?.id, coverLetter?.preview_mode]);

  if (error) {
    if (onOriginalUnavailable) {
      return <>{onOriginalUnavailable()}</>;
    }

    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-slate-500">
        {error}
      </div>
    );
  }

  const pages: PdfPage[] = Array.isArray(coverLetter?.extracted_layout?.pages)
    ? coverLetter.extracted_layout.pages
    : [];

  const canReconstruct =
    coverLetter?.preview_mode === "pdf_reconstructed" && pages.length > 0;

  return (
    <div className="mx-auto max-w-[800px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Cover Letter (Original PDF)
        </p>

        <div className="flex items-center gap-3">
          {canReconstruct && (
            <button
              type="button"
              onClick={() => setShowOriginal((prev) => !prev)}
              className="text-xs font-bold text-blue-600 underline"
            >
              {showOriginal ? "View reconstructed layout" : "View original PDF"}
            </button>
          )}

          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-blue-600 underline"
            >
              Download original
            </a>
          )}
        </div>
      </div>

      {!signedUrl ? (
        <div className="h-[900px] animate-pulse rounded bg-slate-100" />
      ) : showOriginal || !canReconstruct ? (
        <iframe
          src={signedUrl}
          title="Original cover letter PDF"
          className="h-[900px] w-full rounded border border-slate-200 bg-white shadow"
        />
      ) : (
        <div className="space-y-6">
          {pages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-white shadow"
              style={{
                width: 794,
                height: (794 / page.width) * page.height,
              }}
            >
              {page.blocks.map((block, blockIndex) => (
                <span
                  key={blockIndex}
                  className="absolute whitespace-pre font-sans text-slate-800"
                  style={{
                    left: (block.x / page.width) * 794,
                    top: (block.y / page.height) * ((794 / page.width) * page.height),
                    fontSize: Math.max(
                      8,
                      (block.fontSize / page.width) * 794
                    ),
                  }}
                >
                  {block.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
