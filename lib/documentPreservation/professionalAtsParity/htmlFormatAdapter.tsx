/*
  TASK 5 - HTML format adapter. Reuses Phase 4's own orchestrator
  (buildProfessionalAtsHtmlPreview) for validation/plan/density, and
  Phase 4's own flat-render component (ProfessionalAtsFlatContent -
  the same component Phase 4's "single scroll" preview mode and its own
  flat measurement pass already use) to obtain real rendered HTML text
  with the same data-section-key/data-section-heading/data-block-id
  markers Phase 4's own htmlValidator.ts relies on - no new rendering
  logic, no re-paginated per-page browser render (page boundaries don't
  matter for content/order parity, and re-rendering per real page would
  cost an extra Playwright pass per fixture on top of what
  buildProfessionalAtsHtmlPreview already does internally).

  react-dom/server is imported lazily inside buildHtmlSnapshot() rather
  than as a top-level static import: Next.js's App Router dev compiler
  walks dynamically-imported chunks reachable from a Route Handler
  (app/api/internal/professional-ats-parity/route.ts imports this file
  via await import()) and refuses to bundle any of them that statically
  import react-dom/server, even indirectly. Only affects this Next.js
  route-serving path - the plain-Node test scripts (negativeControl.
  test.ts, buildProfessionalAtsParity.test.ts, fixtureGate.test.ts) run
  outside Next's compiler entirely and are unaffected either way.
*/
import { buildProfessionalAtsHtmlPreview } from "../professionalAtsHtml/buildProfessionalAtsHtmlPreview";
import { ProfessionalAtsFlatContent } from "../professionalAtsHtml/renderers";
import { DENSITY_SPACING } from "../professionalAtsHtml/designTokens";
import { normalizeForParity } from "./parityNormalization";
import type { ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { PaperSize, ProfessionalAtsHtmlPreviewDocument } from "../professionalAtsHtml/types";
import type { NormalizedFormatSnapshot } from "./types";

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildHtmlSnapshot(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize
): Promise<{ snapshot: NormalizedFormatSnapshot; htmlPreview: ProfessionalAtsHtmlPreviewDocument }> {
  const htmlPreview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);
  const spacing = DENSITY_SPACING[htmlPreview.plan.density];
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(<ProfessionalAtsFlatContent assembly={assembly} spacing={spacing} />);

  const visibleSections: ProfessionalAtsSectionKey[] = [];
  for (const m of html.matchAll(/data-section-key="([^"]+)"/g)) visibleSections.push(m[1] as ProfessionalAtsSectionKey);

  const entryIds: string[] = [];
  for (const m of html.matchAll(/data-block-id="([^"]+)"/g)) entryIds.push(m[1]);

  const sectionLabels: string[] = [];
  for (const m of html.matchAll(/data-section-heading="[^"]+"[^>]*>([^<]+)</g)) sectionLabels.push(m[1]);

  const normalizedText = normalizeForParity(stripHtmlTags(html));

  const snapshot: NormalizedFormatSnapshot = {
    format: "html",
    normalizedText,
    orderedFragments: [],
    visibleSections,
    sectionLabels,
    entryIds,
    paperSize,
    density: htmlPreview.plan.density,
    sourceEntryIds: entryIds,
    sourceBlockIds: entryIds,
    structureWarnings: htmlPreview.validation.warnings,
    pageCount: htmlPreview.plan.pageCount,
  };

  return { snapshot, htmlPreview };
}
