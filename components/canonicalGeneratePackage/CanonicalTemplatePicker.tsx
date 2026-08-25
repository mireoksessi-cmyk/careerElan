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
import { useEffect, useState } from "react";

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
  The box height and the iframe scale are both derived FROM the real
  aspect ratio, so the thumbnail exactly matches the scaled page with no
  letterboxing and no clipping.

  That width is carried in a --tpl-w CSS variable rather than a single
  baked-in constant. A fixed 280px card forced exactly one column on
  every phone - the four templates stacked into a ~1732px column, so a
  mobile user saw one template and had no reason to think there were
  more. The variable steps down at narrow widths (two columns fit from
  320px up) and returns to the original 280px at sm, where the 576px
  wrapper has always shown two columns. Because the box height and the
  iframe scale are calc()-ed from the same variable, the aspect ratio
  and the page-to-thumbnail mapping stay exact at every step - still no
  runtime ResizeObserver, and no transform hack on the card itself.
*/
const PAGE_WIDTH_PX = PAPER_DIMENSIONS.letter.widthPx;
const PAGE_HEIGHT_PX = PAPER_DIMENSIONS.letter.heightPx;

/*
  How many live thumbnail previews may be IN FLIGHT at once, per picker
  instance. Each live preview is a full canonical render behind the
  resume-preview route, so mounting all four at once asked the platform for
  four simultaneous renders - and in the Step 9 layout, where a large preview
  mounts alongside, five. Now that every card paints its static previewAsset
  immediately (see the img below), a card that has not started yet is visually
  indistinguishable from one still loading, so there is no longer any reason
  to start them all at once.

  Deliberately per-instance, not global: Dashboard renders one picker per
  resume, so three open pickers can still have up to six in flight. Bounding
  that globally would need cross-instance coordination this presentational
  component has no business owning.
*/
const THUMBNAIL_CONCURRENCY = 2;

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
    (undefined) preserves the original repeat(auto-fit, --tpl-w)
    behavior byte-for-byte for every existing caller (Career Memory Step 9,
    ApplicationTemplateSwitcher/JobDetail) - only a caller that explicitly
    passes this opts into a fixed N-column grid instead.
  */
  columns?: number;
};

