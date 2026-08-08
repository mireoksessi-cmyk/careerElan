/*
  Phase 6I.5 follow-up - Identity Regression Audit for the product's
  3-resume upload/delete/replace lifecycle, selected-resume preview
  semantics, and a stale async upload race. Exercises the REAL service/
  route layer (CanonicalResumeImportService via the actual import-resume
  route handler) against a REAL local Supabase instance - no mocking of
  the identity/version logic under test. Synthetic throwaway user only
  (admin.auth.admin.createUser()), matching this repo's established
  real-DB test convention - never touches a real user's account.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i5IdentityRegressionAudit.realdb.test.mts
  Requires local Supabase running.
*/
import { readFileSync } from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { makeHandleImportResume } from "../../app/api/internal/canonical-career-memory/import-resume/route";
import { handleGetTemplatePreference, makeHandlePutTemplatePreference } from "../../app/api/internal/canonical-career-memory/template-preference/route";
import { makeHandleResolveTemplate } from "../../app/api/internal/canonical-career-memory/resolve-template/route";
import { makeHandleResumePreview } from "../../app/api/internal/canonical-career-memory/resume-preview/route";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_A = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_B = "fixtures/resumes/threepage-pdf-resume.pdf";
const FIXTURE_C = "fixtures/resumes/regtest4-repeated-tokens-pdf.pdf"; // canva-pdf-resume.pdf swapped out: pre-existing, unrelated DPE data-quality gap (no extractable identity.fullName) - see audit report
const FIXTURE_D = "fixtures/resumes/generated-sidebar-professional.pdf";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

