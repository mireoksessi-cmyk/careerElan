import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { ValidationError, CanonicalProfileUnavailableForTemplateError, CanonicalVersionUnavailableError, TemplateRenderingError } from "@/lib/careerMemory/errors/domainErrors";
import { resolveCanonicalTemplateId } from "@/lib/careerMemory/orchestration/canonicalRenderService";
import { resolveCanonicalResumeContext, loadRuntimeForResolvedVersion } from "@/lib/careerMemory/services/resolveCanonicalResumeContext";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import { buildPreviewOnlyResume } from "@/lib/resumeTemplates/preview/previewOnlyCompletion";
import { buildManualCanonicalRuntime } from "@/lib/careerMemory/services/manualResumeRuntimeMapper";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

/*
  Diagnostic-only instrumentation. Production reached browser_launch_success and
  then failed with "browser.newPage: Target crashed", and this file had no
  logging at all, so which stage died was invisible server-side - the message
  only ever reached the client through the route's JSON body. These events add
  no control flow: every original return value, thrown error and code path is
  preserved exactly, including the deliberate placement of newPage OUTSIDE the
  try below, whose failures propagate to the caller rather than degrading to an
  empty result - which is how the crash surfaced at all.
*/
const MAX_ATS_ERROR_CHARS = 8000;
const RE_QUERY = /\?[A-Za-z0-9_%\-.=&+/:]+/g;

/*
  Correlates these stages with the browser_* events already logged from the same
  execution environment. pid and the two Lambda log-name variables are not
  credentials, and no user, document or request value is read.
*/
function atsEnvironmentIdentity(): Record<string, unknown> {
  return {
    pid: process.pid,
    logStream: process.env.AWS_LAMBDA_LOG_STREAM_NAME || null,
    logGroup: process.env.AWS_LAMBDA_LOG_GROUP_NAME || null,
  };
}

/*
  Chromium/Playwright crash text is the point of this log, so sanitisation is
  narrow: only query strings are stripped, in case a signed URL ever appears.
  Nothing here reads process.env.
*/
function boundedAtsErrorMessage(raw: string): string {
  const redacted = raw.replace(RE_QUERY, "?<redacted>");
  return redacted.length > MAX_ATS_ERROR_CHARS
    ? redacted.slice(0, MAX_ATS_ERROR_CHARS) + "…[truncated " + (redacted.length - MAX_ATS_ERROR_CHARS) + " chars]"
    : redacted;
}

