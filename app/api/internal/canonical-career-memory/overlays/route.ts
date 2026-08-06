import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { assertOverlayShapeIsPlainObject, CanonicalOverlayService } from "@/lib/careerMemory/services/canonicalOverlayService";

export function makeHandleListOverlays(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    const service = new CanonicalOverlayService(ctx.repos);
    const overlays = await service.listOverlays(ctx.userId, profileId);
    return jsonResponse({ overlays });
  };
}

export function makeHandleCreateOverlay(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown; resumeVersionId?: unknown; applicationId?: unknown; templateId?: unknown; aiModel?: unknown; promptVersion?: unknown; overlay?: unknown };

    if (typeof body.profileId !== "string") throw new ValidationError(["profileId is required"]);
    assertOverlayShapeIsPlainObject(body.overlay);

    const service = new CanonicalOverlayService(ctx.repos);
    const result = await service.createOverlay(ctx.userId, {
      profileId: body.profileId,
      resumeVersionId: typeof body.resumeVersionId === "string" ? body.resumeVersionId : null,
      applicationId: typeof body.applicationId === "string" ? body.applicationId : null,
      templateId: typeof body.templateId === "string" ? body.templateId : null,
      aiModel: typeof body.aiModel === "string" ? body.aiModel : null,
      promptVersion: typeof body.promptVersion === "string" ? body.promptVersion : null,
      overlay: body.overlay,
    });
    return jsonResponse({ overlay: result.row, appliedEntryIds: result.appliedEntryIds, rejections: result.rejections }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListOverlays(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleCreateOverlay(request));
}
