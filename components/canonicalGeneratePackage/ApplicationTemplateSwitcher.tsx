"use client";

/*
  Phase 6I.2 (spec section 11/15) - the post-generation, per-application
  template override surface, deliberately a SEPARATE component from
  CanonicalTemplatePicker's profile-level callers (Dashboard, Career
  Memory) even though it renders the same underlying
  CanonicalTemplatePicker primitive - the two are semantically
  different states (this application's override vs. the profile's
  default) with different persistence endpoints, and collapsing them
  into one stateful component would blur that distinction the spec
  explicitly calls out. Renders nothing (null) when this application
  has no resolvable canonical template - a legacy-engine application,
  or a canonical one still blocked on profile-level selection - so
  mounting it unconditionally in a resume tab is always safe.

  Card thumbnails intentionally use the registry's static previewAsset
  rather than a live per-user render: a live render here would need
  this APPLICATION's actual tailored content (via the existing
  applicationId+overlay-based /canonical-generate-package/preview
  route), not the untailored profile content the new GET .../resume-
  preview endpoint renders - using the wrong one would show a
  misleadingly different resume than what actually gets downloaded.
*/
import { useEffect, useState } from "react";
import CanonicalTemplatePicker from "./CanonicalTemplatePicker";
import type { TemplateId, TemplateCapabilities } from "@/lib/resumeTemplates/contracts/types";

export type ApplicationTemplateSwitcherProps = {
  applicationId: string;
  /*
    Phase 6I.3 (spec section 6) - optional callback fired right after a
    successful switch (before OR after "Set as my default" - both are
    a real template change for this application), so a caller showing
    this application's own resume preview elsewhere on the page (e.g.
    JobDetail) can refetch and reflect the change immediately, instead
    of the preview staying stale until the next full remount.
  */
  onTemplateChanged?: () => void;
};

export default function ApplicationTemplateSwitcher({ applicationId, onTemplateChanged }: ApplicationTemplateSwitcherProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "not-applicable">("loading");
  const [templates, setTemplates] = useState<TemplateCapabilities[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId | null>(null);
  const [savedAsDefault, setSavedAsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resolveRes = await fetch(`/api/internal/canonical-career-memory/resolve-template?applicationId=${applicationId}`);
        const resolution = resolveRes.ok ? await resolveRes.json() : null;
        if (cancelled) return;
        if (resolution?.kind !== "canonical") {
          setStatus("not-applicable");
          return;
        }
        const templatesRes = await fetch("/api/internal/canonical-career-memory/templates");
        const templatesData = templatesRes.ok ? await templatesRes.json() : { templates: [] };
        if (cancelled) return;
        setSelectedTemplateId(resolution.templateId);
        setTemplates(templatesData.templates ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("not-applicable");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  async function switchTemplate(templateId: TemplateId, setAsDefault: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/canonical-generate-package/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, templateId, setAsDefault }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Could not switch the template for this application.");
        return;
      }
      setSelectedTemplateId(data.selectedTemplateId);
      setSavedAsDefault(setAsDefault);
      onTemplateChanged?.();
    } catch {
      setError("Could not switch the template for this application.");
    } finally {
      setSaving(false);
    }
  }

  if (status !== "ready") return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-black uppercase tracking-wide text-blue-600">Switch Template</p>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        Changing the template here only affects this application - no AI call, no quota used. Your Dashboard default stays the same unless you set this as your default below.
      </p>
      {error && <p className="mb-3 text-xs font-semibold text-red-600">{error}</p>}
      <CanonicalTemplatePicker templates={templates} selectedTemplateId={selectedTemplateId} onSelect={(templateId) => switchTemplate(templateId, false)} disabled={saving} />
      {selectedTemplateId && (
        <button
          type="button"
          onClick={() => switchTemplate(selectedTemplateId, true)}
          disabled={saving || savedAsDefault}
          className="mt-4 rounded-xl border border-blue-600 px-4 py-2 text-xs font-bold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savedAsDefault ? "Set as my default ✓" : "Set as my default"}
        </button>
      )}
    </div>
  );
}
