/*
  Phase 6I.2 - spec section 12's download/preview-time priority:
    1) applications.selected_template_id (per-application override)
    2) career_profiles.default_template_id (profile default, via
       checkTemplateGate - the SAME gate used to block generation, so
       "which template renders" and "is selection required" can never
       disagree with each other)
    3) legacy renderer - ONLY when no canonical profile exists at all.

  A canonical profile with a NULL default and no per-application
  override resolves to "selection-required", never a silent pick of
  one of the 4 canonical templates (spec section 13's hard gate,
  reused here rather than re-implemented).

  `applications` is a legacy table outside CanonicalRepositoryBundle,
  so it's read via the raw RLS-authenticated `client` (the same
  pattern CanonicalRouteContext.client exists for - see
  lib/careerMemory/api/routeGuard.ts) with an explicit
  .eq("user_id", userId), never trusting RLS alone as the only
  ownership check (matches this codebase's established
  defense-in-depth convention).
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTemplateGate } from "./canonicalTemplateGate";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { TEMPLATE_IDS, type TemplateId } from "../../resumeTemplates/contracts/types";

export type ApplicationTemplateResolution =
  | { kind: "legacy" }
  | { kind: "selection-required"; profileId: string }
  | { kind: "canonical"; templateId: TemplateId; source: "application-override" | "profile-default" };

function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export async function resolveApplicationTemplateId(
  client: SupabaseClient,
  repos: CanonicalRepositoryBundle,
  userId: string,
  applicationId: string | null,
): Promise<ApplicationTemplateResolution> {
  const gate = await checkTemplateGate(repos, userId);

  if (applicationId) {
    const { data: application } = await client
      .from("applications")
      .select("selected_template_id")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (application && isTemplateId(application.selected_template_id)) {
      return { kind: "canonical", templateId: application.selected_template_id, source: "application-override" };
    }
  }

  if (gate.status === "resolved") {
    return { kind: "canonical", templateId: gate.defaultTemplateId, source: "profile-default" };
  }
  if (gate.status === "selection-required") {
    return { kind: "selection-required", profileId: gate.profileId };
  }
  return { kind: "legacy" };
}
