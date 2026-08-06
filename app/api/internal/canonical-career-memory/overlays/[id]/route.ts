import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalOverlayService } from "@/lib/careerMemory/services/canonicalOverlayService";

export function makeHandleDeleteOverlay(request: Request, id: string) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);

    const service = new CanonicalOverlayService(ctx.repos);
    await service.deleteOverlay(ctx.userId, profileId, id);
    return jsonResponse({ deleted: true });
  };
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return withCanonicalAuth(makeHandleDeleteOverlay(request, id));
}
