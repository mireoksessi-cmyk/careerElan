/*
  Phase 6I.6.1 - Selected Template Visual Propagation.

  Verifies the fix for the bug this round addresses: Career Memory
  correctly rendered "selected resume + default template", but Dashboard
  and Paste Job (pre-generation) did not - Dashboard's summary panel only
  showed the template id as plain text (never an actual rendering), and
  Paste Job's canonical, selection-aware preview branch existed but was
  unreachable before Generate Package ran (nested inside {generated &&
  (...)}). Both surfaces now render via the SAME canonical resume-preview
  route (app/api/internal/canonical-career-memory/resume-preview) this
  test exercises directly - since Dashboard/Paste Job are React pages
  (not separately-testable route handlers), this test proves the
  UNDERLYING route resolves resume identity + template correctly for
  every scenario the spec names (A-D, F); the actual page-level wiring
  (which iframe src each page now renders) is confirmed separately via
  real browser UAT (see the Phase 6I.6.1 Korean report).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i61TemplatePropagation.realdb.test.mts
  Requires local Supabase running.
*/
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandleImportResume } from "../../app/api/internal/canonical-career-memory/import-resume/route";
import { makeHandleResumePreview } from "../../app/api/internal/canonical-career-memory/resume-preview/route";
import { makeHandlePutTemplatePreference } from "../../app/api/internal/canonical-career-memory/template-preference/route";
import { resolveCanonicalResumeContext } from "../../lib/careerMemory/services/resolveCanonicalResumeContext";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const FIXTURE_A = "fixtures/resumes/standard-pdf-resume.pdf";
const FIXTURE_B = "fixtures/resumes/threepage-pdf-resume.pdf";

// distinctive, template-unique markers (see Phase 6I.6.1 audit) - never rely on templateId appearing literally in HTML
const MARKER = {
  "professional-ats": 'class="ats-page"',
  "executive-minimal": 'class="flow-container"',
  "modern-sidebar": "#1f2a24",
  "creative-timeline": "#332742",
} as const;

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
  const email = `phase6i61-tmpl-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i61-tmpl-realdb-pw-123";
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

async function selectResume(user: { client: ReturnType<typeof createClient> }, userId: string, type: "uploaded" | "career_memory", resumeId: string | null) {
  const { data: cmRow } = await user.client.from("career_memory").select("user_id").eq("user_id", userId).maybeSingle();
  if (!cmRow) await user.client.from("career_memory").insert({ user_id: userId });
  const { error } = await user.client.from("career_memory").update({ selected_resume_type: type, selected_resume_id: resumeId }).eq("user_id", userId);
  if (error) throw error;
}

async function setDefaultTemplate(user: { client: ReturnType<typeof createClient> }, templateId: string) {
  const res = await runWithAuthenticatedContext(user.client as never, makePutHandler(templateId));
  if (res.status !== 200) throw new Error(`setDefaultTemplate failed: ${res.status} ${await res.text()}`);
}
function makePutHandler(templateId: string) {
  return makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId }));
}

async function previewHtml(user: { client: ReturnType<typeof createClient> }, templateId: string) {
  const res = await runWithAuthenticatedContext(user.client as never, makeHandleResumePreview(new Request(`http://x/resume-preview?templateId=${templateId}&format=html&variant=full`)));
  const html = await res.text();
  return { status: res.status, html };
}

