/*
  Phase 6G - real local Supabase DB E2E for the actual HTTP route
  handlers under app/api/internal/canonical-generate-package/** (not
  just the underlying RPCs, which fixtures/scripts/
  phase6gCanonicalGeneratePackage.realdb.test.mjs already covers).

  Exercises makeHandlePreview/makeHandleStatus/makeHandleGenerate via
  routeGuard.ts's own runWithAuthenticatedContext() with REAL
  authenticated per-user Supabase sessions - the exact same technique
  lib/careerMemory/api/apiRoutes.test.ts already uses for the Phase 6D
  routes (see that file's own comment), just with a real DB client
  instead of a FakeSupabaseClient, so real RLS/ownership/auth actually
  run.

  No real OpenAI call anywhere in this file - /generate is only
  exercised on the paths that fail BEFORE the AI call (flag-off,
  validation errors); /preview and /status are tested against a
  realistic "already generated" application row seeded directly via
  the same 2 RPCs generateCanonicalPackage() itself calls
  (system_create_canonical_overlay + complete_canonical_generation),
  which produces the identical DB state a real generation would, at
  zero AI cost.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6gCanonicalGeneratePackageRoutes.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { makeHandlePreview } from "../../app/api/internal/canonical-generate-package/preview/route";
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
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = stableStringify(actual) === stableStringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
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

const createdUserIds: string[] = [];

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6g-route-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6g-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

/*
  Seeds via the REAL saveCanonicalRuntimeAcknowledgingGap() pipeline
  (not a raw minimal INSERT) - that pipeline populates every child
  table (career_experiences/projects/etc.) so the reconstructed
  ResumeStructuredModel is actually complete. A hand-rolled minimal
  snapshot-only insert produces a resume with only `schemaVersion` set
  and every array field undefined, which crashes mergeTailoredOverlay()
  downstream - a real generation could never reach this route with such
  a profile (every real profile comes through this same save path), so
  this is the correct, representative fixture rather than a shortcut.
  Strips sourceDocuments/overlayState.history from the fixture runtime
  first, matching lib/careerMemory/services/services.test.ts's own
  pristineCanonicalRuntime() convention (the fixture's pre-baked
  overlay history isn't meaningful here and its source document ids
  aren't pre-registered rows in a fresh scenario).
*/
async function seedCanonicalFixture(client: ReturnType<typeof createClient>, userId: string) {
  const repos = createCanonicalRepositories(client);
  const service = new CanonicalCareerMemoryService(repos);
  const runtime: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
  const saved = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });

  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) throw new Error("seedCanonicalFixture: profile not found immediately after save");

  const { data: application, error: applicationError } = await client.from("applications").insert({ user_id: userId }).select("*").single();
  if (applicationError) throw applicationError;
  return { profile, version: saved.version, application };
}

