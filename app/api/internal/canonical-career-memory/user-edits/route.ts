import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalUserEditService } from "@/lib/careerMemory/services/canonicalUserEditService";

export function makeHandleListUserEdits(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    const service = new CanonicalUserEditService(ctx.repos);
    const edits = await service.listEdits(ctx.userId, profileId);
    return jsonResponse({ userEdits: edits });
  };
}

export function makeHandleRecordUserEdit(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { profileId?: unknown; targetTable?: unknown; targetId?: unknown; fieldPath?: unknown; previousValue?: unknown; newValue?: unknown };

    if (typeof body.profileId !== "string") throw new ValidationError(["profileId is required"]);
    if (typeof body.targetTable !== "string") throw new ValidationError(["targetTable is required"]);
    if (typeof body.targetId !== "string") throw new ValidationError(["targetId is required"]);
    if (typeof body.fieldPath !== "string") throw new ValidationError(["fieldPath is required"]);

    const service = new CanonicalUserEditService(ctx.repos);
    const edit = await service.recordEdit(ctx.userId, {
      profileId: body.profileId,
      targetTable: body.targetTable,
      targetId: body.targetId,
      fieldPath: body.fieldPath,
      previousValue: body.previousValue,
      newValue: body.newValue,
    });
    return jsonResponse({ userEdit: edit }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListUserEdits(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleRecordUserEdit(request));
}
