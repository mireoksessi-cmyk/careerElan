import { NextResponse } from "next/server";
import { withCanonicalAuth, readJsonBody, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { setApplicationTemplate } from "@/lib/careerMemory/services/applicationTemplateSwitchService";

/*
  Phase 6I.2 - the application-level template switch (spec section 11):
  PUT { applicationId, templateId, setAsDefault? }. userId only ever
  comes from the authenticated session. Distinct from PUT
  .../template-preference (the profile-level default) - this route
  only ever touches applications.selected_template_id for ONE
  application, and only additionally touches career_profiles.default_
  template_id when the caller explicitly passes setAsDefault: true
  (spec section 11's own "Only if the user explicitly chooses 'Set as
  my default'").
*/
export function makeHandlePutApplicationTemplate(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as Record<string, unknown>;

    if (typeof body.applicationId !== "string" || body.applicationId.length === 0) {
      throw new ValidationError(["applicationId is required and must be a non-empty string"]);
    }
    if (typeof body.templateId !== "string" || body.templateId.length === 0) {
      throw new ValidationError(["templateId is required and must be a non-empty string"]);
    }
    const setAsDefault = body.setAsDefault === true;

    const result = await setApplicationTemplate(ctx.client, ctx.repos, ctx.userId, body.applicationId, body.templateId, setAsDefault);
    return jsonResponse(result);
  };
}

export async function PUT(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandlePutApplicationTemplate(request));
}