/* Metadata only - never HTML, resume text, ids, or user values. */
function logAtsEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ domain: "professionalAtsRender", event, ...detail }));
}

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
    /*
      Account-suspension gate, enforced here because this route is deliberately
      excluded from middleware.ts's matcher (see that file) so its origin Lambda
      is no longer bound by the ~40 s Edge response-header deadline that was
      aborting renders the origin had already completed successfully. Middleware
      still enforces suspension for every other /api/ path; this is the single
      route that must carry its own copy.

      Semantics are deliberately identical to middleware.ts's own block: same
      table, same column, same per-request session/RLS client, the same 403, and
      the same FLAT body - routing this through httpErrorMapping would emit the
      nested { error: { code, message } } shape and silently change the contract
      suspended clients already receive. The query error is likewise not read, so
      a lookup failure leaves the request proceeding exactly as it does in
      middleware today rather than inventing a stricter policy in one route.

      Placed before any parameter parsing, context resolution or rendering, so a
      suspended account can never trigger a runtime download or a Chromium launch.
    */
    const { data: suspensionProfile } = await ctx.client
      .from("profiles")
      .select("suspended_at")
      .eq("id", ctx.userId)
      .maybeSingle();
    if (suspensionProfile?.suspended_at) {
      return NextResponse.json(
        { error: "This account has been suspended.", code: "ACCOUNT_SUSPENDED" },
        { status: 403 }
      );
    }

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

    /*
      Phase 6I.6.17 - explicit Template Demonstration Mode opt-in. Only
      Manual Career Memory Step 9's own two preview call sites
      (career-memory/page.tsx's manualCanonicalVersionId-driven thumbnail
      livePreviewUrl and main iframe src) pass allowPlaceholder=1 - every
      other caller (Dashboard's per-resume pinned preview, which ALSO
      passes canonicalVersionId but for a real, already-selected resume;
      Paste Job's html/pdf/docx; JobDetail; uploaded-resume Career Memory
      preview; the inline-import and template-gate pickers) omits it and
      therefore always gets Real Resume Mode - a section with no real
      data renders as fully absent, never a synthetic placeholder.
      canonicalVersionId alone cannot distinguish these two cases (both
      Step 9 and Dashboard's pinned preview use it, for different
      reasons - see this route's own Phase 6I.6.9/6I.6.14 comments
      above), so this is a separate, purpose-built flag.
    */
    const allowPlaceholder = url.searchParams.get("allowPlaceholder") === "1";
    /*
      Card-thumbnail generic-skeleton mode: unlike allowPlaceholder (fills only EMPTY
      sections of the user's REAL resume - see buildPreviewOnlyResume's
      own header comment), genericSkeleton skips resolving the caller's
      real resume entirely: it reuses the exact same two building
      blocks Manual Career Memory Step 9 itself relies on to show its
      4 template cards generic for a brand-new profile -
      buildManualCanonicalRuntime() (the same function import-manual/
      route.ts calls, here fed an all-empty input instead of the
      user's own typed fields) followed by buildPreviewOnlyResume()
      filling every now-empty section with the same "YOUR NAME"/
      generic-label placeholder text Step 9 shows. No DB read of any
      per-user canonical data happens in this branch, so it can never
      leak real name/email/phone/employer regardless of how complete
      the caller's actual (uploaded) resume is.
    */
    const genericSkeleton = url.searchParams.get("genericSkeleton") === "1";

    let runtime;
    if (genericSkeleton) {
      const emptyRuntime = buildManualCanonicalRuntime({});
      runtime = { ...emptyRuntime, resume: buildPreviewOnlyResume(emptyRuntime.resume) };
    } else {
      const resolved = await resolveCanonicalResumeContext({ mode: "session", repos: ctx.repos, client: ctx.client, userId: ctx.userId, versionId: explicitVersionId });
      if (resolved.status === "not-canonical" || resolved.status === "legacy-only") {
        const memoryService = new CanonicalCareerMemoryService(ctx.repos);
        runtime = await memoryService.getCanonicalRuntime(ctx.userId);
        if (!runtime) throw new CanonicalProfileUnavailableForTemplateError();
        if (!runtime.version?.id) throw new CanonicalVersionUnavailableError("No canonical resume version exists for this profile.");
      } else {
        runtime = resolved.runtime ?? (await loadRuntimeForResolvedVersion(ctx.repos, resolved.versionId));
      }
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

      Phase 6I.6.17 - now gated behind allowPlaceholder (see that flag's
      own comment above). Before this phase this call was unconditional
      for every caller, which meant a REAL resume's Dashboard preview,
      Paste Job preview, and actual PDF/DOCX downloads could silently
      receive synthetic "PROJECTS"/"PROFESSIONAL SUMMARY"/etc. content
      for any section the user's real resume simply doesn't have -
      confirmed via code trace, not hypothetical. Real Resume Mode
      (allowPlaceholder unset, the default) now leaves `runtime`
      untouched in all those cases; a section with no real data renders
      as fully absent instead of gaining fabricated placeholder text.
    */
    if (allowPlaceholder && !genericSkeleton) {
      runtime = { ...runtime, resume: buildPreviewOnlyResume(runtime.resume) };
    }

    const renderOptions = { templateId, useTailored: false as const, paperSize: rawPaperSize, density: rawDensity, locale, generatedAt: new Date(0).toISOString() };

    const renderStartedAt = Date.now();
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
      /*
        Logged BEFORE TemplateRenderingError replaces it. The client response is
        untouched - same error type, same 200-character slice, same status - but
        the original render failure is otherwise recorded nowhere server-side,
        which is why "browser.newPage: Target crashed" was visible on screen and
        absent from every log.
      */
      logAtsEvent("template_render_failure", {
        ...atsEnvironmentIdentity(),
        templateId,
        format: rawFormat,
        variant: rawVariant,
        elapsedMs: Date.now() - renderStartedAt,
        errorName: error instanceof Error ? error.name : "Unknown",
        message: boundedAtsErrorMessage(error instanceof Error ? String(error.message) : String(error)),
      });
      throw new TemplateRenderingError(error instanceof Error ? error.message.slice(0, 200) : "unknown rendering failure");
    }
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleResumePreview(request));
}
