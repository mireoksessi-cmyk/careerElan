import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError, NotFoundError } from "@/lib/careerMemory/errors/domainErrors";
import { requireOwnedProfile } from "@/lib/careerMemory/services/profileAccess";

export function makeHandleGetVersion(request: Request, id: string) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    await requireOwnedProfile(ctx.repos, ctx.userId, profileId);

    const version = await ctx.repos.resumeVersions.getById(id);
    if (!version || version.profile_id !== profileId) throw new NotFoundError("Resume version");
    return jsonResponse({ version });
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return withCanonicalAuth(makeHandleGetVersion(request, id));
}
