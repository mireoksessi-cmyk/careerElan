import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, requireIdempotencyKey, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { requireOwnedProfile } from "@/lib/careerMemory/services/profileAccess";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { validateCanonicalCoverage } from "@/lib/careerMemory/persistence/validation";
import type { CanonicalResumeRuntime } from "@/lib/careerMemory/runtime/types";

/*
  Phase 6D.1 - GET is always safe (read-only). POST now writes the full
  bundle (1 version row + up to 5 child tables) through the
  save_canonical_runtime() SQL RPC in a single real Postgres
  transaction - see lib/careerMemory/transactions/README.md's updated
  status (the Phase 6D TRANSACTION_SCHEMA_GAP this route used to guard
  with `x-canonical-write-ack` is closed; that header/gate is removed).
  An Idempotency-Key header is required instead, so a client retry
  after a network failure/timeout replays the original result rather
  than creating a duplicate version.
*/
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
    const idempotency = requireIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { runtime?: unknown; expectedCurrentVersionId?: unknown };

    if (typeof body.runtime !== "object" || body.runtime === null) throw new ValidationError(["runtime is required and must be an object"]);
    const runtime = body.runtime as CanonicalResumeRuntime;
    const coverage = validateCanonicalCoverage(runtime.resume);
    if (!coverage.valid) throw new ValidationError(coverage.errors);

    const expectedCurrentVersionId = body.expectedCurrentVersionId === undefined ? undefined : body.expectedCurrentVersionId === null ? null : String(body.expectedCurrentVersionId);

    const service = new CanonicalCareerMemoryService(ctx.repos);
    const result = await service.saveCanonicalRuntimeAcknowledgingGap(ctx.userId, { runtime, expectedCurrentVersionId, idempotencyKey: idempotency.key });
    return jsonResponse({ version: result.version, roundTripValid: result.roundTripValid }, 201);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleListVersions(request));
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleCreateVersion(request));
}
