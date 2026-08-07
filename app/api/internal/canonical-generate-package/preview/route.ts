import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError, CanonicalVersionUnavailableError } from "@/lib/careerMemory/errors/domainErrors";
import { isCanonicalGenerateEnabled } from "@/lib/careerMemory/orchestration/featureFlags";
import { resolveCanonicalTemplateId } from "@/lib/careerMemory/orchestration/canonicalRenderService";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { applyOverlay } from "@/lib/careerMemory/runtime/overlayRuntime";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

/*
  Phase 6G - template-switch preview. Reuses the EXACT SAME resume
  version and tailored overlay that were already produced by a prior
  /generate call for this applicationId - never calls OpenAI, never
  creates a new career_tailored_resumes row, never touches Storage or
  the document-persistence RPC (renderTemplateFromRuntime is called
  directly, bypassing canonicalRenderService's own upload+RPC steps -
  see that file's own header comment for why persistence is a separate
  concern from rendering). This is the mechanism that satisfies round
  spec's own "template switch가 AI 호출/quota 소비 0이어야 한다."

  Known, disclosed limitation: this reconstructs the runtime via
  getCanonicalRuntime(userId), which always resolves the profile's
  CURRENT latest resume version, then verifies it still matches the
  version id recorded on the existing tailored-resume row before
  rendering - if the user's canonical resume has been updated since the
  original /generate call (a new latest version now exists), this
  returns 409 rather than silently rendering against a stale or
  mismatched version. A full historical-version reconstruction path is
  not implemented this round.
*/
function isValidPaperSize(value: unknown): value is PaperSize {
  return value === "letter" || value === "a4";
}
function isValidDensity(value: unknown): value is TemplateDensity {
  return value === "compact" || value === "comfortable" || value === "spacious";
}

export function makeHandlePreview(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    if (!isCanonicalGenerateEnabled()) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as Record<string, unknown>;

    if (typeof body.applicationId !== "string" || body.applicationId.length === 0) {
      throw new ValidationError(["applicationId is required and must be a non-empty string"]);
    }
    if (typeof body.templateId !== "string" || body.templateId.length === 0) {
      throw new ValidationError(["templateId is required and must be a non-empty string"]);
    }
    /*
      Omission defaults, but a PRESENT unsupported value is rejected
      outright - never silently coerced. Round spec §9: "unsupported
      options must produce an explicit validation error or fallback,
      never be silently ignored."
    */
    if (body.format !== undefined && body.format !== "html" && body.format !== "pdf" && body.format !== "docx") {
      throw new ValidationError([`format "${String(body.format)}" is not supported (expected "html", "pdf", or "docx")`]);
    }
    if (body.paperSize !== undefined && !isValidPaperSize(body.paperSize)) {
      throw new ValidationError([`paperSize "${String(body.paperSize)}" is not supported (expected "letter" or "a4")`]);
    }
    if (body.density !== undefined && !isValidDensity(body.density)) {
      throw new ValidationError([`density "${String(body.density)}" is not supported (expected "compact", "comfortable", or "spacious")`]);
    }
    const format = body.format === "pdf" || body.format === "docx" ? body.format : "html";
    const paperSize: PaperSize = isValidPaperSize(body.paperSize) ? body.paperSize : "letter";
    const density: TemplateDensity = isValidDensity(body.density) ? body.density : "comfortable";
    const locale = typeof body.locale === "string" && body.locale.length > 0 ? body.locale : "en";

    const templateId = resolveCanonicalTemplateId(body.templateId);

    // Ownership-scoped by RLS: ctx.repos is built from the authenticated
    // session client (see routeGuard.ts), so a tailored resume belonging
    // to another user's profile simply is not returned
    // (career_tailored_resumes_select policy joins on
    // career_profiles.user_id = auth.uid()) - no manual ownership check
    // needed, unlike a service-role-backed route would require.
    const tailoredRow = await ctx.repos.tailoredResumes.getByApplicationId(body.applicationId);
    if (!tailoredRow) {
      throw new CanonicalVersionUnavailableError("No prior canonical generation found for this applicationId - call /generate first.");
    }

    const memoryService = new CanonicalCareerMemoryService(ctx.repos);
    const runtime = await memoryService.getCanonicalRuntime(ctx.userId);
    if (!runtime || !runtime.version?.id) {
      throw new CanonicalVersionUnavailableError("No canonical resume version exists for this profile.");
    }
    if (tailoredRow.resume_version_id && runtime.version.id !== tailoredRow.resume_version_id) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "The canonical resume has changed since this application was generated. Re-generate before previewing a different template." } },
        { status: 409, headers: { "cache-control": "no-store" } }
      );
    }

    const applied = applyOverlay(runtime, tailoredRow.overlay);

    if (format === "html") {
      const result = await renderTemplateFromRuntime(applied.runtime, { templateId, useTailored: true, paperSize, density, locale, generatedAt: new Date(0).toISOString() }, "html");
      return jsonResponse({ html: result.html, pageCount: result.pageCount, templateId });
    }

    const renderOptions = { templateId, useTailored: true, paperSize, density, locale, generatedAt: new Date(0).toISOString() };
    const result = format === "pdf" ? await renderTemplateFromRuntime(applied.runtime, renderOptions, "pdf") : await renderTemplateFromRuntime(applied.runtime, renderOptions, "docx");
    const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers: { "content-type": contentType, "cache-control": "no-store" } });
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandlePreview(request));
}
