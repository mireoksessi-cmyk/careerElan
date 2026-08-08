import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { ValidationError, CanonicalProfileUnavailableForTemplateError, CanonicalVersionUnavailableError, TemplateRenderingError } from "@/lib/careerMemory/errors/domainErrors";
import { resolveCanonicalTemplateId } from "@/lib/careerMemory/orchestration/canonicalRenderService";
import { resolveCanonicalResumeContext, loadRuntimeForResolvedVersion } from "@/lib/careerMemory/services/resolveCanonicalResumeContext";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import { buildPreviewOnlyResume } from "@/lib/resumeTemplates/preview/previewOnlyCompletion";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

/*
  Phase 6I.3 - all 4 templates render a full standalone HTML document
  whose <body> is a flat sequence of sibling page-wrapper elements, one
  per physical page (confirmed for all 4: professional-ats's own
  buildPaginatedPageHtml produces `<body>{page divs}</body>`; the other
  3 share renderHtmlDocument, whose bodyHtml is the same flat sibling
  structure - see paginatedHtmlString.ts / documentShell.tsx). Taking
  "body's first element child" is therefore a genuinely template-
  agnostic way to isolate page 1 for a thumbnail - no per-template
  class-name special-casing (`.ats-page` vs `.page`) needed.

  Also injects an explicit light color-scheme + white background at
  the very start of <head><style> - none of the 4 templates set
  `color-scheme` themselves, and 2 of the 4 (modern-sidebar, executive-
  minimal - see their own pageStyles()) never set a body background at
  all, leaving them exposed to a browser/OS "force dark" override that
  ignores un-styled elements. This never touches any template's own
  content or design; it only forecloses an unstyled default from being
  overridden by a viewer-side dark mode.
*/
export function extractFirstPageDocument(fullHtml: string): string {
  const $ = cheerio.load(fullHtml);
  const firstPage = $("body").children().first();
  const pageHtml = firstPage.length > 0 ? ($.html(firstPage) ?? "") : ($("body").html() ?? "");
  const existingStyle = $("head style").first().html() ?? "";
  const title = $("head title").first().text() || "Resume preview";
  const lang = $("html").attr("lang") || "en";
  const guardStyle = "html,body{margin:0;background:#ffffff;color-scheme:light;}";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8" /><meta name="color-scheme" content="light" /><title>${title}</title><style>${guardStyle}${existingStyle}</style></head><body>${pageHtml}</body></html>`;
}

/*
  Phase 6I.2 - the untailored, PRE-generation counterpart to
  canonical-generate-package/preview/route.ts. That route requires an
  existing applicationId + a tailored overlay from a prior /generate
  call - there is no such thing yet when the user is choosing a
  default template in Career Memory/Dashboard, or viewing the initial
  Paste Job resume preview before Generate Package has ever run (spec
  sections 6/7/9). This route renders the user's CURRENT canonical
  resume (useTailored: false - no overlay, no AI, no application) under
  any of the 4 templates, so "real preview cards" and pre-generation
  previews can show the user's actual content instead of the synthetic
  Jordan Ellis fixture or nothing at all.

  Read-only and side-effect-free: no Storage upload, no
  generated_resume_documents row, no RPC - renderTemplateFromRuntime is
  called directly, mirroring how /preview itself bypasses
  canonicalRenderService's own upload+RPC steps for the same reason
  (see that route's own header comment).

  Phase 6I.6 - resolves the resume via resolveCanonicalResumeContext()
  instead of always calling getCanonicalRuntime(userId) (= profile's
  globally-latest version regardless of what career_memory.selected_
  resume_id says - the exact gap this round's audit confirmed here).
  "not-canonical" (selection is the career_memory-authored resume,
  which can never have a canonical version) and "legacy-only" (no
  selection ever made, or no canonical profile at all) both fall back
  to the same "profile's latest version" this route used
  unconditionally before this round - a disclosed limitation, not a
  regression: with no canonical-eligible identity to honor, latest is
  the best available proxy, and changing that would require broader
  callers (Career Memory/Paste Job/Dashboard) to handle a distinct
  "no canonical preview available" UI state, out of scope for this
  route-level fix. A genuinely selected-but-unresolvable resume
  (SELECTED_RESUME_UNAVAILABLE) is never silently substituted - it
  propagates as a thrown 409, same as every other domain error here.
*/
function isValidPaperSize(value: unknown): value is PaperSize {
  return value === "letter" || value === "a4";
}
function isValidDensity(value: unknown): value is TemplateDensity {
  return value === "compact" || value === "comfortable" || value === "spacious" || value === "balanced";
}