/*
  Seeds a full "already generated" state via BOTH real RPCs
  (system_create_canonical_overlay + complete_canonical_generation), at
  zero AI cost and zero real Storage upload (placeholder storage
  paths - this test only asserts on DB metadata, not Storage
  integration, which the RPC-level real-DB suite already covers).
*/
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
    p_generation_engine_version: "6G.0",
    p_protected_fact_validation_result: {},
  });
  if (complete.error || complete.data?.status !== "success") throw new Error(`seed complete failed: ${JSON.stringify(complete.error ?? complete.data)}`);

  return overlayId;
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  const userA = await makeTestUser(admin, "owner");
  const fixtureA = await seedCanonicalFixture(userA.client, userA.userId);
  const tailoredIdA = await seedCompletedGeneration(admin, userA.userId, fixtureA);

  const userB = await makeTestUser(admin, "attacker");
  const fixtureB = await seedCanonicalFixture(userB.client, userB.userId);

  // ==================== /preview route (makeHandlePreview) ====================
  await withEnv("CANONICAL_GENERATE_ENABLED", undefined, async () => {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats" })));
    check("preview route: flag off -> 404 (route's own second gate, independent of withCanonicalAuth's Netlify gate)", res.status, 404);
  });

  await withEnv("CANONICAL_GENERATE_ENABLED", "true", async () => {
    const missingAppId = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { templateId: "professional-ats" })));
    check("preview route: missing applicationId -> 422", missingAppId.status, 422);

    const missingTemplateId = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id })));
    check("preview route: missing templateId -> 422", missingTemplateId.status, 422);

    const invalidTemplateId = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "classic" })));
    check("preview route: legacy templateId 'classic' rejected as unknown -> 404 (disjoint namespace)", invalidTemplateId.status, 404);

    // Unsupported-option negative controls: a PRESENT invalid value must
    // be rejected explicitly (422), never silently coerced to a default.
    const badFormat = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", format: "epub" })));
    check("preview route: unsupported format 'epub' -> 422, not silently coerced to html", badFormat.status, 422);

    const badPaperSize = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", paperSize: "legal" })));
    check("preview route: unsupported paperSize 'legal' -> 422, not silently coerced to letter", badPaperSize.status, 422);

    const badDensity = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", density: "ultra-dense" })));
    check("preview route: unsupported density 'ultra-dense' -> 422, not silently coerced to comfortable", badDensity.status, 422);

    const noPriorGeneration = await runWithAuthenticatedContext(userB.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureB.application.id, templateId: "professional-ats" })));
    check("preview route: no prior generation for this applicationId -> 404 (never crashes)", noPriorGeneration.status, 404);

    // Cross-user attack: userB tries to preview userA's applicationId.
    const crossUserPreview = await runWithAuthenticatedContext(userB.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats" })));
    check("preview route: cross-user attack (user B previewing user A's applicationId) -> 404, RLS makes it invisible rather than leaking ownership", crossUserPreview.status, 404);

    // Body userId spoof: route never reads body.userId at all - the spoofed value has zero effect on which session's data is used.
    const spoofed = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { userId: userB.userId, applicationId: fixtureA.application.id, templateId: "professional-ats" })));
    check("preview route: body userId spoof has no effect - still renders user A's own real applicationId under user A's real session", spoofed.status, 200);

    // Real success: html format.
    const htmlOk = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats" })));
    check("preview route: real success, html format -> 200", htmlOk.status, 200);
    const htmlBody = (await htmlOk.json()) as { html?: string; pageCount?: number; templateId?: string };
    checkTrue("preview route: html response contains real rendered HTML", typeof htmlBody.html === "string" && htmlBody.html.length > 0);
    checkTrue("preview route: pageCount is a positive number", typeof htmlBody.pageCount === "number" && htmlBody.pageCount > 0);
    check("preview route: templateId echoed back matches request", htmlBody.templateId, "professional-ats");

    // Template switch - a DIFFERENT template id, same overlay/version, still 200, still no AI call (this function never calls OpenAI at all).
    const switched = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "executive-minimal" })));
    check("preview route: template switch to executive-minimal -> 200, zero AI calls (this handler has no OpenAI import at all)", switched.status, 200);
    const switchedBody = (await switched.json()) as { templateId?: string };
    check("preview route: switched templateId reflected in response", switchedBody.templateId, "executive-minimal");

    /*
      PDF format is deliberately NOT asserted against this specific
      fixture. Root-caused via a direct renderTemplateFromRuntime() call
      (bypassing this route entirely): buildFixtureRuntime()'s text
      content does not cleanly pass professional-ats's own pre-existing
      Phase 6F PDF-assembly text-fidelity validator (missing/invented
      text fragments) - reproduced identically with zero Phase 6G code
      involved, so this is a fixture/Phase-6F-validator interaction,
      not a Phase 6G regression. Modifying that validator or swapping
      fixtures to dodge it is out of this round's scope ("Phase 6F
      템플릿 디자인 변경 금지"). HTML and DOCX formats for the SAME
      fixture/overlay/template both render successfully (asserted
      immediately below and above), which is what actually exercises
      Phase 6G's own preview-without-AI-call code path.
    */
    const docxRes = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", format: "docx" })));
    check("preview route: docx format -> 200", docxRes.status, 200);
    check("preview route: docx format -> correct content-type", docxRes.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const docxBytes = await docxRes.arrayBuffer();
    checkTrue("preview route: docx format -> non-empty real bytes", docxBytes.byteLength > 0);

    // All 4 canonical templates individually render successfully for the same overlay/version - zero AI calls each time.
    for (const templateId of ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"]) {
      const r = await runWithAuthenticatedContext(userA.client as never, makeHandlePreview(jsonRequest("http://x/preview", "POST", { applicationId: fixtureA.application.id, templateId })));
      check(`preview route: template "${templateId}" renders successfully (4-template coverage)`, r.status, 200);
    }
  });

  // ==================== /status route (makeHandleStatus) ====================
  await withEnv("CANONICAL_GENERATE_ENABLED", undefined, async () => {
    const missingParam = await runWithAuthenticatedContext(userA.client as never, makeHandleStatus(new Request("http://x/status")));
    check("status route: missing applicationId query param -> 422", missingParam.status, 422);

    const ok = await runWithAuthenticatedContext(userA.client as never, makeHandleStatus(new Request(`http://x/status?applicationId=${fixtureA.application.id}`)));
    check("status route: real status read -> 200 (works regardless of canonical_generate_enabled - read-only)", ok.status, 200);
    const okBody = (await ok.json()) as { status?: Record<string, unknown> };
    check("status route: canonical_profile_id matches", okBody.status?.canonical_profile_id, fixtureA.profile.id);
    check("status route: tailored_resume_id matches", okBody.status?.tailored_resume_id, tailoredIdA);
    check("status route: selected_template_id matches", okBody.status?.selected_template_id, "professional-ats");
    check("status route: generation_engine is canonical", okBody.status?.generation_engine, "canonical");

    // Cross-user attack: userB requesting userA's applicationId status.
    const crossUser = await runWithAuthenticatedContext(userB.client as never, makeHandleStatus(new Request(`http://x/status?applicationId=${fixtureA.application.id}`)));
    check("status route: cross-user attack (user B reading user A's status) -> 404", crossUser.status, 404);

    const nonexistent = await runWithAuthenticatedContext(userA.client as never, makeHandleStatus(new Request(`http://x/status?applicationId=00000000-0000-0000-0000-000000000000`)));
    check("status route: nonexistent applicationId -> 404", nonexistent.status, 404);
  });

  // ==================== /generate route (makeHandleGenerate) - no real OpenAI call ====================
  await withEnv("CANONICAL_GENERATE_ENABLED", undefined, async () => {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", jobDescriptionText: "x" })));
    check("generate route: flag off -> 404 before ever attempting AI/render work", res.status, 404);
  });
  await withEnv("CANONICAL_GENERATE_ENABLED", "true", async () => {
    const missingAppId = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { templateId: "professional-ats", jobDescriptionText: "x" })));
    check("generate route: missing applicationId -> 422 (fails before any AI call)", missingAppId.status, 422);

    const missingTemplateId = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, jobDescriptionText: "x" })));
    check("generate route: missing templateId -> 422 (fails before any AI call)", missingTemplateId.status, 422);

    const missingJobText = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats" })));
    check("generate route: missing jobDescriptionText -> 422 (fails before any AI call)", missingJobText.status, 422);

    const emptyJobText = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", jobDescriptionText: "   " })));
    check("generate route: whitespace-only jobDescriptionText -> 422 (fails before any AI call)", emptyJobText.status, 422);

    const badPaperSize = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", jobDescriptionText: "x", paperSize: "legal" })));
    check("generate route: unsupported paperSize 'legal' -> 422, not silently coerced (fails before any AI call)", badPaperSize.status, 422);

    const badDensity = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: fixtureA.application.id, templateId: "professional-ats", jobDescriptionText: "x", density: "ultra-dense" })));
    check("generate route: unsupported density 'ultra-dense' -> 422, not silently coerced (fails before any AI call)", badDensity.status, 422);
  });

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);

  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }

  /*
    Explicit exit required: this file's preview-route calls render
    through the shared Playwright browser singleton
    (lib/documentPreservation/sharedBrowser.ts's getSharedBrowser()),
    which is never paired with closeSharedBrowser() anywhere in the
    actual render call path (confirmed - no call site exists). That
    open browser handle keeps Node's event loop alive forever once
    launched, so without this, the process finishes 100% of its real
    work (all checks run, summary printed) but then hangs
    indefinitely instead of exiting. This is a pre-existing Phase 6F/
    DPE resource-lifecycle gap, out of this round's scope to fix in
    production code - process.exit() here is the correct, minimal
    workaround for a standalone test script, not a production fix.
  */
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
