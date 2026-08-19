"use client";

/*
  Phase 6G - the ONLY UI piece this round adds. Deliberately thin and
  fully self-contained (its own fetch calls, its own state) so it can
  be dropped into app/paste-job/page.tsx as a single extra JSX line
  without touching that file's own massive existing resume-preview/
  download logic at all.

  Behavior contract (round spec §12/§25):
  - canonical_template_selector_enabled=false (the Production default,
    and this round's own default everywhere) -> renders null. The
    config check itself is the ONLY extra network call made in that
    state, and it fires once per applicationId, not on every render.
  - Enabled, but no canonical generation exists yet for this
    applicationId -> also renders null (nothing to select a template
    for - this round does not add a UI trigger for canonical
    generation itself, only the template-switch experience for an
    application that already has one, per this round's own explicit
    "UI는 최소한으로" scope).
  - Enabled with an existing canonical generation -> shows the 4
    template cards. Clicking one calls /preview with the SAME
    applicationId (server resolves the SAME overlay/resume version
    from the existing tailored resume row) - never calls /generate,
    never touches AI, never consumes generate-package quota.
*/
import { useEffect, useState, useCallback, useRef } from "react";
import { useIframeFitScale } from "../shared/useIframeFitScale";
import { PAPER_DIMENSIONS } from "../../lib/resumeTemplates/shared/paperSizes";

const TEMPLATES: Array<{ id: string; name: string; description: string; atsLevel: string }> = [
  { id: "professional-ats", name: "Professional ATS", description: "Clean single-column layout tuned for applicant tracking systems.", atsLevel: "High ATS compatibility" },
  { id: "modern-sidebar", name: "Modern Sidebar", description: "Two-column layout with a skills/contact sidebar.", atsLevel: "Moderate ATS compatibility" },
  { id: "executive-minimal", name: "Executive Minimal", description: "Understated, whitespace-forward layout for senior roles.", atsLevel: "High ATS compatibility" },
  { id: "creative-timeline", name: "Creative Timeline", description: "Visual timeline layout for portfolio-style applications.", atsLevel: "Lower ATS compatibility" },
];

type CanonicalStatus = {
  selected_template_id: string | null;
  generation_engine: string | null;
};

