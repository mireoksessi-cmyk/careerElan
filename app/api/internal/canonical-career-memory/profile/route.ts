import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { ensureProfile } from "@/lib/careerMemory/services/profileAccess";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "@/lib/careerMemory/runtime/types";

/*
  Phase 6D internal API - not called by any existing production
  route/page. GET returns the session user's own profile (or 404 if
  none exists yet); POST creates one, idempotently (see
  services/profileAccess.ts's own ensureProfile() - a retry after a
  network timeout returns the SAME row via the real
  career_profiles.user_id UNIQUE constraint, not a duplicate).

  handleGetProfile/handleCreateProfile are exported separately from
  GET/POST so tests can drive them via
  routeGuard.runWithAuthenticatedContext() + a FakeSupabaseClient,
  without needing a real Next.js request/cookie context.
*/
export async function handleGetProfile(ctx: CanonicalRouteContext): Promise<NextResponse> {
  const profile = await ctx.repos.profiles.getByUserId(ctx.userId);
  if (!profile) return jsonResponse({ error: { code: "NOT_FOUND", message: "Career profile not found." } }, 404);
  return jsonResponse({ profile });
}

export function makeHandleCreateProfile(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { schemaVersion?: unknown; serializerVersion?: unknown };

    if (typeof body.schemaVersion !== "string" || body.schemaVersion.length === 0) {
      throw new ValidationError(["schemaVersion is required and must be a non-empty string"]);
    }
    const serializerVersion = typeof body.serializerVersion === "string" && body.serializerVersion.length > 0 ? body.serializerVersion : CANONICAL_RUNTIME_SERIALIZER_VERSION;

    const profile = await ensureProfile(ctx.repos, ctx.userId, { schemaVersion: body.schemaVersion, serializerVersion });
    return jsonResponse({ profile }, 201);
  };
}

export async function GET(): Promise<NextResponse> {
  return withCanonicalAuth(handleGetProfile);
}

export async function POST(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleCreateProfile(request));
}
