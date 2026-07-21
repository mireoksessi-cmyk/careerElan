"use client";

import { useEffect, useState } from "react";

/*
  resume.preview_mode is either:
    "pdf_original"      - always show the real uploaded PDF (guaranteed baseline)
    "pdf_reconstructed"  - best-effort text-position layout from pdfjs-dist,
                            with a one-click escape hatch back to the original
  Both need a signed URL for the original file, fetched from
  /api/resumes/[id]/preview-url (short-lived, minted server-side after an
  ownership check - never a public/permanent URL).
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

export default function PdfResumePreview({ resume }: { resume: any }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(
    resume?.preview_mode === "pdf_original"
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/resumes/${resume.id}/preview-url`);
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

    if (resume?.id) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [resume?.id]);

  if (error) {
    return (
      <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-slate-500">
        {error}
      </div>
    );
  }

  const pages: PdfPage[] = Array.isArray(resume?.extracted_layout?.pages)
    ? resume.extracted_layout.pages
    : [];

  const canReconstruct =
    resume?.preview_mode === "pdf_reconstructed" && pages.length > 0;

  return (
    <div className="mx-auto max-w-[800px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Resume (Original PDF)
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
          title="Original resume PDF"
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