export default function CanonicalTemplatePicker({ templates, selectedTemplateId, onSelect, disabled = false, livePreviewUrl, columns }: CanonicalTemplatePickerProps) {
  /*
    Live-preview loading placeholder. The live iframe below takes tens of
    seconds on a cold render (the canonical render path launches a real
    browser), and until its first paint an iframe is simply an empty
    document - so the card showed nothing but its own bg-white box for the
    whole wait. Each template's registry previewAsset (the same four static
    SVGs the incomplete-sections Step 9 branch already renders through the
    livePreviewUrl-absent path below) now sits underneath as the immediate
    visual, and the iframe fades in over it only once it has actually
    loaded.

    Keyed by the resolved src STRING, not by template id, deliberately:
    several callers rebuild livePreviewUrl with a canonicalVersionId that
    only becomes available after mount (see the manual Step 9 caller), which
    re-navigates an already-loaded iframe back to a blank document. Keying
    on id would leave a stale "loaded" mark and reveal that blank iframe;
    keying on src means a changed src is simply an unknown src, which falls
    back to the placeholder until the new document loads. That is the whole
    reset mechanism - no effect, no dependency array, nothing to keep in
    sync.
  */
  const [previewStatusBySrc, setPreviewStatusBySrc] = useState<Record<string, "loaded" | "failed">>({});
  function markPreview(src: string, status: "loaded" | "failed") {
    setPreviewStatusBySrc((current) => (current[src] === status ? current : { ...current, [src]: status }));
  }

  /*
    Which templates have been allowed to mount a live iframe. A template not
    in this list renders its static previewAsset and NO iframe element at all -
    not an empty src, not about:blank - which is what makes the request count
    exact rather than merely deferred.

    Scheduling priority is the templates prop's own order (the registry order
    the catalog route returns), except that the currently selected template
    moves to the front - on Dashboard that is the card the user is actually
    judging. This reorders only WHICH card starts first; the rendered grid
    below still maps over `templates` untouched, so the visible order never
    moves.
  */
  const [startedTemplateIds, setStartedTemplateIds] = useState<TemplateId[]>([]);
  const templateIds = templates.map((template) => template.id);
  const selectedIndex = selectedTemplateId ? templateIds.indexOf(selectedTemplateId) : -1;
  const schedulingPriority = selectedIndex > 0
    ? [templateIds[selectedIndex], ...templateIds.filter((_, index) => index !== selectedIndex)]
    : templateIds;
  /*
    One key covering both inputs the top-up depends on: the priority order and
    each template's currently resolved src. Recomputing on a src change is what
    lets a re-navigated (new canonicalVersionId) preview be counted as in
    flight again instead of staying credited as finished.
  */
  const scheduleKey = livePreviewUrl ? schedulingPriority.map((id) => livePreviewUrl(id)).join("|") : "";

  useEffect(() => {
    if (!livePreviewUrl) return;
    /*
      Top up to THUMBNAIL_CONCURRENCY in flight. Written as a fixpoint rather
      than "start one more on every onLoad" so it is idempotent: it derives the
      whole set from what is actually still loading, so a duplicate load event
      or a re-navigation cannot drift the slot count. Returns the SAME array
      reference when nothing changes, so it cannot loop.
    */
    setStartedTemplateIds((current) => {
      const retained = current.filter((id) => schedulingPriority.includes(id));
      let inFlight = retained.filter((id) => !previewStatusBySrc[livePreviewUrl(id)]).length;
      const next = [...retained];
      for (const id of schedulingPriority) {
        if (inFlight >= THUMBNAIL_CONCURRENCY) break;
        if (next.includes(id)) continue;
        next.push(id);
        inFlight += 1;
      }
      const unchanged = next.length === current.length && next.every((id, index) => id === current[index]);
      return unchanged ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, previewStatusBySrc]);

  return (
    <div role="radiogroup" aria-label="Choose a resume template" className="grid w-full max-w-full justify-center gap-4 overflow-x-auto [--tpl-w:132px] min-[400px]:[--tpl-w:160px] sm:[--tpl-w:280px]" style={{ gridTemplateColumns: columns ? `repeat(${columns}, var(--tpl-w))` : "repeat(auto-fit, var(--tpl-w))" }}>
      {templates.map((template) => {
        const isSelected = selectedTemplateId === template.id;
        const previewSrc = livePreviewUrl && startedTemplateIds.includes(template.id) ? livePreviewUrl(template.id) : null;
        const previewStatus = previewSrc ? previewStatusBySrc[previewSrc] : undefined;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onSelect(template.id)}
            style={{ width: "var(--tpl-w)" }}
            className={`flex flex-col overflow-hidden rounded-2xl border-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isSelected ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300"
            }`}
          >
            <div className="relative overflow-hidden bg-white" style={{ width: "var(--tpl-w)", height: `calc(var(--tpl-w) * ${PAGE_HEIGHT_PX} / ${PAGE_WIDTH_PX})` }}>
              {/*
                Layer 1 - always rendered, identical asset and identical
                loading attribute in both modes. With no live preview it is
                the card (unchanged behavior); with one it is the underlay.
                absolute + h-full/w-full resolves to the same rect as the
                previous static-flow img inside this fixed-size box.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={template.previewAsset} alt={`${template.name} template preview`} className="absolute left-0 top-0 h-full w-full object-contain" loading="lazy" />
              {/*
                Layer 2 - the live preview, mounted with its src on the very
                first render exactly as before, so request count, timing and
                concurrency are untouched. Only its opacity is new: it stays
                transparent (the placeholder shows through) until onLoad, and
                stays transparent forever on onError, so a failed preview
                degrades to the static card rather than a blank rectangle.
              */}
              {previewSrc ? (
                <iframe
                  src={previewSrc}
                  title={`${template.name} live preview`}
                  scrolling="no"
                  onLoad={() => markPreview(previewSrc, "loaded")}
                  onError={() => markPreview(previewSrc, "failed")}
                  className={`pointer-events-none absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-300 ${previewStatus === "loaded" ? "opacity-100" : "opacity-0"}`}
                  style={{ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, transform: `scale(calc(var(--tpl-w) / ${PAGE_WIDTH_PX}))`, willChange: "transform" }}
                />
              ) : null}
              {previewStatus === "failed" && (
                <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Preview unavailable</span>
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
