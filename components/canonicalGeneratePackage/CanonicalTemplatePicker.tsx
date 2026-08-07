"use client";

/*
  Phase 6I.2 - the reusable "choose one of the 4 canonical templates"
  component (spec section 6/15). Deliberately presentational only - no
  fetch() calls, no API knowledge, no assumption about WHICH lifecycle
  stage it's being used in (profile-level default selection vs a future
  application-level override surface). Every caller supplies the
  registry metadata (from GET /api/internal/canonical-career-memory/
  templates, the SAME data source the dev-only Template Gallery already
  uses - see app/api/internal/canonical-career-memory/templates/route.ts)
  and owns its own persistence call (PUT .../template-preference for
  the profile-level picker, a future application-level endpoint for a
  post-generation override). This is what keeps template IDs/metadata
  defined in exactly one place (the registry) instead of a fourth
  hardcoded template list.

  Keyboard accessible: each card is a real <button>, so Tab/Enter/Space
  all work without any extra handling.
*/
import type { TemplateCapabilities, TemplateId } from "@/lib/resumeTemplates/contracts/types";

export type CanonicalTemplatePickerProps = {
  templates: TemplateCapabilities[];
  selectedTemplateId: TemplateId | null;
  onSelect: (templateId: TemplateId) => void;
  disabled?: boolean;
  /*
    Phase 6I.2 - optional live-preview URL builder. When provided, each
    card renders a real, scaled-down iframe of the CALLER's own
    canonical resume (typically GET .../canonical-career-memory/
    resume-preview?templateId=...&format=html) instead of the
    registry's static previewAsset thumbnail - this is what makes the
    cards "real preview cards" of the user's actual content (spec
    section 6) rather than a generic style sample. The component still
    makes no fetch() calls itself; it only renders a src the caller
    supplies. Callers without canonical resume data yet (or that don't
    want the extra request) simply omit this and keep the static asset.
  */
  livePreviewUrl?: (templateId: TemplateId) => string;
};

export default function CanonicalTemplatePicker({ templates, selectedTemplateId, onSelect, disabled = false, livePreviewUrl }: CanonicalTemplatePickerProps) {
  return (
    <div role="radiogroup" aria-label="Choose a resume template" className="grid gap-4 sm:grid-cols-2">
      {templates.map((template) => {
        const isSelected = selectedTemplateId === template.id;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onSelect(template.id)}
            className={`flex flex-col overflow-hidden rounded-2xl border-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isSelected ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300"
            }`}
          >
            <div className="relative aspect-[3/4] overflow-hidden bg-slate-50">
              {livePreviewUrl ? (
                <iframe
                  src={livePreviewUrl(template.id)}
                  title={`${template.name} live preview`}
                  loading="lazy"
                  className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
                  style={{ width: "357%", height: "357%", transform: "scale(0.28)" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={template.previewAsset} alt={`${template.name} template preview`} className="h-full w-full object-contain" loading="lazy" />
              )}
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-900">{template.name}</p>
                {isSelected && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">Selected</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{template.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
