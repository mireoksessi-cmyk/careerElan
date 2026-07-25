"use client";

import { useState } from "react";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanTemplatePreview from "./CareerElanTemplatePreview";
import DocxResumePreview from "./DocxResumePreview";
import PdfResumePreview from "./PdfResumePreview";

/*
  Single shared entry point for previewing an uploaded resume, used by both
  the Dashboard preview modal and the Paste Job URL "Saved Application
  Preview".

  PDF routing is deliberately independent of conversion_status/preview_mode:
  the raw original file (via a signed Storage URL, see PdfResumePreview) is
  always displayable the moment a PDF has been uploaded, regardless of
  whether the separate best-effort layout-reconstruction pipeline
  (process-resume-design) has run, is still pending, or failed for that
  row. Gating the original PDF display on conversion_status - as this used
  to do - meant only whichever PDF happened to already have a *succeeded*
  reconstruction showed its real file; every other PDF (pending/processing/
  failed, including simply not-yet-processed rows) silently fell back to
  the plain-text template, which looked like "only the first uploaded PDF
  has a preview" whenever reconstruction hadn't caught up for the others.
  PdfResumePreview itself already degrades gracefully when there's no
  reconstructed layout (canReconstruct is false) by just always showing the
  original iframe - it never needed conversion_status to be "succeeded" in
  the first place.

  DOCX previewing is unaffected: browsers can't render .docx natively the
  way an <iframe> can render a PDF, so DocxResumePreview genuinely does
  need the HTML produced by the conversion step and stays gated on
  conversion_status/preview_mode as before.
*/

const RETRYABLE_STATUSES = ["pending", "failed"];

function isPdfResume(resume: any): boolean {
  if (!resume) return false;
  if (resume.original_file_type === "pdf") return true;

  const name = String(resume.file_name || "").toLowerCase();
  return name.endsWith(".pdf");
}

function RetryProcessingBanner({ resume }: { resume: any }) {
  const { refresh } = useLogin();
  const [status, setStatus] = useState<"idle" | "retrying" | "done" | "error">(
    "idle"
  );

  if (!resume?.id || !RETRYABLE_STATUSES.includes(resume.conversion_status)) {
    return null;
  }

  async function handleRetry() {
    setStatus("retrying");

    try {
      const res = await fetch("/api/process-resume-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: resume.id }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      // Refreshes resumes in the background so the next time this preview
      // is opened it reflects the new status. This does not auto-retry -
      // it's a one-shot response to the user's own click.
      await refresh();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto mb-4 max-w-[800px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {resume.conversion_status === "pending" ? (
        <p>We haven&apos;t processed the original design yet.</p>
      ) : (
        <p>
          We couldn&apos;t process the original design
          {resume.conversion_error ? ` (${resume.conversion_error})` : ""}.
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

export default function ResumePreviewRenderer({
  resume,
  fallbackText,
}: {
  resume?: any;
  fallbackText?: string;
}) {
  /*
    PDF: always try the original file first, independent of
    conversion_status - see the module doc comment above for why. Only
    requirement is that a Storage file was actually uploaded for this row;
    PdfResumePreview itself falls back to the plain-text template (via
    onOriginalUnavailable) if the signed-URL request genuinely fails.
  */
  if (resume && isPdfResume(resume) && resume.storage_path) {
    return (
      <>
        <RetryProcessingBanner resume={resume} />
        <PdfResumePreview
          resume={resume}
          onOriginalUnavailable={() => (
            <CareerElanTemplatePreview
              resume={resume}
              fallbackText={fallbackText}
            />
          )}
        />
      </>
    );
  }

  const isUsable =
    resume && resume.conversion_status === "succeeded" && resume.preview_mode;

  if (!isUsable) {
    return (
      <>
        <RetryProcessingBanner resume={resume} />
        <CareerElanTemplatePreview resume={resume} fallbackText={fallbackText} />
      </>
    );
  }

  switch (resume.preview_mode) {
    case "docx_html":
      return <DocxResumePreview resume={resume} />;

    default:
      return (
        <CareerElanTemplatePreview resume={resume} fallbackText={fallbackText} />
      );
  }
}
