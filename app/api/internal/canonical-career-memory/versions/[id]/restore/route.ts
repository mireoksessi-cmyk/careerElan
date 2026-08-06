import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, requireIdempotencyKey, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalResumeVersionService } from "@/lib/careerMemory/services/canonicalResumeVersionService";

/*
  Phase 6D.1 - writes career_resume_versions only (single row, always
  atomic on its own) through the restore_canonical_version() SQL RPC -
  idempotency-key aware, so a retried restore replays the same new
  version instead of creating a second one. Still does NOT replace the
  six child tables to match the restored snapshot; see
  CanonicalResumeVersionService.restoreVersion()'s own comment.
*/
export function makeHandleRestoreVersion(request: Request, id: string) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const idempotency = requireIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown };
    if (typeof body.profileId !== "string" || body.profileId.length === 0) throw new ValidationError(["profileId is required"]);

    const service = new CanonicalResumeVersionService(ctx.repos);
    const result = await service.restoreVersion(ctx.userId, body.profileId, id, idempotency.key);
    return jsonResponse({ version: result.newVersion, restoredFromVersionId: result.restoredFromVersionId }, 201);
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return withCanonicalAuth(makeHandleRestoreVersion(request, id));
}
