/*
  Phase 6H - demonstrates that rollback of the Canonical Generate
  Package system is a pure feature-flag flip: no database rollback,
  no data loss, no destructive step of any kind. This is not a
  regression test of the routes themselves (phase6gCanonicalGenerate
  PackageRoutes.realdb.test.mts already covers that exhaustively) - it
  specifically exercises the ON -> OFF -> re-read sequence that a real
  rollback would perform, using the exact seeding technique that file
  established (system_create_canonical_overlay + complete_canonical_
  generation, zero AI cost).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6hRollbackDemo.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandleStatus } from "../../app/api/internal/canonical-generate-package/status/route";
import { makeHandleGenerate } from "../../app/api/internal/canonical-generate-package/generate/route";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { buildFixtureRuntime } from "../../lib/careerMemory/persistence/testFixtures";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : `actual=${actual}`);
  if (actual) pass++;
  else fail++;
}

function withEnv<T>(key: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return fn().finally(() => {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  });
}

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6h-rollback-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6h-rollback-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client, session: signInData.session };
}

async function seedCanonicalFixture(client: ReturnType<typeof createClient>, userId: string) {
  const repos = createCanonicalRepositories(client);
  const service = new CanonicalCareerMemoryService(repos);
  const runtime: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
  const saved = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) throw new Error("profile not found after save");
  const { data: application, error: applicationError } = await client.from("applications").insert({ user_id: userId }).select("*").single();
  if (applicationError) throw applicationError;
  return { profile, version: saved.version, application };
}

async function seedCompletedGeneration(admin: ReturnType<typeof createClient>, userId: string, fixture: Awaited<ReturnType<typeof seedCanonicalFixture>>) {
  const overlay = await admin.rpc("system_create_canonical_overlay", {
    p_user_id: userId,
    p_profile_id: fixture.profile.id,
    p_resume_version_id: fixture.version.id,
    p_application_id: fixture.application.id,
    p_template_id: "professional-ats",
    p_ai_model: "test-model",
    p_prompt_version: "test-v1",
    p_overlay: { schemaVersion: "1.0.0" },
  });
  if (overlay.error || overlay.data?.status !== "success") throw new Error(`seed overlay failed: ${JSON.stringify(overlay.error ?? overlay.data)}`);
  const overlayId = overlay.data.overlayId as string;

  const complete = await admin.rpc("complete_canonical_generation", {
    p_user_id: userId,
    p_application_id: fixture.application.id,
    p_tailored_resume_id: overlayId,
    p_canonical_profile_id: fixture.profile.id,
    p_canonical_resume_version_id: fixture.version.id,
    p_template_id: "professional-ats",
    p_pdf_storage_bucket: "generated-documents",
    p_pdf_storage_path: `${userId}/${fixture.application.id}.pdf`,
    p_docx_storage_bucket: "generated-documents",
    p_docx_storage_path: `${userId}/${fixture.application.id}.docx`,
    p_generation_engine: "canonical",
    p_generation_engine_version: "6H-rollback-demo",
    p_protected_fact_validation_result: {},
  });
  if (complete.error || complete.data?.status !== "success") throw new Error(`seed complete failed: ${JSON.stringify(complete.error ?? complete.data)}`);
  return overlayId;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const user = await makeTestUser(admin, "u1");
  const fixture = await seedCanonicalFixture(user.client, user.userId);
  await seedCompletedGeneration(admin, user.userId, fixture);

  // ==================== Stage: flags ON — canonical reachable, data readable ====================
  await withEnv("CANONICAL_GENERATE_ENABLED", "true", async () => {
    const req = new Request(`http://localhost/api/internal/canonical-generate-package/status?applicationId=${fixture.application.id}`);
    const res = await runWithAuthenticatedContext(user.client as never, makeHandleStatus(req));
    checkTrue("ON: /status reachable (200)", res.status === 200);
    const body = (await res.json()) as { status: { generation_engine: string; selected_template_id: string } };
    checkTrue("ON: status reflects seeded canonical generation", body.status.generation_engine === "canonical" && body.status.selected_template_id === "professional-ats");
  });

  // ==================== Stage: flags OFF (ROLLBACK) — route gated, data untouched ====================
  await withEnv("CANONICAL_GENERATE_ENABLED", undefined, async () => {
    const genReq = new Request("http://localhost/api/internal/canonical-generate-package/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId: fixture.application.id, templateId: "professional-ats", jobDescriptionText: "irrelevant, flag gates before this is read" }) });
    const genRes = await runWithAuthenticatedContext(user.client as never, makeHandleGenerate(genReq));
    checkTrue("OFF: /generate returns 404 (rolled back)", genRes.status === 404);

    // Status route has no flag gate of its own (Phase 6G design: status is a
    // read-only view of already-persisted state, not a canonical-generation
    // action) - this is exactly the point: rollback disables the ability to
    // CREATE new canonical generations, it does not hide or destroy what
    // already exists. Confirm the previously seeded row is still fully intact.
    const statusReq = new Request(`http://localhost/api/internal/canonical-generate-package/status?applicationId=${fixture.application.id}`);
    const statusRes = await runWithAuthenticatedContext(user.client as never, makeHandleStatus(statusReq));
    checkTrue("OFF: previously generated data still readable (no data loss)", statusRes.status === 200);
    const body = (await statusRes.json()) as { status: { generation_engine: string; generated_pdf_document_id: string | null; generated_docx_document_id: string | null } };
    checkTrue("OFF: generation_engine unchanged", body.status.generation_engine === "canonical");
    checkTrue("OFF: pdf/docx document ids preserved", body.status.generated_pdf_document_id !== null && body.status.generated_docx_document_id !== null);
  });

  // ==================== Direct DB check: canonical profile/version/overlay rows survive the flag flip ====================
  // Queried via the OWNER'S authenticated (RLS-scoped) client, not
  // service_role - matching this codebase's established convention that
  // service_role has no direct grant on RLS-protected tables (confirmed
  // via information_schema.role_table_grants for `applications`; the
  // same pattern holds for career_* tables), access goes through RLS
  // (owner reading their own rows) or through a SECURITY DEFINER RPC.
  const { data: profileRow } = await user.client.from("career_profiles").select("id").eq("user_id", user.userId).single();
  checkTrue("DB: career_profiles row survives rollback", profileRow?.id === fixture.profile.id);
  const { data: versionRow } = await user.client.from("career_resume_versions").select("id").eq("id", fixture.version.id).single();
  checkTrue("DB: career_resume_versions row survives rollback", versionRow?.id === fixture.version.id);
  const { data: overlayRow } = await user.client.from("career_tailored_resumes").select("id").eq("application_id", fixture.application.id).single();
  checkTrue("DB: career_tailored_resumes (overlay) row survives rollback", !!overlayRow?.id);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
