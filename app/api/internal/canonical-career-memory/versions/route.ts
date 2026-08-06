import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { requireOwnedProfile } from "@/lib/careerMemory/services/profileAccess";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { validateCanonicalCoverage } from "@/lib/careerMemory/persistence/validation";
import type { CanonicalResumeRuntime } from "@/lib/careerMemory/runtime/types";

/*
  GET is always safe (read-only). POST writes 1 version row + up to 6
  child tables with NO real multi-table atomicity this round (see
  lib/careerMemory/transactions/README.md's own TRANSACTION_SCHEMA_GAP
  disclosure) - it requires the caller to send
  `x-canonical-write-ack: transaction-gap-acknowledged`, otherwise it
  returns 503 without touching the database at all.
*/
export const WRITE_ACK_HEADER = "x-canonical-write-ack";
export const WRITE_ACK_VALUE = "transaction-gap-acknowledged";

export function makeHandleListVersions(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ValidationError(["profileId query parameter is required"]);
    await requireOwnedProfile(ctx.repos, ctx.userId, profileId);
    const versions = await ctx.repos.resumeVersions.listByProfileId(profileId);
    return jsonResponse({ versions });
  };
}

export function makeHandleCreateVersion(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    if (request.headers.get(WRITE_ACK_HEADER) !== WRITE_ACK_VALUE) {
      return jsonResponse({ error: { code: "TRANSACTION_UNAVAILABLE", message: `This write is not atomic across its 1+6 tables (TRANSACTION_SCHEMA_GAP). Resend with "${WRITE_ACK_HEADER}: ${WRITE_ACK_VALUE}" to proceed anyway.` } }, 503);
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { runtime?: unknown; expectedCurrentVersionId?: unknown };

    if (typeof body.runtime !== "object" || body.runtime === null) throw new ValidationError(["runtime is required and must be an object"]);
    const runtime = body.runtime as CanonicalResumeRuntime;
    const coverage = validateCanonicalCoverage(runtime.resume);
    if (!coverage.valid) throw new ValidationError(coverage.errors);

    const expectedCurrentVersionId = body.expectedCurrentVersionId === undefined ? undefined : body.expectedCurrentVersionId === null ? null : String(body.expectedCurrentVersionId);

    const service = new CanonicalCareerMemoryService(ctx.repos);
    const result = await service.saveCanonicalRuntimeAcknowledgingGap(ctx.userId, { runtime, expectedCurrentVersionId });
    return jsonResponse({ version: result.version, roundTripValid: result.roundTripValid }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListVersions(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleCreateVersion(request));
}
