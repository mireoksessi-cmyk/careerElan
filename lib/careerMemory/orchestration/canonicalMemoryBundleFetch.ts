/*
  Phase 6G follow-up - service-role-safe canonical career memory fetch.
  See supabase/migrations/20260807000002's own header comment for the
  full root-cause story: generateCanonicalPackage() is always called with
  a service-role client (background worker / canary route - neither runs
  inside a real user session), but the pre-existing Phase 6D repository
  layer (createCanonicalRepositories -> CanonicalCareerMemoryService.getCanonicalRuntime())
  has NO service-role table GRANT on career_profiles or its 9 child
  tables and fails for every user, not just ones without a profile - a
  real defect a real-DB test exposed.

  This function calls the new system_get_canonical_memory_bundle RPC
  (SECURITY DEFINER, explicit p_user_id ownership check) instead of the
  repository layer, reassembles the EXACT SAME CareerMemoryPersistenceBundle
  shape the repository layer already produces (to_jsonb() in the RPC
  returns the same snake_case column names select("*") already returns
  to the repositories), and hands it to the pre-existing, UNMODIFIED
  careerProfileToCanonicalRuntime() mapper - Runtime/Template Engine/
  Parser semantics are completely untouched; only HOW rows are fetched
  for a service-role caller changes. Session-authenticated callers (e.g.
  /preview, /status) are unaffected - they keep using the existing
  repository layer exactly as before.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { careerProfileToCanonicalRuntime } from "../persistence/mappers";
import type { CareerMemoryPersistenceBundle } from "../persistence/bundle";
import type { CanonicalResumeRuntime } from "../runtime/types";
import type {
  CareerAwardRow,
  CareerCredentialRow,
  CareerExperienceRow,
  CareerLanguageRow,
  CareerProfileRow,
  CareerProjectRow,
  CareerPublicationRow,
  CareerResumeVersionRow,
  CareerSourceDocumentRow,
  CareerTailoredResumeRow,
} from "../persistence/types";

type BundleRpcResult =
  | { status: "no_profile" }
  | { status: "no_version"; profile: CareerProfileRow }
  | {
      status: "success";
      profile: CareerProfileRow;
      latestVersion: CareerResumeVersionRow;
      sourceDocuments: CareerSourceDocumentRow[];
      experiences: CareerExperienceRow[];
      languages: CareerLanguageRow[];
      projects: CareerProjectRow[];
      credentials: CareerCredentialRow[];
      awards: CareerAwardRow[];
      publications: CareerPublicationRow[];
      tailoredResumes: CareerTailoredResumeRow[];
    };

export type CanonicalMemoryBundleLookup =
  | { found: false; reason: "no_profile" }
  | { found: false; reason: "no_version"; profile: CareerProfileRow }
  | { found: true; profile: CareerProfileRow; runtime: CanonicalResumeRuntime };

/*
  Mirrors CanonicalCareerMemoryService.getCanonicalRuntime()'s own read
  contract, but distinguishes "no profile" from "no version" (that
  service's own method collapses both to null) since
  generateCanonicalPackage() needs the distinction to throw the correct,
  more specific domain error for each case - a single RPC round-trip
  instead of 9+ separate queries.
*/
export async function getCanonicalRuntimeViaServiceRole(client: SupabaseClient, userId: string): Promise<CanonicalMemoryBundleLookup> {
  const { data, error } = await client.rpc("system_get_canonical_memory_bundle", { p_user_id: userId });
  if (error) throw error;
  const result = data as BundleRpcResult;

  if (result.status === "no_profile") return { found: false, reason: "no_profile" };
  if (result.status === "no_version") return { found: false, reason: "no_version", profile: result.profile };

  const bundle: CareerMemoryPersistenceBundle = {
    profile: result.profile,
    sourceDocuments: result.sourceDocuments,
    latestVersion: result.latestVersion,
    experiences: result.experiences,
    languages: result.languages,
    projects: result.projects,
    credentials: result.credentials,
    awards: result.awards,
    publications: result.publications,
    tailoredResumes: result.tailoredResumes,
  };
  return { found: true, profile: result.profile, runtime: careerProfileToCanonicalRuntime(bundle) };
}
