import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { resolveApplicationTemplateId } from "@/lib/careerMemory/services/applicationTemplateResolver";
import { resolveResumeTemplate } from "@/lib/careerMemory/services/resolveResumeTemplate";

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

  Phase 6I.6.14 - a third query param, `resumeId`, is a completely
  separate resolution axis from `applicationId`: "what template does
  THIS SAVED resume own" (Dashboard's per-card Preview button), never
  "what template did an application already generate with." When
  `resumeId` is present it takes priority and resolveApplicationTemplateId
  is not called at all - a resumeId lookup goes through
  resolveResumeTemplate() instead, whose response shape additionally
  allows `source: "resume-explicit"` (see that file's own header
  comment for why career_profiles.default_template_id alone can no
  longer answer this question once a resume has its own explicit
  preference). Ownership of resumeId is re-verified inside
  resolveResumeTemplate() itself (never trusts the query param alone) -
  an unowned/nonexistent resumeId throws NotFoundError, mapped to 404
  by errorResponse(), matching this route's existing error contract.
*/
export function makeHandleResolveTemplate(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const url = new URL(request.url);
    const resumeId = url.searchParams.get("resumeId");
    if (resumeId) {
      const resolution = await resolveResumeTemplate(ctx.repos, ctx.client, ctx.userId, resumeId);
      return jsonResponse(resolution);
    }

    const applicationId = url.searchParams.get("applicationId");
    const resolution = await resolveApplicationTemplateId(ctx.client, ctx.repos, ctx.userId, applicationId);
    return jsonResponse(resolution);
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleResolveTemplate(request));
}
