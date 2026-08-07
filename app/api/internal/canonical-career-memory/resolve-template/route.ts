import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { resolveApplicationTemplateId } from "@/lib/careerMemory/services/applicationTemplateResolver";

/*
  Phase 6I.2 - the single shared "which template renders this
  preview/download" endpoint (spec section 12), backing both
  pre-generation previews (no applicationId - resolves the profile
  default) and post-generation downloads (applicationId present -
  resolves the per-application override first). userId only ever
  comes from the authenticated session, matching every sibling route
  under app/api/internal/canonical-career-memory/**.

  Response shapes:
    { kind: "legacy" }
    { kind: "selection-required", profileId }
    { kind: "canonical", templateId, source: "application-override" | "profile-default" }
  Never a bare 500/unspecified-failure - "selection-required" is a
  normal, expected response shape for a caller to handle, not an
  error.
*/
export function makeHandleResolveTemplate(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const url = new URL(request.url);
    const applicationId = url.searchParams.get("applicationId");
    const resolution = await resolveApplicationTemplateId(ctx.client, ctx.repos, ctx.userId, applicationId);
    return jsonResponse(resolution);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleResolveTemplate(request));
}
