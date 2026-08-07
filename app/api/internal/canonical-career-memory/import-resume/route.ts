import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalResumeImportService } from "@/lib/careerMemory/services/canonicalResumeImportService";

/*
  Phase 6I.1 - bridges an EXISTING, already-uploaded `resumes` row into
  a real Canonical Career Memory profile/version. `userId` comes only
  from the authenticated session (withCanonicalAuth) - never from the
  request body, matching every other route under
  app/api/internal/canonical-career-memory/**. Gated behind the same
  isNetlifyRuntime() 404 every sibling route already has - not reachable
  in real Production, local/dev manual testing only this round.
*/
export function makeHandleImportResume(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { resumeId?: unknown };

    if (typeof body.resumeId !== "string" || body.resumeId.trim().length === 0) {
      throw new ValidationError(["resumeId is required and must be a non-empty string"]);
    }

    const service = new CanonicalResumeImportService(ctx.repos, ctx.client);
    const result = await service.importResume(ctx.userId, body.resumeId);

    if (result.status === "conflict") {
      return jsonResponse({ error: { code: "CONFLICT", message: result.reason } }, 409);
    }

    return jsonResponse(
      {
        profileId: result.profileId,
        versionId: result.versionId,
        sourceDocumentId: result.sourceDocumentId,
        roundTripValid: result.roundTripValid,
        alreadyImported: result.alreadyImported,
      },
      result.alreadyImported ? 200 : 201
    );
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleImportResume(request));
}
