import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { isCanonicalGenerateEnabled, isCanonicalTemplateSelectorEnabled } from "@/lib/careerMemory/orchestration/featureFlags";

/*
  Phase 6G - the ONLY thing the Paste Job UI needs to decide whether to
  render the (otherwise invisible) template selector at all. Returns
  two booleans, nothing else - no user data, no canonical content, safe
  to call on every page load. Requires an authenticated session (same
  withCanonicalAuth gate as every other route in this surface, and the
  same real Netlify-Production 404 gate) purely for consistency, not
  because the flag values themselves are sensitive.
*/
export function makeHandleConfig() {
  return async (_ctx: CanonicalRouteContext): Promise<NextResponse> => {
    return jsonResponse({
      generateEnabled: isCanonicalGenerateEnabled(),
      templateSelectorEnabled: isCanonicalTemplateSelectorEnabled(),
    });
  };
}

export async function GET(): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleConfig());
}
