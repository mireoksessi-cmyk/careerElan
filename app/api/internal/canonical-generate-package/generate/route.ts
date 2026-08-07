import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { isCanonicalGenerateEnabled } from "@/lib/careerMemory/orchestration/featureFlags";
import { generateCanonicalPackage } from "@/lib/careerMemory/orchestration/canonicalGeneratePackageService";
import { requireTemplateSelected } from "@/lib/careerMemory/services/canonicalTemplateGate";
import { logCanonicalMetric, classifyErrorCode } from "@/lib/careerMemory/orchestration/canonicalProductionMetrics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

/*
  Phase 6G - the real canary entry point for a full canonical
  generation (AI tailoring + 4-template render + real document
  storage). Gated by canonical_generate_enabled (default false, see
  featureFlags.ts) - this route returns 404 even when reachable
  (withCanonicalAuth already 404s in real Netlify Production runtime;
  this is the SECOND, independent gate for local/dev/canary
  environments where isNetlifyRuntime() is false).

  userId is taken ONLY from ctx.userId (the authenticated session, via
  withCanonicalAuth -> getAuthenticatedUserId) - the request body's
  applicationId is the only per-request identifier accepted, and
  generateCanonicalPackage()/its downstream RPCs re-verify ownership of
  that applicationId against ctx.userId server-side (never trusting
  this route's own resolution alone) - see
  system_create_canonical_overlay's and complete_canonical_generation's
  own ownership checks in the migration.

  Uses supabaseAdmin (service-role), matching the EXACT same
  established pattern the existing legacy app/api/generate-package/route.ts
  already uses for its own service-role RPCs
  (reserve_generate_package_usage, claim_generate_package_worker, etc.)
  - service-role + an explicit, session-derived p_user_id + an RPC-level
  ownership check is this codebase's precedent for "service-role called
  from an ordinary user request," not a bypass of it.
*/
function isValidPaperSize(value: unknown): value is PaperSize {
  return value === "letter" || value === "a4";
}
function isValidDensity(value: unknown): value is TemplateDensity {
  return value === "compact" || value === "comfortable" || value === "spacious" || value === "balanced";
}

export function makeHandleGenerate(request: Request) {
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
    /*
      Phase 6I.2 - templateId is now OPTIONAL. Omitted -> inherit
      career_profiles.default_template_id (spec section 10: "Generate
      Package must inherit the selected template automatically").
      Present -> an explicit per-application override (spec section
      11); still flows through the SAME resolveCanonicalTemplateId()
      validation inside renderCanonicalPackage as before - no new
      validation path. requireTemplateSelected() enforces the hard
      gate (section 13): a canonical profile with no default template
      yet blocks generation with TEMPLATE_SELECTION_REQUIRED rather
      than silently falling through to an arbitrary template. A
      request with no canonical profile at all falls through to
      generateCanonicalPackage()'s own existing
      CanonicalProfileUnavailableError - unchanged, not duplicated
      here.
    */
    if (body.templateId !== undefined && (typeof body.templateId !== "string" || body.templateId.length === 0)) {
      throw new ValidationError(["templateId, if present, must be a non-empty string"]);
    }
    let templateId: string;
    if (typeof body.templateId === "string") {
      templateId = body.templateId;
    } else {
      const gate = await requireTemplateSelected(ctx.repos, ctx.userId);
      templateId = gate?.defaultTemplateId ?? "";
    }
    if (typeof body.jobDescriptionText !== "string" || body.jobDescriptionText.trim().length === 0) {
      throw new ValidationError(["jobDescriptionText is required and must be a non-empty string"]);
    }
    /*
      Omission defaults (letter/comfortable) - a PRESENT but unsupported
      value is rejected outright with a 422, never silently coerced to a
      default. Round spec §9: "unsupported options must produce an
      explicit validation error or fallback, never be silently ignored."
    */
    if (body.paperSize !== undefined && !isValidPaperSize(body.paperSize)) {
      throw new ValidationError([`paperSize "${String(body.paperSize)}" is not supported (expected "letter" or "a4")`]);
    }
    if (body.density !== undefined && !isValidDensity(body.density)) {
      throw new ValidationError([`density "${String(body.density)}" is not supported (expected "compact", "comfortable", or "spacious")`]);
    }
    const paperSize: PaperSize = isValidPaperSize(body.paperSize) ? body.paperSize : "letter";
    const density: TemplateDensity = isValidDensity(body.density) ? body.density : "comfortable";
    const locale = typeof body.locale === "string" && body.locale.length > 0 ? body.locale : "en";
    const jobAnalysisSummary = typeof body.jobAnalysisSummary === "string" ? body.jobAnalysisSummary : "";
    const targetRole = typeof body.targetRole === "string" ? body.targetRole : undefined;

    const startedAt = Date.now();
    let result;
    try {
      result = await generateCanonicalPackage(supabaseAdmin, {
        userId: ctx.userId,
        applicationId: body.applicationId,
        jobDescriptionText: body.jobDescriptionText,
        jobAnalysisSummary,
        targetRole,
        templateId,
        paperSize,
        density,
        locale,
      });
    } catch (error) {
      logCanonicalMetric({ event: "canonical_generate", applicationId: body.applicationId, templateId, outcome: "error", errorCode: classifyErrorCode(error), latencyMs: Date.now() - startedAt });
      throw error;
    }
    logCanonicalMetric({
      event: "canonical_generate",
      applicationId: body.applicationId,
      templateId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      pdfPersisted: result.render.documentStorage.persisted,
      docxPersisted: result.render.documentStorage.persisted,
    });

    return jsonResponse({
      canonicalProfileId: result.canonicalProfileId,
      canonicalResumeVersionId: result.canonicalResumeVersionId,
      tailoredResumeId: result.tailoredResumeId,
      appliedEntryIds: result.appliedEntryIds,
      overlayRejections: result.overlayRejections,
      pageCount: result.render.pageCount,
      documentStorage: result.render.documentStorage,
      pdfProtectedFactsUnchanged: result.render.pdfValidation.protectedFactsUnchanged,
      docxProtectedFactsUnchanged: result.render.docxValidation.protectedFactsUnchanged,
    });
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleGenerate(request));
}