export function makeHandleResumePreview(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const url = new URL(request.url);
    const rawTemplateId = url.searchParams.get("templateId");
    if (!rawTemplateId) {
      throw new ValidationError(["templateId is required"]);
    }
    const rawFormat = url.searchParams.get("format") ?? "html";
    if (rawFormat !== "html" && rawFormat !== "pdf" && rawFormat !== "docx") {
      throw new ValidationError([`format "${rawFormat}" is not supported (expected "html", "pdf", or "docx")`]);
    }
    const rawPaperSize = url.searchParams.get("paperSize") ?? "letter";
    if (!isValidPaperSize(rawPaperSize)) {
      throw new ValidationError([`paperSize "${rawPaperSize}" is not supported (expected "letter" or "a4")`]);
    }
    const rawDensity = url.searchParams.get("density") ?? "comfortable";
    if (!isValidDensity(rawDensity)) {
      throw new ValidationError([`density "${rawDensity}" is not supported (expected "compact", "comfortable", or "spacious")`]);
    }
    const locale = url.searchParams.get("locale") ?? "en";
    /*
      Phase 6I.3 - thumbnail variant: page-1-only, for the 4-template
      picker's small preview cards (spec section 3/4). Full multi-page
      HTML (variant unset/"full") stays the default, used by the
      Career Memory full-size preview (spec section 5).
    */
    const rawVariant = url.searchParams.get("variant") ?? "full";
    if (rawVariant !== "full" && rawVariant !== "thumbnail") {
      throw new ValidationError([`variant "${rawVariant}" is not supported (expected "full" or "thumbnail")`]);
    }

    const templateId = resolveCanonicalTemplateId(rawTemplateId);

    /*
      Phase 6I.6.9 - explicit versionId override (Branch A2 of
      resolveCanonicalResumeContext - see that file's own header comment
      on SessionModeInput.versionId). Manual Career Memory Step 9 passes
      its OWN canonical version id (from its own import-manual response)
      here so this route can never fall through to career_memory.
      selected_resume_type/selected_resume_id - a completely unrelated,
      Dashboard-only selection that must never leak into a Manual
      resume's own preview. Omitted entirely by every other existing
      caller (Dashboard/Paste Job/JobDetail/uploaded-resume Career
      Memory), whose behavior is therefore byte-for-byte unchanged.
    */
    const explicitVersionId = url.searchParams.get("canonicalVersionId") ?? undefined;

    const resolved = await resolveCanonicalResumeContext({ mode: "session", repos: ctx.repos, client: ctx.client, userId: ctx.userId, versionId: explicitVersionId });
    let runtime;
    if (resolved.status === "not-canonical" || resolved.status === "legacy-only") {
      const memoryService = new CanonicalCareerMemoryService(ctx.repos);
      runtime = await memoryService.getCanonicalRuntime(ctx.userId);
      if (!runtime) throw new CanonicalProfileUnavailableForTemplateError();
      if (!runtime.version?.id) throw new CanonicalVersionUnavailableError("No canonical resume version exists for this profile.");
    } else {
      runtime = resolved.runtime ?? (await loadRuntimeForResolvedVersion(ctx.repos, resolved.versionId));
    }

    /*
      Phase 6I.6.9 - PREVIEW-ONLY structural completion (see
      previewOnlyCompletion.ts's own header comment). Returns `runtime`
      unchanged whenever the resolved resume already renders
      successfully as-is - a genuinely complete resume is never touched.
      This is what lets Step 9 show all 4 templates for a brand-new,
      zero-data Manual resume instead of throwing "missing-identity"
      through renderTemplateFromRuntime -> TemplateRenderingError ->
      PERSISTENCE_ERROR (this route's own pre-existing, unrelated
      persistence-error-code reuse - see PersistenceError's own header
      comment in domainErrors.ts) into the iframe as raw JSON.
    */
    runtime = { ...runtime, resume: buildPreviewOnlyResume(runtime.resume) };

    const renderOptions = { templateId, useTailored: false as const, paperSize: rawPaperSize, density: rawDensity, locale, generatedAt: new Date(0).toISOString() };

    try {
      if (rawFormat === "html") {
        /*
          Phase 6I.3 - raw text/html, NOT jsonResponse(). Every current
          caller of format=html embeds this URL directly as
          <iframe src="...">, which requires the HTTP response to BE an
          HTML document. Returning JSON here (the pre-6I.3 shape) made
          the browser render its own JSON viewer inside the iframe
          instead of the resume - the exact, proven root cause of the
          broken 4-template picker thumbnails (see this route's own
          git history / the Phase 6I.3 report for the full diagnosis).
          No current caller consumes format=html via fetch().json() -
          confirmed by grep across the repo before making this change.
        */
        const result = await renderTemplateFromRuntime(runtime, renderOptions, "html");
        const html = rawVariant === "thumbnail" ? extractFirstPageDocument(result.html) : result.html;
        return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      const result = rawFormat === "pdf" ? await renderTemplateFromRuntime(runtime, renderOptions, "pdf") : await renderTemplateFromRuntime(runtime, renderOptions, "docx");
      const contentType = rawFormat === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers: { "content-type": contentType, "cache-control": "no-store" } });
    } catch (error) {
      throw new TemplateRenderingError(error instanceof Error ? error.message.slice(0, 200) : "unknown rendering failure");
    }
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleResumePreview(request));
}
