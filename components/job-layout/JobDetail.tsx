"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import A4Preview from "@/app/job-tracker/A4Preview";
import A4DocumentPreview from "@/lib/brand/render/A4DocumentPreview";
import { useIframeFitScale } from "@/components/shared/useIframeFitScale";
import { PAPER_DIMENSIONS } from "@/lib/resumeTemplates/shared/paperSizes";
import { useToast } from "@/components/ui/ToastProvider";

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
  const toast = useToast();
  const [canonicalPreviewStatus, setCanonicalPreviewStatus] = useState<"idle" | "loading" | "ready" | "artifact" | "not-applicable" | "error">("idle");
  const [canonicalPreviewHtml, setCanonicalPreviewHtml] = useState<string | null>(null);
  /*
    A generated Package is an immutable historical snapshot: it was
    produced from the canonical resume version recorded on its own
    tailored-resume row, and it must keep showing THAT version no matter
    how far the profile's canonical resume advances afterwards.

    The live /canonical-generate-package/preview route cannot express
    that. It reconstructs the profile's CURRENT latest version and 409s
    when it no longer matches the package's pinned resume_version_id -
    which, now that Career Memory's Edit Content writes a new version on
    every save, is the normal state of every previously generated
    package. The result was a package whose rows and stored artifacts
    were both perfectly intact appearing broken.

    The persisted PDF that Generate Package already wrote to Storage at
    generation time IS the historical snapshot - the exact bytes the
    user was shown when the package was created. Serving those is both
    the most faithful answer and the only one that stays correct without
    re-deriving anything from a moving profile.

    Held in a ref as well as state because an object URL is a resource,
    not a value: it must be revoked when it is replaced and when this
    component unmounts, and the effect that does so cannot read it from
    a stale state closure.
  */
  const [canonicalArtifactUrl, setCanonicalArtifactUrl] = useState<string | null>(null);
  const canonicalArtifactUrlRef = useRef<string | null>(null);

  const releaseCanonicalArtifactUrl = useCallback(() => {
    if (canonicalArtifactUrlRef.current) {
      URL.revokeObjectURL(canonicalArtifactUrlRef.current);
      canonicalArtifactUrlRef.current = null;
    }
    setCanonicalArtifactUrl(null);
  }, []);
  /*
    Phase 6I.9 - race guard: loadCanonicalPreview() is re-invoked every
    time selectedApplication changes (see the effect below). Without
    this, a slow in-flight request for a PREVIOUSLY selected application
    could resolve after a newer request for the CURRENTLY selected
    application already finished, and silently overwrite the correct
    preview with stale content. Every invocation claims a new id here
    before doing anything else; each setState after an await is guarded
    by isStale(), which is false only for the single most-recent call.
  */
  const previewRequestIdRef = useRef(0);
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
    const requestId = ++previewRequestIdRef.current;
    const isStale = () => requestId !== previewRequestIdRef.current;

    /*
      Phase 6I.9 - clear the previous application's preview immediately,
      synchronously, before this request even starts, so a still-mounting
      iframe can never render leftover content from the application that
      was selected a moment ago.
    */
    setCanonicalPreviewHtml(null);
    releaseCanonicalArtifactUrl();

    if (!selectedApplication || selectedApplication.generation_engine !== "canonical") {
      setCanonicalPreviewStatus("not-applicable");
      return;
    }
    setCanonicalPreviewStatus("loading");

    /*
      Historical artifact first. The route resolves the document id and
      Storage path entirely server-side from this application's own
      generated_pdf_document_id, so nothing here can address an
      arbitrary object; a 404 means simply "this package has no
      persisted PDF" (an older canonical row generated before artifact
      persistence existed) and falls through to the pre-existing live
      path below, which is left exactly as it was.

      No re-render happens on this branch: the bytes are read from
      Storage, so no template engine and no headless browser is
      involved, and the result cannot drift as the profile advances.
    */
    try {
      const artifactRes = await fetch(
        `/api/applications/${selectedApplication.id}/generated-resume-document?format=pdf`
      );
      if (isStale()) return;
      if (artifactRes.ok) {
        const artifactBlob = await artifactRes.blob();
        if (isStale()) return;
        const objectUrl = URL.createObjectURL(artifactBlob);
        canonicalArtifactUrlRef.current = objectUrl;
        setCanonicalArtifactUrl(objectUrl);
        setCanonicalPreviewStatus("artifact");
        return;
      }
    } catch {
      /* Network/decode failure only - fall through to the live path
         below rather than failing a preview that can still be produced. */
    }

    try {
      /*
        Phase 6I.9 - reuse Generate Package's OWN reference preview
        mechanism exactly (CanonicalTemplateSelector.tsx's own
        handleSelectTemplate): call the SAME /canonical-generate-package
        /preview endpoint with the SAME applicationId and the SAME
        generation-time selected_template_id, instead of reading the
        persisted Storage artifact through a separate endpoint. The
        template id is read directly off the already-loaded application
        row - never re-resolved against the user's CURRENT profile
        default when selected_template_id is already present, matching
        CanonicalTemplateSelector's own "selected_template_id ?? ...
        fallback" seeding exactly. Only an OLDER row that never recorded
        a selected_template_id at all falls back to the existing
        resolve-template priority chain below (unchanged, pre-existing
        safe fallback - not a new one introduced by this phase).
      */
      let templateId: string | null =
        typeof selectedApplication.selected_template_id === "string" && selectedApplication.selected_template_id
          ? selectedApplication.selected_template_id
          : null;

      if (!templateId) {
        const resolveRes = await fetch(`/api/internal/canonical-career-memory/resolve-template?applicationId=${selectedApplication.id}`);
        if (isStale()) return;
        const resolution = resolveRes.ok ? await resolveRes.json() : null;
        if (isStale()) return;
        if (resolution?.kind !== "canonical") {
          setCanonicalPreviewStatus("not-applicable");
          return;
        }
        templateId = resolution.templateId;
      }

      const previewRes = await fetch("/api/internal/canonical-generate-package/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id, templateId, format: "html" }),
      });
      if (isStale()) return;
      if (!previewRes.ok) {
        setCanonicalPreviewStatus("error");
        return;
      }
      const data = await previewRes.json();
      if (isStale()) return;
      setCanonicalPreviewHtml(data.html ?? "");
      setCanonicalPreviewStatus("ready");
    } catch {
      if (!isStale()) setCanonicalPreviewStatus("error");
    }
  }, [selectedApplication, releaseCanonicalArtifactUrl]);

  useEffect(() => {
    loadCanonicalPreview();
  }, [loadCanonicalPreview]);

  /* Unmount only - revoking on every re-render would tear down the URL
     the iframe is currently displaying. */
  useEffect(() => {
    return () => {
      if (canonicalArtifactUrlRef.current) {
        URL.revokeObjectURL(canonicalArtifactUrlRef.current);
        canonicalArtifactUrlRef.current = null;
      }
    };
  }, []);

  if (!selectedApplication) {
    return (
      <div className="rounded-3xl border border-blue-100 bg-white p-10 shadow-sm">
        <div className="flex h-[700px] items-center justify-center text-slate-400">
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

          <p className="mt-2 text-lg text-slate-600">
            {selectedApplication.job_title}
          </p>

          <p className="mt-2 text-sm text-slate-400">
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
          <p className="mb-2 text-xs font-bold uppercase text-slate-500">
            Status
          </p>

          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
            className="w-full rounded-xl border border-slate-300 p-3"
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
          <p className="mb-2 text-xs font-bold uppercase text-slate-500">
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
            className="w-full rounded-xl border border-slate-300 p-3"
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
              ? "cursor-not-allowed bg-slate-300"
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

            toast.success("Copied!");
          }}
          className="rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-100"
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
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-blue-50"
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
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-blue-50"
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
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-blue-50"
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
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-blue-50"
          }`}
        >
          Notes
        </button>
      </div>

      <div className="mt-8">
        {selectedTab === "resume" && (
          <>
            {canonicalPreviewStatus === "artifact" ? (
              /*
                The package's own persisted PDF, shown in the browser's
                native PDF viewer. No transform:scale() wrapper here -
                unlike the fixed-816px-wide srcDoc page below, a PDF
                viewer does its own fitting, so imposing an outer scale
                would fight it.
              */
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                <iframe
                  key={`${selectedApplication.id}-artifact`}
                  src={canonicalArtifactUrl ?? ""}
                  title="Generated resume package"
                  style={{ width: "100%", height: 1100, border: 0 }}
                />
              </div>
            ) : canonicalPreviewStatus === "ready" ? (
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
          <div className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
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
              className="h-64 w-full rounded-xl border border-slate-300 p-4 outline-none focus:border-blue-500"
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