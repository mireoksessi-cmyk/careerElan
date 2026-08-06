import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalResumeVersionService } from "@/lib/careerMemory/services/canonicalResumeVersionService";

/*
  Only writes career_resume_versions (single table, no atomicity gap) -
  does NOT replace the six child tables to match the restored snapshot;
  see CanonicalResumeVersionService.restoreVersion()'s own comment.
*/
export function makeHandleRestoreVersion(request: Request, id: string) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown };
    if (typeof body.profileId !== "string" || body.profileId.length === 0) throw new ValidationError(["profileId is required"]);

    const service = new CanonicalResumeVersionService(ctx.repos);
    const result = await service.restoreVersion(ctx.userId, body.profileId, id);
    return jsonResponse({ version: result.newVersion, restoredFromVersionId: result.restoredFromVersionId }, 201);
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return withCanonicalAuth(makeHandleRestoreVersion(request, id));
}
