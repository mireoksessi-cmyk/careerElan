import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, requireIdempotencyKey, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalSourceDocumentService, type RegisterSourceDocumentInput } from "@/lib/careerMemory/services/canonicalSourceDocumentService";

export function makeHandleListSourceDocuments(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    const service = new CanonicalSourceDocumentService(ctx.repos);
    const documents = await service.listSourceDocuments(ctx.userId, profileId);
    return jsonResponse({ sourceDocuments: documents });
  };
}

export function makeHandleRegisterSourceDocument(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const idempotency = requireIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as Partial<RegisterSourceDocumentInput>;

    if (typeof body.profileId !== "string") throw new ValidationError(["profileId is required"]);
    if (typeof body.fileName !== "string") throw new ValidationError(["fileName is required"]);
    if (body.fileType !== "pdf" && body.fileType !== "docx") throw new ValidationError(["fileType must be pdf or docx"]);
    if (typeof body.contentHash !== "string") throw new ValidationError(["contentHash is required"]);
    if (typeof body.storageBucket !== "string") throw new ValidationError(["storageBucket is required"]);
    if (typeof body.storagePath !== "string") throw new ValidationError(["storagePath is required"]);

    const service = new CanonicalSourceDocumentService(ctx.repos);
    const document = await service.registerSourceDocument(ctx.userId, {
      profileId: body.profileId,
      fileName: body.fileName,
      fileType: body.fileType,
      mimeType: body.mimeType ?? null,
      byteSize: body.byteSize ?? null,
      contentHash: body.contentHash,
      storageBucket: body.storageBucket,
      storagePath: body.storagePath,
      parserVersion: body.parserVersion ?? null,
      idempotencyKey: idempotency.key,
    });
    return jsonResponse({ sourceDocument: document }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListSourceDocuments(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleRegisterSourceDocument(request));
}
