"use client";

import { useState } from "react";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanCoverLetterPreview from "./CareerElanCoverLetterPreview";
import DocxCoverLetterPreview from "./DocxCoverLetterPreview";
import PdfCoverLetterPreview from "./PdfCoverLetterPreview";

/*
  Cover-letter counterpart of components/resume/ResumePreviewRenderer.tsx -
  single shared entry point for previewing an uploaded cover letter, used
  by both the Dashboard preview modal and the Paste Job "Saved Application
  Preview". Same PDF-independent-of-conversion_status reasoning as the
  resume version (see that file's own doc comment): the raw original file
  is always displayable the moment a PDF has been uploaded, regardless of
  whether the separate best-effort layout-reconstruction pipeline has run.

  A cover_letters row with no original_file_type/conversion_status at all
  (every row created before this feature existed) falls through to
  CareerElanCoverLetterPreview unchanged - this is the "legacy text-only
  cover letter falls back to the existing text preview" requirement.
*/

const RETRYABLE_STATUSES = ["pending", "failed"];

function isPdfCoverLetter(coverLetter: any): boolean {
  if (!coverLetter) return false;
  if (coverLetter.original_file_type === "pdf") return true;

  const name = String(coverLetter.file_name || "").toLowerCase();
  return name.endsWith(".pdf");
}

function RetryProcessingBanner({ coverLetter }: { coverLetter: any }) {
  const { refresh } = useLogin();
  const [status, setStatus] = useState<"idle" | "retrying" | "done" | "error">(
    "idle"
  );

  if (
    !coverLetter?.id ||
    !RETRYABLE_STATUSES.includes(coverLetter.conversion_status)
  ) {
    return null;
  }

  async function handleRetry() {
    setStatus("retrying");

    try {
      const res = await fetch("/api/process-cover-letter-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetterId: coverLetter.id }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      await refresh();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto mb-4 max-w-[800px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {coverLetter.conversion_status === "pending" ? (
        <p>We haven&apos;t processed the original design yet.</p>
      ) : (
        <p>
          We couldn&apos;t process the original design
          {coverLetter.conversion_error ? ` (${coverLetter.conversion_error})` : ""}.
        </p>
      )}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          disabled={status === "retrying"}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
        >
          {status === "retrying" ? "Processing..." : "Try again"}
        </button>

        {status === "done" && (
          <span className="text-xs font-semibold">
            Request sent. Reopen the preview in a moment to see the result.
          </span>
        )}

        {status === "error" && (
          <span className="text-xs font-semibold text-red-600">
            The request failed. Please try again.
          </span>
        )}
      </div>
    </div>
  );
}

function PdfCoverLetterPreviewWithBanner({
  coverLetter,
  fallbackText,
}: {
  coverLetter: any;
  fallbackText?: string;
}) {
  const [originalPdfFailed, setOriginalPdfFailed] = useState(false);

  return (
    <>
      {originalPdfFailed && <RetryProcessingBanner coverLetter={coverLetter} />}
      <PdfCoverLetterPreview
        coverLetter={coverLetter}
        onOriginalUnavailable={() => {
          setOriginalPdfFailed(true);
          return (
            <CareerElanCoverLetterPreview
              coverLetter={coverLetter}
              fallbackText={fallbackText}
            />
          );
        }}
      />
    </>
  );
}

export default function CoverLetterPreviewRenderer({
  coverLetter,
  fallbackText,
}: {
  coverLetter?: any;
  fallbackText?: string;
}) {
  if (coverLetter && isPdfCoverLetter(coverLetter) && coverLetter.storage_path) {
    return (
      <PdfCoverLetterPreviewWithBanner
        coverLetter={coverLetter}
        fallbackText={fallbackText}
      />
    );
  }

  const isUsable =
    coverLetter &&
    coverLetter.conversion_status === "succeeded" &&
    coverLetter.preview_mode;

  if (!isUsable) {
    return (
      <>
        <RetryProcessingBanner coverLetter={coverLetter} />
        <CareerElanCoverLetterPreview
          coverLetter={coverLetter}
          fallbackText={fallbackText}
        />
      </>
    );
  }

  switch (coverLetter.preview_mode) {
    case "docx_html":
      return <DocxCoverLetterPreview coverLetter={coverLetter} />;

    default:
      return (
        <CareerElanCoverLetterPreview
          coverLetter={coverLetter}
          fallbackText={fallbackText}
        />
      );
  }
}
