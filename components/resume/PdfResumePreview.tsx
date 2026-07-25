"use client";

import { useEffect, useState, type ReactNode } from "react";

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

export default function PdfResumePreview({
  resume,
  onOriginalUnavailable,
}: {
  resume: any;
  /*
    Called only when the signed-URL request for the original file itself
    genuinely fails (deleted from Storage, network error) - the one case
    where falling back to this resume's own extracted text is correct.
    Optional so existing callers (e.g. a row already known to be
    conversion_status="succeeded") keep their current plain error message
    if they don't pass it.
  */
  onOriginalUnavailable?: () => ReactNode;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  /*
    Always defaults to the true original PDF, regardless of preview_mode -
    the reconstructed layout (naive x/y-positioned text spans from
    pdfjs-dist) is a best-effort auxiliary view, not a substitute for the
    real file, and can look visibly broken for complex real-world resumes.
    Previously this defaulted to `preview_mode === "pdf_original"`, which
    meant any resume whose reconstruction had succeeded
    (preview_mode "pdf_reconstructed") silently showed the shaky
    reconstructed layout first instead of the actual PDF - the opposite of
    the intended "original always wins unless the user opts into the
    reconstruction" behavior. The toggle button still lets the user switch
    to the reconstructed view manually.
  */
  const [showOriginal, setShowOriginal] = useState(true);

  useEffect(() => {
    let cancelled = false;

    /*
      Reset every piece of per-resume state up front, before the new
      fetch resolves - without this, switching from resume A to resume B
      briefly (or, if B's fetch fails, permanently) kept showing A's
      signedUrl/iframe, and showOriginal stayed stuck at whatever A's
      preview_mode had set it to instead of reflecting B's.
    */
    setSignedUrl(null);
    setError("");
    setShowOriginal(true);

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
  }, [resume?.id, resume?.preview_mode]);

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
