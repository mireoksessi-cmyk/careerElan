import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalSourceDocumentService } from "@/lib/careerMemory/services/canonicalSourceDocumentService";
import type { SourceDocumentAnalysisStatus } from "@/lib/careerMemory/persistence/types";

const VALID_STATUSES: SourceDocumentAnalysisStatus[] = ["pending", "processing", "succeeded", "failed"];

export function makeHandleUpdateAnalysisStatus(request: Request, id: string) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown; status?: unknown };

    if (typeof body.profileId !== "string") throw new ValidationError(["profileId is required"]);
    if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status as SourceDocumentAnalysisStatus)) {
      throw new ValidationError([`status must be one of ${VALID_STATUSES.join("/")}`]);
    }

    const service = new CanonicalSourceDocumentService(ctx.repos);
    const document = await service.updateAnalysisStatus(ctx.userId, body.profileId, id, body.status as SourceDocumentAnalysisStatus);
    return jsonResponse({ sourceDocument: document });
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return withCanonicalAuth(makeHandleUpdateAnalysisStatus(request, id));
}
