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
import { useEffect, useState, useCallback } from "react";

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

  return (
    <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-bold text-purple-800">Canonical Templates (internal preview)</h4>
        <div className="flex gap-2">
          <button onClick={() => handleDownload("docx")} disabled={!activeTemplateId} className="rounded-lg border border-purple-200 bg-white px-3 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
            Download DOCX
          </button>
          <button onClick={() => handleDownload("pdf")} disabled={!activeTemplateId} className="rounded-lg border border-purple-200 bg-white px-3 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50">
            Download PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TEMPLATES.map((tpl) => (
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
        <div className="mt-3 max-h-[480px] overflow-auto rounded-xl border border-purple-100 bg-white p-2">
          <iframe title="Canonical template preview" srcDoc={previewHtml} className="h-[440px] w-full border-0" sandbox="" />
        </div>
      ) : null}
    </div>
  );
}
