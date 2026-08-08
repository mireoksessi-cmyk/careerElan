import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalTemplatePreferenceService } from "@/lib/careerMemory/services/canonicalTemplatePreferenceService";

/*
  Phase 6I.2 - profile-level canonical template preference. userId only
  ever comes from the authenticated session (withCanonicalAuth), never
  the request body, matching every other route under
  app/api/internal/canonical-career-memory/**. Reachable in every
  runtime (Phase 6I.6.12 removed withCanonicalAuth's blanket Netlify
  404 - see that file's own header comment) - auth is now the only
  generic gate.

  GET: returns { defaultTemplateId: string | null } (null before the
  user has ever chosen one, or if no canonical profile exists yet -
  the two are intentionally indistinguishable to a GET caller, since
  both mean "nothing to render as a default yet"; a caller that needs
  to tell them apart uses the /profile route to check for profile
  existence first).

  PUT { templateId }: sets the preference. Idempotent (same id twice is
  a no-op success), ownership-enforced via ctx.repos (RLS), never
  touches career_resume_versions/career_tailored_resumes/any overlay
  table, never calls OpenAI, never reserves quota - see
  canonicalTemplatePreferenceService.ts's own header comment for why
  that is true by construction, not just by convention.
*/
export async function handleGetTemplatePreference(ctx: CanonicalRouteContext): Promise<NextResponse> {
  const service = new CanonicalTemplatePreferenceService(ctx.repos);
  const result = await service.getTemplatePreference(ctx.userId);
  return jsonResponse({ defaultTemplateId: result?.defaultTemplateId ?? null });
}

export function makeHandlePutTemplatePreference(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { templateId?: unknown };

    if (typeof body.templateId !== "string" || body.templateId.trim().length === 0) {
      throw new ValidationError(["templateId is required and must be a non-empty string"]);
    }

    const service = new CanonicalTemplatePreferenceService(ctx.repos);
    const result = await service.setTemplatePreference(ctx.userId, body.templateId);
    return jsonResponse({ defaultTemplateId: result.defaultTemplateId });
  };
}

export async function GET(): Promise<NextResponse> {
  return withCanonicalAuth(handleGetTemplatePreference);
}

export async function PUT(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandlePutTemplatePreference(request));
}
