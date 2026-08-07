import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError, CanonicalProfileUnavailableForTemplateError, CanonicalVersionUnavailableError, TemplateRenderingError } from "@/lib/careerMemory/errors/domainErrors";
import { resolveCanonicalTemplateId } from "@/lib/careerMemory/orchestration/canonicalRenderService";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

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

    const templateId = resolveCanonicalTemplateId(rawTemplateId);

    const memoryService = new CanonicalCareerMemoryService(ctx.repos);
    const runtime = await memoryService.getCanonicalRuntime(ctx.userId);
    if (!runtime) {
      throw new CanonicalProfileUnavailableForTemplateError();
    }
    if (!runtime.version?.id) {
      throw new CanonicalVersionUnavailableError("No canonical resume version exists for this profile.");
    }

    const renderOptions = { templateId, useTailored: false as const, paperSize: rawPaperSize, density: rawDensity, locale, generatedAt: new Date(0).toISOString() };

    try {
      if (rawFormat === "html") {
        const result = await renderTemplateFromRuntime(runtime, renderOptions, "html");
        return jsonResponse({ html: result.html, pageCount: result.pageCount, templateId });
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