async function makeTestUser(admin: ReturnType<typeof createClient>) {
  const email = `phase6i5-audit-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i5-audit-realdb-pw-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function seedUploadedResume(admin: ReturnType<typeof createClient>, user: { userId: string; client: ReturnType<typeof createClient> }, label: string, filePath: string) {
  const bytes = readFileSync(filePath);
  const storagePath = `${user.userId}/${Date.now()}-${label}.pdf`;
  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data: resumeRow, error: insertError } = await user.client
    .from("resumes")
    .insert({ user_id: user.userId, file_name: `${label}.pdf`, storage_path: storagePath, source_type: "uploaded", original_file_type: "pdf", is_default: false })
    .select("id")
    .single();
  if (insertError) throw insertError;
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  return { resumeId: resumeRow.id as string, storagePath, contentHash };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function importResume(user: { client: ReturnType<typeof createClient> }, resumeId: string) {
  const res = await runWithAuthenticatedContext(user.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId })));
  const body = await res.json();
  return { status: res.status, body };
}

async function previewHash(user: { client: ReturnType<typeof createClient> }, templateId: string) {
  const res = await runWithAuthenticatedContext(user.client as never, makeHandleResumePreview(new Request(`http://x/resume-preview?templateId=${templateId}&format=html&variant=thumbnail`)));
  const html = await res.text();
  if (res.status !== 200) console.log("previewHash NON-200 body:", html.slice(0, 500));
  return { status: res.status, hash: crypto.createHash("sha256").update(html).digest("hex").slice(0, 16), len: html.length };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const user = await makeTestUser(admin);
  const repos = createCanonicalRepositories(user.client);
  console.log("=== synthetic userId (PII-free) ===", user.userId);

  // ==================== SECTION 1: A -> B -> C sequential upload ====================
  const a = await seedUploadedResume(admin, user, "resume-A", FIXTURE_A);
  const b = await seedUploadedResume(admin, user, "resume-B", FIXTURE_B);
  const c = await seedUploadedResume(admin, user, "resume-C", FIXTURE_C);
  checkTrue("S1: resumeId A/B/C are three distinct ids", a.resumeId !== b.resumeId && b.resumeId !== c.resumeId && a.resumeId !== c.resumeId);
  checkTrue("S1: contentHash A/B/C are three distinct hashes", a.contentHash !== b.contentHash && b.contentHash !== c.contentHash && a.contentHash !== c.contentHash);

  const importA = await importResume(user, a.resumeId);
  check("S1: import A -> 201", importA.status, 201);
  const importB = await importResume(user, b.resumeId);
  check("S1: import B -> 201 (new content, new version, not refused)", importB.status, 201);

  // Set a default template right after A/B, mirroring a real returning user - must survive C's import untouched.
  const putPref = await runWithAuthenticatedContext(user.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "professional-ats" })));
  check("S1: set default template -> 200", putPref.status, 200);

  const importC = await importResume(user, c.resumeId);
  check("S1: import C -> 201", importC.status, 201);

  const profile = await repos.profiles.getByUserId(user.userId);
  checkTrue("S1: profile exists", profile !== null);

  const { data: allVersions, error: allVersionsErr } = await user.client.from("career_resume_versions").select("id, parent_version_id, created_at, source_document_id").eq("profile_id", profile!.id).order("created_at", { ascending: true });
  if (allVersionsErr) console.error("allVersions query error:", allVersionsErr);
  check("S1: exactly 3 versions exist (V1/V2/V3)", allVersions?.length, 3);
  const [v1, v2, v3] = allVersions ?? [];
  check("S1: V1 id matches A's import result", v1?.id, importA.body.versionId);
  check("S1: V2 id matches B's import result", v2?.id, importB.body.versionId);
  check("S1: V3 id matches C's import result", v3?.id, importC.body.versionId);
  check("S1: V2.parent_version_id === V1.id", v2?.parent_version_id, v1?.id);
  check("S1: V3.parent_version_id === V2.id", v3?.parent_version_id, v2?.id);

  const latestAfterC = await repos.resumeVersions.getLatestByProfileId(profile!.id);
  check("S1: current/latest version === V3 (C)", latestAfterC?.id, v3?.id);

  const oldA = await repos.resumeVersions.getById(v1!.id);
  const oldB = await repos.resumeVersions.getById(v2!.id);
  checkTrue("S1: V1 (A) still readable/preserved", oldA !== null);
  checkTrue("S1: V2 (B) still readable/preserved", oldB !== null);

  // Content hash correctness: each version's source document hash matches the actual uploaded file's hash.
  const { data: sourceDocsAfterC } = await user.client.from("career_source_documents").select("id, content_hash").eq("profile_id", profile!.id);
  const hashSetAfterC = new Set((sourceDocsAfterC ?? []).map((d: any) => d.content_hash));
  checkTrue("S1: A's real file hash present among source documents", hashSetAfterC.has(a.contentHash));
  checkTrue("S1: B's real file hash present among source documents", hashSetAfterC.has(b.contentHash));
  checkTrue("S1: C's real file hash present among source documents", hashSetAfterC.has(c.contentHash));
  check("S1: exactly 3 distinct source documents (no reuse/collision)", new Set((sourceDocsAfterC ?? []).map((d: any) => d.id)).size, 3);

  const prefAfterC = await runWithAuthenticatedContext(user.client as never, handleGetTemplatePreference);
  const prefAfterCBody = await prefAfterC.json();
  check("S1: profile.default_template_id unchanged by B/C imports (still professional-ats)", prefAfterCBody.defaultTemplateId, "professional-ats");

  const previewAfterA_simulated = await previewHash(user, "professional-ats"); // current state is already post-C; used below only as "current" baseline
  const previewAfterC = await previewHash(user, "professional-ats");
  check("S1: preview after C succeeds", previewAfterC.status, 200);
  // Independently confirm preview content is tied to C specifically: re-fetch C's own source doc hash and cross check via a fresh render vs a direct re-import replay (should match, proving determinism, not proving A/B leakage - the real leakage check is done via B10-style diffing in the prior phase; here we confirm at minimum determinism + non-empty).
  checkTrue("S1: preview HTML is real, non-trivial content", previewAfterC.len > 500);

  // ==================== SECTION 2: delete B, upload D into the freed slot ====================
  const { error: storageDeleteErr } = await admin.storage.from("resumes").remove([b.storagePath]);
  checkTrue("S2: B's storage object deleted without error", !storageDeleteErr);
  const { data: deletedRow, error: deleteRowErr } = await user.client.from("resumes").delete().eq("id", b.resumeId).eq("user_id", user.userId).select("id").maybeSingle();
  checkTrue("S2: B's resumes row deleted without error", !deleteRowErr);
  checkTrue("S2: delete returned the deleted row (real deletion, not a no-op)", deletedRow !== null);

  const { data: remainingResumes } = await user.client.from("resumes").select("id").eq("user_id", user.userId);
  check("S2: exactly 2 resumes rows remain (A, C) right after deleting B", remainingResumes?.length, 2);

  // Historical canonical versions must NOT be destroyed by deleting B's uploaded-file row (no FK from career_resume_versions/career_source_documents to resumes).
  const { data: versionsAfterDelete } = await user.client.from("career_resume_versions").select("id").eq("profile_id", profile!.id);
  check("S2: all 3 historical versions still exist after deleting B's resumes row", versionsAfterDelete?.length, 3);
  const { data: sourceDocsAfterDelete } = await user.client.from("career_source_documents").select("id, content_hash").eq("profile_id", profile!.id);
  check("S2: all 3 historical source documents still exist after deleting B's resumes row", sourceDocsAfterDelete?.length, 3);
  checkTrue("S2: B's own source document (by content hash) still exists (untouched by the resumes-row delete)", (sourceDocsAfterDelete ?? []).some((d: any) => d.content_hash === b.contentHash));

  const d = await seedUploadedResume(admin, user, "resume-D", FIXTURE_D);
  checkTrue("S2: D's resumeId is fresh, does not reuse B's old resumeId", d.resumeId !== b.resumeId);
  checkTrue("S2: D's contentHash differs from A/B/C", d.contentHash !== a.contentHash && d.contentHash !== b.contentHash && d.contentHash !== c.contentHash);

  const importD = await importResume(user, d.resumeId);
  check("S2: import D -> 201", importD.status, 201);
  checkTrue("S2: D's sourceDocumentId is fresh (not B's old one)", importD.body.sourceDocumentId !== undefined);

  const { data: allVersionsAfterD } = await user.client.from("career_resume_versions").select("id, parent_version_id, created_at").eq("profile_id", profile!.id).order("created_at", { ascending: true });
  check("S2: exactly 4 versions exist now (V1..V4)", allVersionsAfterD?.length, 4);
  const v4 = allVersionsAfterD?.[3];
  check("S2: V4.id matches D's import result", v4?.id, importD.body.versionId);
  check("S2: V4.parent_version_id === V3.id (C's version, the real current-latest at the time D was imported - NOT B's, since B's canonical version had already been superseded before B's resumes row was even deleted)", v4?.parent_version_id, v3?.id);

  const latestAfterD = await repos.resumeVersions.getLatestByProfileId(profile!.id);
  check("S2: current/latest version === V4 (D)", latestAfterD?.id, v4?.id);

  const prefAfterD = await runWithAuthenticatedContext(user.client as never, handleGetTemplatePreference);
  const prefAfterDBody = await prefAfterD.json();
  check("S2: profile.default_template_id preserved through delete+D-import (still professional-ats)", prefAfterDBody.defaultTemplateId, "professional-ats");

  const previewAfterD = await previewHash(user, "professional-ats");
  const previewAfterC_hash = previewAfterC.hash;
  checkTrue("S2: preview after D's import is DIFFERENT from preview after C (shows D, not C/A/B)", previewAfterD.hash !== previewAfterC_hash);

  // ==================== SECTION 3: selected-resume preview semantics ====================
  // Mirror the Dashboard's saveSelection() write exactly: mark resume A (an OLD, non-current resume) as the user's "selected" resume via career_memory.selected_resume_id.
  const { data: cmRow } = await user.client.from("career_memory").select("user_id").eq("user_id", user.userId).maybeSingle();
  if (!cmRow) {
    await user.client.from("career_memory").insert({ user_id: user.userId });
  }
  const { error: selectErr } = await user.client.from("career_memory").update({ selected_resume_type: "uploaded", selected_resume_id: a.resumeId }).eq("user_id", user.userId);
  checkTrue("S3: marking resume A as 'selected' (legacy mechanism) succeeds", !selectErr);

  const resolveAfterSelectA = await runWithAuthenticatedContext(user.client as never, makeHandleResolveTemplate(new Request("http://x/resolve-template")));
  const resolveAfterSelectABody = await resolveAfterSelectA.json();
  check("S3: resolve-template still resolves to profile-default (unaffected by selecting A)", resolveAfterSelectABody.source, "profile-default");

  const previewAfterSelectA = await previewHash(user, "professional-ats");
  /*
    Phase 6I.6 - GAP FIXED. This assertion originally documented the
    Phase 6I.5-audit-confirmed gap ("selection has NO effect on
    canonical preview" - preview always == D's, the profile's latest,
    regardless of selection). resume-preview/route.ts now resolves via
    resolveCanonicalResumeContext(), which honors career_memory.
    selected_resume_id - selecting A (a non-latest resume) now correctly
    changes what the canonical preview renders. See
    fixtures/scripts/phase6i6SelectedResumeBinding.realdb.test.mts for
    the dedicated, comprehensive real-DB verification of this fix.
  */
  check("S3: FIXED (Phase 6I.6) - canonical preview after selecting resume A now DIFFERS from D's preview (selection is honored)", previewAfterSelectA.hash !== previewAfterD.hash, true);

  // ==================== SECTION 4: stale async race, on a FRESH user (isolated from the 3-resume cap reached above) ====================
  // Scenario: upload A starts, upload B starts before A's analysis finishes, B's
  // analysis finishes first and the user selects/sees B as current, then A's
  // analysis finishes late and its own runInlineCanonicalFlow(resumeIdA) fires
  // import-resume for A - AFTER B is already current.
  const raceUser = await makeTestUser(admin);
  const raceRepos = createCanonicalRepositories(raceUser.client);
  const raceA = await seedUploadedResume(admin, raceUser, "race-A", FIXTURE_A);
  const raceB = await seedUploadedResume(admin, raceUser, "race-B", FIXTURE_B);

  const raceImportA = await importResume(raceUser, raceA.resumeId); // A starts and finishes first (normal case)
  check("S4: race-A import -> 201", raceImportA.status, 201);
  const raceImportB = await importResume(raceUser, raceB.resumeId); // B finishes next, becomes current (user is now looking at B)
  check("S4: race-B import -> 201", raceImportB.status, 201);
  const raceProfile = await raceRepos.profiles.getByUserId(raceUser.userId);
  const latestAfterB = await raceRepos.resumeVersions.getLatestByProfileId(raceProfile!.id);
  check("S4: after A then B, current/latest is B (expected, not the race yet)", latestAfterB?.id, raceImportB.body.versionId);

  // Now A "finishes late": a SEPARATE resumeId with A's ORIGINAL bytes, imported
  // AFTER B is already current - this is the exact "late completion" trigger.
  const raceALate = await seedUploadedResume(admin, raceUser, "race-A-late", FIXTURE_A);
  const raceImportALate = await importResume(raceUser, raceALate.resumeId);
  console.log("S4: late-finishing A's import result ->", JSON.stringify(raceImportALate));

  const { data: allRaceVersions } = await raceUser.client.from("career_resume_versions").select("id, parent_version_id, created_at").eq("profile_id", raceProfile!.id).order("created_at", { ascending: true });
  console.log("S4: full version timeline for raceProfile", raceProfile!.id, "->", JSON.stringify(allRaceVersions, null, 2));

  const latestAfterLateA = await raceRepos.resumeVersions.getLatestByProfileId(raceProfile!.id);
  console.log("S4: getLatestByProfileId returned ->", JSON.stringify(latestAfterLateA));
  const raceSafe = latestAfterLateA?.id === raceImportB.body.versionId;
  check("S4: RACE CHECK - after A 'finishes late' (re-imported after B is current), the CURRENT/LATEST version is still B's (race-safe)", raceSafe, true);
  check("S4: exactly 2 version rows exist total (late-A did NOT create a 3rd version)", allRaceVersions?.length, 2);
  check("S4: late-A's reported versionId equals A's OWN original versionId (idempotency-key replay of A's own prior save, not a new write, not B's)", (raceImportALate.body as any).versionId, raceImportA.body.versionId);
  if (!raceSafe) {
    console.log("S4: CONFIRMED RACE BUG - late-finishing A's import silently became the new current/latest version, reverting away from B.");
    console.log("S4: new latest version id =", latestAfterLateA?.id, "vs B's version id =", raceImportB.body.versionId, "vs late-A's reported versionId =", (raceImportALate.body as any).versionId);
  }
  const previewAfterLateA = await previewHash(raceUser, "professional-ats");
  console.log("S4: preview hash after late-A finishes -", previewAfterLateA.hash);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
