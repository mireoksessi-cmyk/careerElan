import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalGeneratedDocumentService } from "@/lib/careerMemory/services/canonicalGeneratedDocumentService";

export function makeHandleListGeneratedDocuments(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId");
    const tailoredResumeId = url.searchParams.get("tailoredResumeId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    if (!tailoredResumeId) throw new ValidationError(["tailoredResumeId query parameter is required"]);

    const service = new CanonicalGeneratedDocumentService(ctx.repos);
    const documents = await service.listGeneratedDocuments(ctx.userId, profileId, tailoredResumeId);
    return jsonResponse({ generatedDocuments: documents });
  };
}

export function makeHandleCreateGeneratedDocument(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown; tailoredResumeId?: unknown; storageBucket?: unknown; storagePath?: unknown; fileType?: unknown };

    if (typeof body.profileId !== "string") throw new ValidationError(["profileId is required"]);
    if (typeof body.tailoredResumeId !== "string") throw new ValidationError(["tailoredResumeId is required"]);
    if (typeof body.storageBucket !== "string") throw new ValidationError(["storageBucket is required"]);
    if (typeof body.storagePath !== "string") throw new ValidationError(["storagePath is required"]);
    if (body.fileType !== "pdf" && body.fileType !== "docx") throw new ValidationError(["fileType must be pdf or docx"]);

    const service = new CanonicalGeneratedDocumentService(ctx.repos);
    const document = await service.createGeneratedDocument(ctx.userId, {
      profileId: body.profileId,
      tailoredResumeId: body.tailoredResumeId,
      storageBucket: body.storageBucket,
      storagePath: body.storagePath,
      fileType: body.fileType,
    });
    return jsonResponse({ generatedDocument: document }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListGeneratedDocuments(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleCreateGeneratedDocument(request));
}
