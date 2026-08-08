"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import A4Preview from "@/app/job-tracker/A4Preview";
import A4DocumentPreview from "@/lib/brand/render/A4DocumentPreview";
import ApplicationTemplateSwitcher from "@/components/canonicalGeneratePackage/ApplicationTemplateSwitcher";
import { useIframeFitScale } from "@/components/shared/useIframeFitScale";
import { PAPER_DIMENSIONS } from "@/lib/resumeTemplates/shared/paperSizes";

type Props = {
  selectedApplication: any;

  selectedTab: string;
  setSelectedTab: any;

  status: string;
  setStatus: any;

  interviewDate: string;
  setInterviewDate: any;

  notes: string;
  setNotes: any;

  saveStatus: any;
  saveInterviewDate: any;
  saveNotes: any;
  clearNotes: any;

  downloadPackage: any;
  deleteApplication: any;
};

function formatSavedInterviewDate(
  value: string | null | undefined
) {
  if (!value) {
    return "";
  }

  const dateOnly = String(value).slice(0, 10);

  const [year, month, day] = dateOnly
    .split("-")
    .map(Number);

  if (!year || !month || !day) {
    return "";
  }

  const date = new Date(
    year,
    month - 1,
    day
  );

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function JobDetail({
  selectedApplication,

  selectedTab,
  setSelectedTab,

  status,
  setStatus,

  interviewDate,
  setInterviewDate,

  notes,
  setNotes,

  saveStatus,
  saveInterviewDate,
  saveNotes,
  clearNotes,

  downloadPackage,
  deleteApplication,
}: Props) {
  /*
    Phase 6I.3 (spec section 6) - for a canonical application, this tab
    must render the TAILORED resume (application.selected_template_id
    -> profile.default_template_id, via the same resolve-template
    priority endpoint already used everywhere else) instead of the
    legacy resume_text/resume_template_id snapshot A4DocumentPreview
    always used before. Uses the EXISTING applicationId+overlay-based
    /canonical-generate-package/preview route (unmodified - no new
    tailored-render endpoint needed) via srcDoc rather than an iframe
    src URL, since that route needs a POST body (templateId,
    applicationId) that a plain <iframe src> GET cannot express - see
    that route's own header comment for why it must stay POST (it
    reconstructs and verifies the tailored overlay against the
    profile's CURRENT resume version before rendering). Hooks are
    declared before the early "no application selected" return below,
    per React's rule that hooks always run in the same order.
  */
  const [canonicalPreviewStatus, setCanonicalPreviewStatus] = useState<"idle" | "loading" | "ready" | "not-applicable" | "error">("idle");
  const [canonicalPreviewHtml, setCanonicalPreviewHtml] = useState<string | null>(null);
  /*
    Phase 6I.6.6 (round spec §15) - same shared "Fit Page" scaling as
    Paste Job's CanonicalTemplateSelector, so the now-wider (xl:col-span-6,
    up from 5) resume column actually grows the visible page instead of
    the fixed-pixel-width srcDoc page just sitting at native 816px inside
    a wider card. See useIframeFitScale.ts's own header comment for why
    this can't be a per-call-site transform.
  */
  const canonicalPreviewContainerRef = useRef<HTMLDivElement | null>(null);
  const canonicalPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const { scale: canonicalPreviewScale, nativeHeight: canonicalPreviewNativeHeight, scaledHeight: canonicalPreviewScaledHeight, recompute: recomputeCanonicalPreviewScale } = useIframeFitScale(canonicalPreviewContainerRef, canonicalPreviewIframeRef, PAPER_DIMENSIONS.letter.widthPx);

  const loadCanonicalPreview = useCallback(async () => {
    if (!selectedApplication || selectedApplication.generation_engine !== "canonical") {
      setCanonicalPreviewStatus("not-applicable");
      return;
    }
    setCanonicalPreviewStatus("loading");
    try {
      const resolveRes = await fetch(`/api/internal/canonical-career-memory/resolve-template?applicationId=${selectedApplication.id}`);
      const resolution = resolveRes.ok ? await resolveRes.json() : null;
      if (resolution?.kind !== "canonical") {
        setCanonicalPreviewStatus("not-applicable");
        return;
      }
      const previewRes = await fetch("/api/internal/canonical-generate-package/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id, templateId: resolution.templateId, format: "html" }),
      });
      if (!previewRes.ok) {
        setCanonicalPreviewStatus("error");
        return;
      }
      const data = await previewRes.json();
      setCanonicalPreviewHtml(data.html ?? "");
      setCanonicalPreviewStatus("ready");
    } catch {
      setCanonicalPreviewStatus("error");
    }
  }, [selectedApplication]);

  useEffect(() => {
    loadCanonicalPreview();
  }, [loadCanonicalPreview]);

  if (!selectedApplication) {
    return (
      <div className="rounded-3xl border border-blue-100 bg-white p-10 shadow-sm">
        <div className="flex h-[700px] items-center justify-center text-gray-400">
          Select an application.
        </div>
      </div>
    );
  }

  const formattedInterviewDate =
    formatSavedInterviewDate(
      selectedApplication.interview_date
    );

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-8 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-extrabold">
            {selectedApplication.company}
          </h2>

          <p className="mt-2 text-lg text-gray-600">
            {selectedApplication.job_title}
          </p>

          <p className="mt-2 text-sm text-gray-400">
            📍{" "}
            {selectedApplication.location ||
              "Location unavailable"}
          </p>

          {selectedApplication.id && (
            <Link
              href={`/paste-job?applicationId=${selectedApplication.id}`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
            >
              View in Paste Job →
            </Link>
          )}
        </div>

        <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
          {status}
        </span>
      </div>

      <hr className="my-8" />

      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-gray-500">
            Status
          </p>

          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
            className="w-full rounded-xl border border-gray-200 p-3"
          >
            <option value="">Status</option>
            <option value="Applied">
              Applied
            </option>
            <option value="Interview">
              Interview
            </option>
            <option value="Offer">
              Offer
            </option>
            <option value="Accepted">
              Accepted
            </option>
            <option value="Rejected">
              Rejected
            </option>
          </select>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase text-gray-500">
            Interview Date
          </p>

          <input
            type="date"
            value={interviewDate}
            onChange={(e) =>
              setInterviewDate(
                e.target.value
              )
            }
            className="w-full rounded-xl border border-gray-200 p-3"
          />

          {status === "Interview" && (
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {formattedInterviewDate
                ? `Scheduled for ${formattedInterviewDate}`
                : "Interview date has not been scheduled yet."}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          onClick={saveStatus}
          disabled={!status}
          className={`rounded-xl px-4 py-2 font-bold text-white ${
            !status
              ? "cursor-not-allowed bg-gray-300"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          Save Status
        </button>

        <button
          onClick={saveInterviewDate}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          Save Date
        </button>

        <button
          onClick={() =>
            downloadPackage("pdf")
          }
          className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700"
        >
          Download PDF
        </button>

        <button
          onClick={() =>
            downloadPackage("docx")
          }
          className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700"
        >
          Download Word
        </button>
      </div>

      <hr className="my-8" />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() =>
            window.open(
              selectedApplication.job_url,
              "_blank"
            )
          }
          className="rounded-xl border border-blue-600 px-5 py-3 font-semibold text-blue-600 hover:bg-blue-50"
        >
          Open Job Posting
        </button>

        <button
          onClick={() => {
            navigator.clipboard.writeText(
              selectedApplication.job_url
            );

            alert("Copied!");
          }}
          className="rounded-xl border border-gray-300 px-5 py-3 font-semibold hover:bg-gray-100"
        >
          Copy URL
        </button>

        <button
          onClick={deleteApplication}
          className="rounded-xl bg-red-800 px-5 py-3 font-semibold text-white hover:bg-red-900"
        >
          Delete Package
        </button>
      </div>

      <hr className="my-8" />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() =>
            setSelectedTab("resume")
          }
          className={`rounded-xl px-5 py-3 font-semibold transition ${
            selectedTab === "resume"
              ? "bg-blue-600 text-black"
              : "bg-gray-100 text-black hover:bg-blue-50"
          }`}
        >
          Resume
        </button>

        <button
          onClick={() =>
            setSelectedTab("cover")
          }
          className={`rounded-xl px-5 py-3 font-semibold transition ${
            selectedTab === "cover"
              ? "bg-blue-600 text-black"
              : "bg-gray-100 text-black hover:bg-blue-50"
          }`}
        >
          Cover Letter
        </button>

        <button
          onClick={() =>
            setSelectedTab("email")
          }
          className={`rounded-xl px-5 py-3 font-semibold transition ${
            selectedTab === "email"
              ? "bg-blue-600 text-black"
              : "bg-gray-100 text-black hover:bg-blue-50"
          }`}
        >
          Email
        </button>

        <button
          onClick={() =>
            setSelectedTab("notes")
          }
          className={`rounded-xl px-5 py-3 font-semibold transition ${
            selectedTab === "notes"
              ? "bg-blue-600 text-black"
              : "bg-gray-100 text-black hover:bg-blue-50"
          }`}
        >
          Notes
        </button>
      </div>

      <div className="mt-8">
        {selectedTab === "resume" && (
          <>
            {canonicalPreviewStatus === "ready" ? (
              <div ref={canonicalPreviewContainerRef} className="max-h-[1500px] overflow-auto rounded-2xl border border-slate-200 bg-white p-2">
                <div style={{ height: canonicalPreviewScaledHeight ?? PAPER_DIMENSIONS.letter.heightPx * canonicalPreviewScale }}>
                  <iframe
                    key={selectedApplication.id}
                    ref={canonicalPreviewIframeRef}
                    srcDoc={canonicalPreviewHtml ?? ""}
                    onLoad={recomputeCanonicalPreviewScale}
                    title="Canonical resume preview"
                    sandbox="allow-same-origin"
                    style={{
                      width: PAPER_DIMENSIONS.letter.widthPx,
                      height: canonicalPreviewNativeHeight ?? PAPER_DIMENSIONS.letter.heightPx,
                      border: 0,
                      transform: `scale(${canonicalPreviewScale})`,
                      transformOrigin: "top left",
                    }}
                  />
                </div>
              </div>
            ) : canonicalPreviewStatus === "loading" ? (
              <div className="flex h-[600px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-500">Loading resume preview...</div>
            ) : (
              <A4DocumentPreview
                text={
                  selectedApplication.resume_text ||
                  ""
                }
                templateId={selectedApplication.resume_template_id}
              />
            )}
            {selectedApplication.generation_engine === "canonical" && (
              <div className="mt-6">
                <ApplicationTemplateSwitcher applicationId={selectedApplication.id} onTemplateChanged={loadCanonicalPreview} />
              </div>
            )}
          </>
        )}

        {selectedTab === "cover" && (
          <A4Preview
            text={
              selectedApplication.cover_letter_text ||
              ""
            }
          />
        )}

        {selectedTab === "email" && (
          <div className="whitespace-pre-wrap rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            {
              selectedApplication.email_draft
            }
          </div>
        )}

        {selectedTab === "notes" && (
          <div>
            <textarea
              value={notes}
              onChange={(e) =>
                setNotes(e.target.value)
              }
              className="h-64 w-full rounded-xl border border-gray-200 p-4 outline-none focus:border-blue-500"
            />

            <div className="mt-4 flex gap-3">
              <button
                onClick={saveNotes}
                className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
              >
                Save Notes
              </button>

              <button
                onClick={clearNotes}
                className="rounded-xl bg-red-700 px-5 py-3 font-semibold text-white hover:bg-red-800"
              >
                Delete Notes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}