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
import { PAPER_DIMENSIONS } from "@/lib/resumeTemplates/shared/paperSizes";

/*
  Phase 6I.3 - deterministic thumbnail scaling (spec section 3/4). The
  previous version scaled an iframe by an arbitrary 357%/0.28 factor
  with no relation to the template's actual page pixel size - this
  computes scale = min(thumbW/pageW, thumbH/pageH) against the SAME
  real page dimensions every template renders at (letter: 816x1056,
  see lib/resumeTemplates/shared/paperSizes.ts - professional-ats's
  own "8.5in"/"11in" CSS units resolve to the identical pixel size at
  the standard 96 CSS px/inch, so this is accurate for all 4
  templates, not just the 3 that already use this module's px values).
  THUMBNAIL_HEIGHT_PX is derived FROM the real aspect ratio, so the
  thumbnail box exactly matches the scaled page with no letterboxing
  and no clipping - a fixed pixel size (not percentage-of-container)
  is what makes the formula usable without a runtime ResizeObserver;
  the grid below wraps to as many fixed-size columns as fit.
*/
const PAGE_WIDTH_PX = PAPER_DIMENSIONS.letter.widthPx;
const PAGE_HEIGHT_PX = PAPER_DIMENSIONS.letter.heightPx;
const THUMBNAIL_WIDTH_PX = 280;
const THUMBNAIL_HEIGHT_PX = Math.round(THUMBNAIL_WIDTH_PX * (PAGE_HEIGHT_PX / PAGE_WIDTH_PX));
const THUMBNAIL_SCALE = Math.min(THUMBNAIL_WIDTH_PX / PAGE_WIDTH_PX, THUMBNAIL_HEIGHT_PX / PAGE_HEIGHT_PX);

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
  /*
    Optional fixed column count override for the outer grid. Omitted
    (undefined) preserves the original repeat(auto-fit, THUMBNAIL_WIDTH_PX)
    behavior byte-for-byte for every existing caller (Career Memory Step 9,
    ApplicationTemplateSwitcher/JobDetail) - only a caller that explicitly
    passes this opts into a fixed N-column grid instead.
  */
  columns?: number;
};

export default function CanonicalTemplatePicker({ templates, selectedTemplateId, onSelect, disabled = false, livePreviewUrl, columns }: CanonicalTemplatePickerProps) {
  return (
    <div role="radiogroup" aria-label="Choose a resume template" className="grid w-full max-w-full justify-center gap-4 overflow-x-auto" style={{ gridTemplateColumns: columns ? `repeat(${columns}, ${THUMBNAIL_WIDTH_PX}px)` : `repeat(auto-fit, ${THUMBNAIL_WIDTH_PX}px)` }}>
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
            style={{ width: THUMBNAIL_WIDTH_PX }}
            className={`flex flex-col overflow-hidden rounded-2xl border-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isSelected ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300"
            }`}
          >
            <div className="relative overflow-hidden bg-white" style={{ width: THUMBNAIL_WIDTH_PX, height: THUMBNAIL_HEIGHT_PX }}>
              {livePreviewUrl ? (
                <iframe
                  src={livePreviewUrl(template.id)}
                  title={`${template.name} live preview`}
                  scrolling="no"
                  className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
                  style={{ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, transform: `scale(${THUMBNAIL_SCALE})`, willChange: "transform" }}
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
