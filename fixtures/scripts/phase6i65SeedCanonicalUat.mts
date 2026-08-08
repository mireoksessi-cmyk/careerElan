/*
  Phase 6I.6.5 - one-off seed for real browser UAT of Canonical Package
  Analysis Parity. Creates a throwaway user, uploads a real fixture PDF
  through the same path the real upload flow uses, then runs the real
  CanonicalResumeImportService (no mocking) so the account has an actual
  canonical profile/runtime - not a synthetic ai_insight row like
  phase6i64SeedLayoutUat.mts, since this phase needs a REAL canonical
  Generate Package call to exercise packageAnalysis grounding.

  Prints email/password/userId so the browser can sign in. The caller is
  responsible for adding userId to CANONICAL_CANARY_ALLOWLIST_USER_IDS in
  .env.local (Stage 1 requires an explicit allowlist) and reverting it
  afterward - this script does not touch env config.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i65SeedCanonicalUat.mts
*/
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { CanonicalResumeImportService } from "../../lib/careerMemory/services/canonicalResumeImportService";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";

const URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_PDF_PATH = "fixtures/resumes/standard-pdf-resume.pdf";

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const email = `phase6i65-uat-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i65-canonical-uat-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;

  const userClient = createClient(URL, ANON_KEY);
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const bytes = readFileSync(FIXTURE_PDF_PATH);
  const storagePath = `${userId}/${Date.now()}-standard-pdf-resume.pdf`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: resumeRow, error: insertError } = await userClient
    .from("resumes")
    .insert({ user_id: userId, file_name: "standard-pdf-resume.pdf", storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: true })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const repos = createCanonicalRepositories(userClient);
  const importService = new CanonicalResumeImportService(repos, userClient);
  const importResult = await importService.importResume(userId, resumeRow.id as string);
  if (importResult.status !== "imported") {
    throw new Error(`Import did not succeed: ${JSON.stringify(importResult)}`);
  }

  console.log(JSON.stringify({ email, password, userId, resumeId: resumeRow.id, importResult }, null, 2));
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
