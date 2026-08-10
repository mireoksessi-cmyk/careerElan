/*
  Phase 6I.6.35 - synthetic E2E user + fixture seeding. Reuses the same
  makeTestUser()/seedUploadedResume() shapes already established across
  this repo's fixtures/scripts/*.realdb.test.mts real-DB test suites
  (not reimplemented from scratch), and calls the REAL production
  CanonicalResumeImportService + setResumeTemplatePreference() rather
  than hand-writing canonical rows - the E2E suite must exercise real
  product orchestration, not a parallel test-only implementation of it.
*/
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import path from "path";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { setResumeTemplatePreference } from "../../lib/careerMemory/services/resolveResumeTemplate";
import { SUPABASE_LOCAL_URL } from "./env";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const FIXTURE_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "standard-pdf-resume.pdf");

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_LOCAL_URL, SERVICE_ROLE_KEY);
}

export type E2eTestUser = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export async function createSyntheticE2eUser(admin: SupabaseClient, tag: string): Promise<E2eTestUser> {
  const email = `phase6i635-e2e-${tag}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i635-e2e-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(SUPABASE_LOCAL_URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, email, password, client };
}

/*
  Seeds one uploaded resume, imports it through the REAL canonical
  import service (so Generate Package's resolveCanonicalResumeContext
  finds a real canonical profile/version, exactly like a real user who
  completed the "prepare for Canonical Templates" step), selects it as
  the active resume, and sets its template preference via the REAL
  setResumeTemplatePreference() - all of this is DB/service-level setup
  done once in globalSetup, not something the E2E suite re-derives via
  UI clicks for every spec (the actual Dashboard upload UI itself is
  separately exercised for real in the upload-focused spec).
*/
export async function seedCanonicalResumeForUser(admin: SupabaseClient, user: E2eTestUser, templateId: string): Promise<{ resumeId: string; canonicalProfileId: string; canonicalResumeVersionId: string }> {
  const bytes = readFileSync(FIXTURE_PDF);
  const storagePath = `${user.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-e2e-resume.pdf`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({
      user_id: user.userId,
      file_name: "e2e-resume.pdf",
      storage_path: storagePath,
      source_type: "uploaded",
      original_file_type: "pdf",
      is_default: true,
      original_text: "E2E-RESUME-MARKER-635 deterministic synthetic resume text for Phase 6I.6.35 E2E testing.",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  const resumeId = resumeRow.id as string;

  const repositories = createCanonicalRepositories(user.client as never);
  const importService = new CanonicalResumeImportService(repositories, user.client as never);
  const importResult = await importService.importResume(user.userId, resumeId);
  if (importResult.status !== "imported") {
    throw new Error(`seedCanonicalResumeForUser: canonical import failed: ${JSON.stringify(importResult)}`);
  }

  await setResumeTemplatePreference(user.client as never, user.userId, resumeId, templateId);
  /*
    required_completed: true - PublicAuthActions.tsx's handleEmailLogin()
    gates the post-login redirect strictly on this flag
    (memory?.required_completed === true ? "/dashboard" : "/career-memory"),
    independent of whether the user has an uploaded/imported resume. This
    synthetic user already completed the real onboarding-equivalent step
    (a canonically-imported resume via the real import service above), so
    marking it complete here reflects that truthfully rather than
    fighting the redirect in every spec that logs in.
  */
  await user.client.from("career_memory").upsert({ user_id: user.userId, selected_resume_type: "uploaded", selected_resume_id: resumeId, required_completed: true }, { onConflict: "user_id" });

  return { resumeId, canonicalProfileId: importResult.profileId as string, canonicalResumeVersionId: importResult.versionId as string };
}

/*
  Scoped cleanup (Part BD) - deletes exactly this user's rows across
  every table an E2E run can touch, never a broad "delete all E2E
  data" sweep. auth.admin.deleteUser cascades to most user-scoped
  tables via FK ON DELETE CASCADE (confirmed by this repo's existing
  schema convention for user-owned tables), but applications/
  generate_package_quota_reservations rows are deleted explicitly
  first since some real-DB suites in this repo have found cascade
  ordering to matter for RPC-managed aggregate tables.
*/
export async function cleanupSyntheticE2eUser(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from("applications").delete().eq("user_id", userId);
  await admin.from("generate_package_quota_reservations").delete().eq("user_id", userId);
  await admin.from("generate_package_quota_periods").delete().eq("user_id", userId);
  const { data: resumes } = await admin.from("resumes").select("storage_path").eq("user_id", userId);
  for (const row of resumes ?? []) {
    if (row.storage_path) await admin.storage.from("resumes").remove([row.storage_path]);
  }
  const { data: generatedDocs } = await admin.storage.from("generated-documents").list(userId);
  if (generatedDocs && generatedDocs.length > 0) {
    await admin.storage.from("generated-documents").remove(generatedDocs.map((f) => `${userId}/${f.name}`));
  }
  await admin.auth.admin.deleteUser(userId);
}
