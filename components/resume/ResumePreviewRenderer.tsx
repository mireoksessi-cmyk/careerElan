"use client";

import { useState } from "react";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanTemplatePreview from "./CareerElanTemplatePreview";
import DocxResumePreview from "./DocxResumePreview";
import PdfResumePreview from "./PdfResumePreview";

/*
  Single shared entry point for previewing an uploaded resume, used by both
  the Dashboard preview modal and the Paste Job URL "Saved Application
  Preview". Picks a sub-renderer from the resume row's stored
  conversion_status/preview_mode - never from the file extension - so a
  pending/failed/unsupported row (including every pre-existing row, where
  these columns are simply NULL) falls back to the exact same plain-text/
  structured template preview the app already rendered before this feature
  existed.
*/

const RETRYABLE_STATUSES = ["pending", "failed"];

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
        <p>원본 디자인을 아직 처리하지 못했어요.</p>
      ) : (
        <p>
          원본 디자인 처리에 실패했어요
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
          {status === "retrying" ? "처리 중..." : "다시 처리하기"}
        </button>

        {status === "done" && (
          <span className="text-xs font-semibold">
            요청했어요. 잠시 후 미리보기를 다시 열어주세요.
          </span>
        )}

        {status === "error" && (
          <span className="text-xs font-semibold text-red-600">
            요청에 실패했어요. 다시 시도해주세요.
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

    case "pdf_original":
    case "pdf_reconstructed":
      return <PdfResumePreview resume={resume} />;

    default:
      return (
        <CareerElanTemplatePreview resume={resume} fallbackText={fallbackText} />
      );
  }
}
