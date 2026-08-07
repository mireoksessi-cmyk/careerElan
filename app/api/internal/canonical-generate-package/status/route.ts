import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { ValidationError, NotFoundError, PersistenceError } from "@/lib/careerMemory/errors/domainErrors";
import { logCanonicalMetric } from "@/lib/careerMemory/orchestration/canonicalProductionMetrics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/*
  Phase 6G - read-only status for the canonical metadata attached to a
  legacy applications row (canonical_profile_id, tailored_resume_id,
  selected_template_id, generated_pdf_document_id/generated_docx_document_id,
  generation_engine, fallback_used/fallback_reason).

  Calls get_canonical_generation_status(p_user_id, p_application_id) -
  NOT a direct `supabaseAdmin.from("applications").select()`. Confirmed
  via information_schema.role_table_grants that service_role has NO
  direct SELECT/INSERT/UPDATE/DELETE grant on `applications` (only
  TRUNCATE/REFERENCES/TRIGGER) - a raw table query from this
  service-role client would fail with a real Postgres permission
  error, exactly the same class of bug the other 3 RPCs in this
  migration already exist to avoid. This RPC follows the identical
  security-definer + explicit p_user_id + internal ownership-check
  pattern (see supabase/migrations/20260807000000's own header
  comment). ctx.userId is ALWAYS the authenticated session's own id
  (withCanonicalAuth), never read from this request's query string or
  body.
*/
export function makeHandleStatus(request: Request) {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const url = new URL(request.url);
    const applicationId = url.searchParams.get("applicationId");
    if (!applicationId) {
      throw new ValidationError(["applicationId query parameter is required"]);
    }

    const startedAt = Date.now();
    const { data, error } = await supabaseAdmin.rpc("get_canonical_generation_status", { p_user_id: ctx.userId, p_application_id: applicationId });
    if (error) {
      logCanonicalMetric({ event: "canonical_status", applicationId, outcome: "error", errorCode: "persistence_failed", latencyMs: Date.now() - startedAt });
      throw new PersistenceError("Failed to read application canonical status.");
    }
    const result = data as { status: string; application?: Record<string, unknown> };
    if (result.status !== "success" || !result.application) {
      logCanonicalMetric({ event: "canonical_status", applicationId, outcome: "error", errorCode: "not_found", latencyMs: Date.now() - startedAt });
      throw new NotFoundError("Application not found, or does not belong to the current user.");
    }

    logCanonicalMetric({ event: "canonical_status", applicationId, outcome: "success", latencyMs: Date.now() - startedAt });
    return jsonResponse({ status: result.application });
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  return withCanonicalAuth(makeHandleStatus(request));
}