export default function CanonicalTemplateSelector({ applicationId }: { applicationId: string | null }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<CanonicalStatus | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { scale, nativeHeight, scaledHeight, recompute } = useIframeFitScale(containerRef, iframeRef, PAPER_DIMENSIONS.letter.widthPx);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/canonical-generate-package/config")
      .then((res) => (res.ok ? res.json() : { templateSelectorEnabled: false }))
      .then((data: { templateSelectorEnabled?: boolean }) => {
        if (!cancelled) setEnabled(Boolean(data.templateSelectorEnabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !applicationId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/internal/canonical-generate-package/status?applicationId=${encodeURIComponent(applicationId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { status?: CanonicalStatus } | null) => {
        if (cancelled) return;
        if (data?.status?.generation_engine === "canonical") {
          setStatus(data.status);
          setActiveTemplateId(data.status.selected_template_id ?? "professional-ats");
        } else {
          setStatus(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, applicationId]);

  const handleSelectTemplate = useCallback(
    async (templateId: string) => {
      if (!applicationId) return;
      setLoadingTemplateId(templateId);
      setError(null);
      try {
        const res = await fetch("/api/internal/canonical-generate-package/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ applicationId, templateId, format: "html" }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message || `Preview failed (${res.status})`);
        }
        const data = (await res.json()) as { html: string };
        setActiveTemplateId(templateId);
        setPreviewHtml(data.html);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to preview this template.");
      } finally {
        setLoadingTemplateId(null);
      }
    },
    [applicationId]
  );

  /*
    Phase 6I.6.6 - auto-load the resume-tab's ONLY preview surface as
    soon as a canonical status resolves, instead of leaving previewHtml
    null until the user manually clicks a template card. Round spec §3:
    "Do not show empty tabs after successful package generation" applies
    here too - with the legacy resumePdfUrl/A4Preview duplicate removed
    from app/paste-job/page.tsx's resume tab (see that file's own Phase
    6I.6.6 comment), this component is now the sole resume preview, so
    it must render content on its own, not only after a click. Guarded
    by applicationId so a later analyzed-a-new-job cycle (a fresh
    applicationId) re-triggers exactly once, never re-fetching on every
    unrelated re-render for the SAME application.
  */
  const autoLoadedApplicationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status || !applicationId || !activeTemplateId) return;
    if (autoLoadedApplicationIdRef.current === applicationId) return;
    autoLoadedApplicationIdRef.current = applicationId;
    void handleSelectTemplate(activeTemplateId);
  }, [status, applicationId, activeTemplateId, handleSelectTemplate]);

  const handleDownload = useCallback(
    async (format: "pdf" | "docx") => {
      if (!applicationId || !activeTemplateId) return;
      try {
        const res = await fetch("/api/internal/canonical-generate-package/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ applicationId, templateId: activeTemplateId, format }),
        });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `resume-${activeTemplateId}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Download failed.");
      }
    },
    [applicationId, activeTemplateId]
  );

  if (!enabled || !status) return null;

  /*
    Which cards to show. A completed canonical generation produced exactly
    ONE template, so offering the other three here presented options that
    were never generated for this application - and, because /preview never
    persists, a switch could hand the user a download that disagreed with
    what applications.selected_template_id records.

    Matched against the RAW status.selected_template_id, deliberately NOT
    activeTemplateId. activeTemplateId carries a `?? "professional-ats"`
    fallback that exists purely so preview/download have something to
    resolve on an older row; treating that fallback as evidence of a
    selection would label pre-selected_template_id rows "Professional ATS"
    when nothing recorded that. The raw column is the only proof.

    find() gives all three required behaviours in one expression:
      - a known id            -> [that template], the single card
      - NULL / absent         -> undefined -> the full four-card list, the
                                 existing behaviour older rows already had
      - an unknown/invalid id -> undefined -> same safe fallback, never a
                                 fabricated "selected" card

    TEMPLATES itself is untouched: every definition stays, and this is the
    only place the list is narrowed.
  */
  const generatedTemplate =
    TEMPLATES.find((tpl) => tpl.id === status.selected_template_id) ?? null;
  const visibleTemplates = generatedTemplate ? [generatedTemplate] : TEMPLATES;

  return (
    <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-bold text-purple-800">Resume Template</h4>
        <div className="flex gap-2">
          <button onClick={() => handleDownload("docx")} disabled={!activeTemplateId} className="rounded-lg border border-purple-200 bg-white px-3 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
            Download DOCX
          </button>
          <button onClick={() => handleDownload("pdf")} disabled={!activeTemplateId} className="rounded-lg border border-purple-200 bg-white px-3 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
            Download PDF
          </button>
        </div>
      </div>

      {/*
        Same grid, same card markup - only the column count responds, so a
        lone generated template fills the row instead of sitting as a stray
        quarter-width tile. The four-card fallback keeps its original
        2/4-column layout exactly.
      */}
      <div
        className={`grid gap-2 ${
          visibleTemplates.length === 1
            ? "grid-cols-1"
            : "grid-cols-2 sm:grid-cols-4"
        }`}
      >
        {visibleTemplates.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => handleSelectTemplate(tpl.id)}
            disabled={loadingTemplateId === tpl.id}
            className={`rounded-xl border p-2 text-left text-[11px] transition ${activeTemplateId === tpl.id ? "border-purple-400 bg-white shadow-sm" : "border-purple-100 bg-purple-50/60 hover:bg-white"}`}
          >
            <div className="font-bold text-gray-800">{tpl.name}</div>
            <div className="mt-0.5 text-gray-500">{tpl.description}</div>
            <div className="mt-1 text-[10px] font-semibold text-purple-600">{tpl.atsLevel}</div>
            {loadingTemplateId === tpl.id ? <div className="mt-1 text-[10px] text-gray-400">Loading preview…</div> : null}
          </button>
        ))}
      </div>

      {error ? <p className="mt-2 text-[11px] font-semibold text-red-600">{error}</p> : null}

      {previewHtml ? (
        /*
          Phase 6I.6.6 (round spec §12/§15) - this is now the resume
          tab's ONLY preview surface (see app/paste-job/page.tsx's own
          Phase 6I.6.6 comment removing the legacy duplicate below it),
          so it gets a materially larger "Fit Page" frame instead of the
          old 480px "internal preview" widget size. useIframeFitScale
          shrinks the iframe (never enlarges past 100%, matching
          A4Preview/A4DocumentPreview's own established convention) so
          the FULL first page - and any subsequent pages via scroll -
          is visible without horizontal clipping, while the actual
          rendered PDF/DOCX and its template CSS stay completely
          unchanged (only this container's own scale/height responds to
          available width).
        */
        <div ref={containerRef} className="mt-3 max-h-[1400px] overflow-auto rounded-xl border border-purple-100 bg-white p-2">
          <div style={{ height: scaledHeight ?? PAPER_DIMENSIONS.letter.heightPx * scale }}>
            <iframe
              ref={iframeRef}
              title="Canonical template preview"
              srcDoc={previewHtml}
              onLoad={recompute}
              sandbox="allow-same-origin"
              style={{
                width: PAPER_DIMENSIONS.letter.widthPx,
                height: nativeHeight ?? PAPER_DIMENSIONS.letter.heightPx,
                border: 0,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