function containsMarker(html: string, templateId: keyof typeof MARKER): boolean {
  return html.includes(MARKER[templateId]);
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const user = await makeTestUser(admin);
  const repos = createCanonicalRepositories(user.client);

  const a = await seedUploadedResume(admin, user, "TA", FIXTURE_A);
  const importA = await importResume(user, a.resumeId);
  checkTrue("Setup: import A succeeds", importA.status === 201);

  const b = await seedUploadedResume(admin, user, "TB", FIXTURE_B);
  const importB = await importResume(user, b.resumeId);
  checkTrue("Setup: import B succeeds", importB.status === 201);

  const { data: profileRow } = await user.client.from("career_profiles").select("id").eq("user_id", user.userId).maybeSingle();
  checkTrue("Setup: canonical profile exists", !!profileRow);

  // ==================== Scenario A: selected resume = A, default template = modern-sidebar ====================
  await selectResume(user, user.userId, "uploaded", a.resumeId);
  await setDefaultTemplate(user, "modern-sidebar");

  const previewA_sidebar = await previewHtml(user, "modern-sidebar");
  checkTrue("A: preview succeeds (200)", previewA_sidebar.status === 200);
  checkTrue("A: renders modern-sidebar marker", containsMarker(previewA_sidebar.html, "modern-sidebar"));
  checkTrue("A: does NOT render creative-timeline marker", !containsMarker(previewA_sidebar.html, "creative-timeline"));
  checkTrue("A: does NOT render professional-ats marker", !containsMarker(previewA_sidebar.html, "professional-ats"));
  checkTrue("A: does NOT render executive-minimal marker", !containsMarker(previewA_sidebar.html, "executive-minimal"));

  const resolvedA = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("A: resolver resolves to A's versionId", resolvedA.status === "resolved" ? resolvedA.versionId : null, importA.body.versionId);

  // ==================== Scenario B: change default template only (modern-sidebar -> creative-timeline), same resume A ====================
  await setDefaultTemplate(user, "creative-timeline");
  const previewA_timeline = await previewHtml(user, "creative-timeline");
  checkTrue("B: preview succeeds (200)", previewA_timeline.status === 200);
  checkTrue("B: renders creative-timeline marker", containsMarker(previewA_timeline.html, "creative-timeline"));
  checkTrue("B: does NOT render modern-sidebar marker", !containsMarker(previewA_timeline.html, "modern-sidebar"));

  const resolvedA_afterTemplateChange = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("B: resume identity unchanged (still A's versionId) after a template-only change", resolvedA_afterTemplateChange.status === "resolved" ? resolvedA_afterTemplateChange.versionId : null, importA.body.versionId);

  const { data: profileForCount } = await user.client.from("career_profiles").select("id").eq("user_id", user.userId).maybeSingle();
  const { count: versionCountAfterB } = await user.client.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileForCount!.id);
  check("B: template-only change created ZERO new resume versions", versionCountAfterB, 2);

  // ==================== Scenario C: change selected resume (A -> B), keep default template = creative-timeline ====================
  await selectResume(user, user.userId, "uploaded", b.resumeId);
  const previewB_timeline = await previewHtml(user, "creative-timeline");
  checkTrue("C: preview succeeds (200)", previewB_timeline.status === 200);
  checkTrue("C: still renders creative-timeline marker (template unchanged)", containsMarker(previewB_timeline.html, "creative-timeline"));

  const resolvedB = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("C: resolver now resolves to B's versionId (not A's)", resolvedB.status === "resolved" ? resolvedB.versionId : null, importB.body.versionId);
  checkTrue("C: A's content no longer resolved (resumeVersionId differs from A)", (resolvedB.status === "resolved" ? resolvedB.versionId : null) !== importA.body.versionId);

  const { count: versionCountAfterC } = await user.client.from("career_resume_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileForCount!.id);
  check("C: selection-only change created ZERO new resume versions", versionCountAfterC, 2);

  // ==================== Scenario D: existing application snapshot survives later selection/default changes ====================
  await selectResume(user, user.userId, "uploaded", a.resumeId); // back to A, to bind the application to A specifically
  const resolvedForApp = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  const appliedVersionId = resolvedForApp.status === "resolved" ? resolvedForApp.versionId : null;
  const { data: appRow, error: appInsertErr } = await user.client
    .from("applications")
    .insert({ user_id: user.userId, canonical_profile_id: profileForCount!.id, canonical_resume_version_id: appliedVersionId, selected_template_id: "modern-sidebar" })
    .select("id")
    .single();
  checkTrue("D: application row (A + modern-sidebar override) inserts", !appInsertErr && !!appRow);

  // now change selection to B and default template to executive-minimal - simulating "Career Memory changes after the application already exists"
  await selectResume(user, user.userId, "uploaded", b.resumeId);
  await setDefaultTemplate(user, "executive-minimal");

  const baseResolutionAfterChange = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId });
  check("D: base (non-application) resolution now correctly follows to B", baseResolutionAfterChange.status === "resolved" ? baseResolutionAfterChange.versionId : null, importB.body.versionId);

  const applicationBoundResolution = await resolveCanonicalResumeContext({ mode: "session", repos, client: user.client, userId: user.userId, applicationId: appRow!.id as string });
  check("D: application-bound resolution STILL returns A's versionId (frozen snapshot, unaffected by later selection/default changes)", applicationBoundResolution.status === "resolved" ? applicationBoundResolution.versionId : null, appliedVersionId);
  check("D: application-binding source", applicationBoundResolution.status === "resolved" ? applicationBoundResolution.source : null, "application-binding");

  // ==================== Scenario F: cross-user security - user B cannot see user A's selected resume/template preview ====================
  const userTwo = await makeTestUser(admin);
  const crossUserPreview = await previewHtml(userTwo, "modern-sidebar");
  check("F: a fresh second user (no canonical profile) gets a 404, never user A's content", crossUserPreview.status, 404);
  checkTrue("F: cross-user preview HTML does not leak user A's marker content", !containsMarker(crossUserPreview.html, "modern-sidebar"));

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
