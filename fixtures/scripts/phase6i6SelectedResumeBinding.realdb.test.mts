/*
  Phase 6I.6 - Selected Resume <-> Canonical Version Binding.

  Verifies the fix for the gap the Phase 6I.5 follow-up audit confirmed:
  career_memory.selected_resume_id had zero effect on any canonical
  preview/generation code path. Exercises the REAL resolveCanonicalResumeContext()
  resolver (both session and service-role modes) and the real
  resume-preview route against a REAL local Supabase instance. Synthetic
  throwaway user only (admin.auth.admin.createUser()).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i6SelectedResumeBinding.realdb.test.mts
  Requires local Supabase running.
*/
import { readFileSync } from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandleImportResume } from "../../app/api/internal/canonical-career-memory/import-resume/route";
import { makeHandleResumePreview } from "../../app/api/internal/canonical-career-memory/resume-preview/route";
import { resolveCanonicalResumeContext } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_A = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_B = "fixtures/resumes/threepage-pdf-resume.pdf";

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
  const email = `phase6i6-binding-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i6-binding-realdb-pw-123";
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
  return { resumeId: resumeRow.id as string };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function importResume(user: { client: ReturnType<typeof createClient> }, resumeId: string) {
  const res = await runWithAuthenticatedContext(user.client as never, makeHandleImportResume(jsonRequest("http://x/import-resume", "POST", { resumeId })));
  const body = await res.json();
  return { status: res.status, body };
}

async function previewHash(user: { client: ReturnType<typeof createClient> }) {
  const res = await runWithAuthenticatedContext(user.client as never, makeHandleResumePreview(new Request("http://x/resume-preview?templateId=professional-ats&format=html&variant=thumbnail")));
  const text = await res.text();
  return { status: res.status, hash: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16), body: text };
}

async function selectResume(user: { client: ReturnType<typeof createClient> }, type: "uploaded" | "career_memory", resumeId: string | null) {
  const { data: cmRow } = await user.client.from("career_memory").select("user_id").eq("user_id", user.userId).maybeSingle();
  if (!cmRow) await user.client.from("career_memory").insert({ user_id: user.userId });
  const { error } = await user.client.from("career_memory").update({ selected_resume_type: type, selected_resume_id: resumeId }).eq("user_id", user.userId);
  if (error) throw error;
}

async function countVersions(admin: ReturnType<typeof createClient>, userId: string): Promise<number> {
  const { data: profile } = await admin.from("career_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!profile) return 0;
  const { count } = await admin.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profile.id);
  return count ?? 0;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const user = await makeTestUser(admin);

  // --- Setup: upload A then B, both imported (B becomes profile's latest, matching Career Memory's always-import-on-upload policy) ---
  const a = await seedUploadedResume(admin, user, "A", FIXTURE_A);
  const importA = await importResume(user, a.resumeId);
  checkTrue("Setup: import A succeeds (201 new)", importA.status === 201);

  const b = await seedUploadedResume(admin, user, "B", FIXTURE_B);
  const importB = await importResume(user, b.resumeId);
  checkTrue("Setup: import B succeeds (201 new)", importB.status === 201);
  check("Setup: A and B produced different versions", importA.body.versionId !== importB.body.versionId, true);

  const versionCountAfterSetup = await countVersions(admin, user.userId);

  // --- S1: no selection (career_memory row exists but selected_resume_type unset) => resolves to latest (B) ---
  const previewNoSelection = await previewHash(user);
  checkTrue("S1: preview with no selection succeeds (200)", previewNoSelection.status === 200);

  // --- S2: explicitly select A (the OLDER, non-latest resume) via the legacy mechanism ---
  await selectResume(user, "uploaded", a.resumeId);
  const previewAfterSelectA = await previewHash(user);
  checkTrue("S2: preview with A selected succeeds (200)", previewAfterSelectA.status === 200);
  check("S2: THE FIX - selecting A now changes the rendered content vs. no-selection/latest(B)", previewAfterSelectA.hash !== previewNoSelection.hash, true);

  // --- S2b: direct resolver check (session mode) confirms it resolved to A's own versionId, not B's ---
  const repos = createCanonicalRepositories(user.client);
  const resolvedA = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("S2b: resolver (session mode) status is resolved", resolvedA.status, "resolved");
  if (resolvedA.status === "resolved") {
    check("S2b: resolver resolved to A's versionId (not B's)", resolvedA.versionId, importA.body.versionId);
    check("S2b: resolver source is selected-resume", resolvedA.source, "selected-resume");
  }

  // --- S3: switch selection to B => preview must switch back to B's content ---
  await selectResume(user, "uploaded", b.resumeId);
  const previewAfterSelectB = await previewHash(user);
  check("S3: selecting B renders different content than selecting A", previewAfterSelectB.hash !== previewAfterSelectA.hash, true);
  check("S3: selecting B renders the SAME content as no-selection/latest (B is both latest and selected)", previewAfterSelectB.hash, previewNoSelection.hash);

  // --- S8: §4 "Critical Application Snapshot Rule" - an application bound to A's version must keep resolving to A, even while the CURRENT selection is B ---
  const { data: appRow, error: appInsertErr } = await user.client
    .from("applications")
    .insert({ user_id: user.userId, canonical_profile_id: resolvedA.status === "resolved" ? resolvedA.profileId : null, canonical_resume_version_id: importA.body.versionId })
    .select("id")
    .single();
  checkTrue("S8: minimal applications row (bound to A's version) inserts without error", !appInsertErr && !!appRow);
  const resolvedViaApplication = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId, applicationId: appRow?.id as string });
  check("S8: application-binding resolves to A's versionId (permanently), even though B is currently selected", resolvedViaApplication.status === "resolved" ? resolvedViaApplication.versionId : null, importA.body.versionId);
  check("S8: application-binding source is 'application-binding'", resolvedViaApplication.status === "resolved" ? resolvedViaApplication.source : null, "application-binding");

  // --- S4: selected_resume_type = "career_memory" (directly-authored, non-canonical) => graceful fallback to latest, not an error ---
  await selectResume(user, "career_memory", null);
  const resolvedCareerMemory = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("S4: career_memory-type selection resolves to 'not-canonical'", resolvedCareerMemory.status, "not-canonical");
  const previewCareerMemorySelected = await previewHash(user);
  checkTrue("S4: preview route still succeeds (200) for career_memory-type selection (graceful fallback)", previewCareerMemorySelected.status === 200);
  check("S4: preview fallback renders latest (B) content, unchanged from S3", previewCareerMemorySelected.hash, previewAfterSelectB.hash);

  // --- S5: selected_resume_id points at a deleted/foreign resume => SELECTED_RESUME_UNAVAILABLE (409), never silent latest ---
  const fakeResumeId = "00000000-0000-0000-0000-000000000000";
  await selectResume(user, "uploaded", fakeResumeId);
  const previewDangling = await previewHash(user);
  check("S5: dangling selected_resume_id returns 409 (SELECTED_RESUME_UNAVAILABLE), not a silent 200", previewDangling.status, 409);
  let danglingBody: { error?: { code?: string } } = {};
  try {
    danglingBody = JSON.parse(previewDangling.body);
  } catch {
    /* leave empty */
  }
  check("S5: error code is SELECTED_RESUME_UNAVAILABLE", danglingBody.error?.code, "SELECTED_RESUME_UNAVAILABLE");

  // --- S6: §18 zero side-effect check - resolving/previewing A (a non-latest selection) repeatedly must NEVER create new versions ---
  await selectResume(user, "uploaded", a.resumeId);
  await previewHash(user);
  await previewHash(user);
  await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  const versionCountAfterRepeatedPreview = await countVersions(admin, user.userId);
  check("S6: repeated preview/resolve of a non-latest selection creates ZERO new versions (§18)", versionCountAfterRepeatedPreview, versionCountAfterSetup);

  // --- S7: service-role mode resolver (the Generate Package path) also honors selection, matching session mode ---
  const resolvedServiceRoleA = await resolveCanonicalResumeContext({ mode: "service-role", client: admin, userId: user.userId });
  check("S7: service-role resolver status is resolved", resolvedServiceRoleA.status, "resolved");
  if (resolvedServiceRoleA.status === "resolved") {
    check("S7: service-role resolver resolves to A's versionId (matches session mode)", resolvedServiceRoleA.versionId, importA.body.versionId);
    checkTrue("S7: service-role resolver returns a populated runtime", !!resolvedServiceRoleA.runtime);
  }
  const versionCountAfterServiceRole = await countVersions(admin, user.userId);
  check("S7b: service-role resolution also creates ZERO new versions", versionCountAfterServiceRole, versionCountAfterSetup);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
