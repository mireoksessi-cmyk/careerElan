/*
  Phase 6I.2 - Canonical Template Lifecycle Integration real-DB
  verification. Covers spec section 20's test matrix against the
  actual services/routes this phase built:
  - canonicalTemplateGate.ts (checkTemplateGate/requireTemplateSelected)
  - canonicalTemplatePreferenceService.ts + its GET/PUT route
  - applicationTemplateResolver.ts + its resolve-template route
  - applicationTemplateSwitchService.ts + its PUT route (per-application
    override, "set as default")
  - the /generate route's own inherit-from-profile-default + hard-gate
    wiring (validated up to, but never past, the point where it would
    make a real OpenAI call - no real AI call anywhere in this file)
  - complete_canonical_generation's existing snapshot of
    applications.selected_template_id (pre-existing RPC behavior,
    verified here as a real dependency of section 10/11's contract)

  Uses runWithAuthenticatedContext() with REAL per-user Supabase
  sessions (same technique as phase6gCanonicalGeneratePackageRoutes.
  realdb.test.mts) so real RLS/ownership/auth actually run - not a
  FakeSupabaseClient stand-in.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i2CanonicalTemplateLifecycle.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { runWithAuthenticatedContext } from "../../lib/careerMemory/api/routeGuard";
import { handleGetTemplatePreference, makeHandlePutTemplatePreference } from "../../app/api/internal/canonical-career-memory/template-preference/route";
import { makeHandleResolveTemplate } from "../../app/api/internal/canonical-career-memory/resolve-template/route";
import { makeHandleResumePreview } from "../../app/api/internal/canonical-career-memory/resume-preview/route";
import { makeHandlePutApplicationTemplate } from "../../app/api/internal/canonical-generate-package/template/route";
import { PAPER_DIMENSIONS } from "../../lib/resumeTemplates/shared/paperSizes";
import { makeHandleGenerate } from "../../app/api/internal/canonical-generate-package/generate/route";
import { checkTemplateGate, requireTemplateSelected } from "../../lib/careerMemory/services/canonicalTemplateGate";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { buildFixtureRuntime } from "../../lib/careerMemory/persistence/testFixtures";
import type { CanonicalResumeRuntime } from "../../lib/careerMemory/runtime/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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

async function makeTestUser(admin: ReturnType<typeof createClient>, emailPrefix: string) {
  const email = `phase6i2-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i2-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

// Same seeding convention as phase6gCanonicalGeneratePackageRoutes.realdb.test.mts's
// own seedCanonicalFixture - the real save pipeline, not a raw minimal insert.
async function seedCanonicalFixture(client: ReturnType<typeof createClient>, userId: string) {
  const repos = createCanonicalRepositories(client);
  const service = new CanonicalCareerMemoryService(repos);
  const runtime: CanonicalResumeRuntime = { ...buildFixtureRuntime(), sourceDocuments: [], overlayState: { history: [] } };
  const saved = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) throw new Error("seedCanonicalFixture: profile not found immediately after save");
  const { data: application, error: applicationError } = await client.from("applications").insert({ user_id: userId }).select("*").single();
  if (applicationError) throw applicationError;
  return { profile, version: saved.version, application, repos };
}

async function seedCompletedGeneration(admin: ReturnType<typeof createClient>, userId: string, fixture: Awaited<ReturnType<typeof seedCanonicalFixture>>, templateId: string) {
  const overlay = await admin.rpc("system_create_canonical_overlay", {
    p_user_id: userId,
    p_profile_id: fixture.profile.id,
    p_resume_version_id: fixture.version.id,
    p_application_id: fixture.application.id,
    p_template_id: templateId,
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
    p_template_id: templateId,
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
function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  const userA = await makeTestUser(admin, "owner");
  const fixtureA = await seedCanonicalFixture(userA.client, userA.userId);

  const userB = await makeTestUser(admin, "attacker");
  await seedCanonicalFixture(userB.client, userB.userId);

  const legacyUser = await makeTestUser(admin, "legacy-only");

  // ==================== 1-4. Valid template ids, idempotent, persistence ====================
  for (const templateId of ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"]) {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId })));
    check(`PUT template-preference accepts valid id "${templateId}"`, res.status, 200);
  }
  {
    const res = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const body = await res.json();
    check("GET template-preference reflects last-written value (creative-timeline)", body.defaultTemplateId, "creative-timeline");
  }
  {
    // idempotent same-value re-write
    const res1 = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "creative-timeline" })));
    const res2 = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "creative-timeline" })));
    check("idempotent same-template PUT #1 -> 200", res1.status, 200);
    check("idempotent same-template PUT #2 -> 200 (no-op, not an error)", res2.status, 200);
  }

  // ==================== 5. Invalid template id -> 422 ====================
  {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "not-a-real-template" })));
    check("PUT template-preference invalid id -> 422", res.status, 422);
    const body = await res.json();
    check("invalid id error code is INVALID_TEMPLATE_ID", body?.error?.code, "INVALID_TEMPLATE_ID");
  }

  // ==================== 6. Malformed request ====================
  {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", {})));
    check("PUT template-preference missing templateId -> 422 (ValidationError)", res.status, 422);
  }

  // ==================== 7. No canonical profile (legacy-only user) ====================
  {
    const res = await runWithAuthenticatedContext(legacyUser.client as never, handleGetTemplatePreference);
    const body = await res.json();
    check("GET template-preference for legacy-only user -> defaultTemplateId null (not an error)", body.defaultTemplateId, null);

    const putRes = await runWithAuthenticatedContext(legacyUser.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "professional-ats" })));
    check("PUT template-preference for legacy-only user -> 404 CANONICAL_PROFILE_UNAVAILABLE", putRes.status, 404);
    const putBody = await putRes.json();
    check("legacy-only PUT error code", putBody?.error?.code, "CANONICAL_PROFILE_UNAVAILABLE");
  }

  // ==================== 8. Cross-user isolation (RLS) ====================
  {
    const resA = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const bodyA = await resA.json();
    checkTrue("userA's own preference is NOT userB's (RLS scoping sanity)", bodyA.defaultTemplateId === "creative-timeline");

    const resB = await runWithAuthenticatedContext(userB.client as never, handleGetTemplatePreference);
    const bodyB = await resB.json();
    check("userB (never set a preference) still sees their own null, not userA's value", bodyB.defaultTemplateId, null);
  }

  // ==================== 9. checkTemplateGate / requireTemplateSelected states ====================
  {
    const reposB = createCanonicalRepositories(userB.client as never);
    const gateB = await checkTemplateGate(reposB, userB.userId);
    check("checkTemplateGate: profile exists, no default -> selection-required", gateB.status, "selection-required");

    const reposLegacy = createCanonicalRepositories(legacyUser.client as never);
    const gateLegacy = await checkTemplateGate(reposLegacy, legacyUser.userId);
    check("checkTemplateGate: no profile at all -> not-applicable", gateLegacy.status, "not-applicable");

    let threw = false;
    try {
      await requireTemplateSelected(reposB, userB.userId);
    } catch (e: any) {
      threw = e?.code === "TEMPLATE_SELECTION_REQUIRED";
    }
    checkTrue("requireTemplateSelected throws TEMPLATE_SELECTION_REQUIRED for profile with NULL default", threw);

    const legacyResult = await requireTemplateSelected(reposLegacy, legacyUser.userId);
    check("requireTemplateSelected returns null (not an error) for legacy-only user", legacyResult, null);
  }

  // ==================== 10. resolve-template route: legacy / selection-required / canonical ====================
  {
    const resLegacy = await runWithAuthenticatedContext(legacyUser.client as never, makeHandleResolveTemplate(getRequest("http://x/resolve-template")));
    const bodyLegacy = await resLegacy.json();
    check("resolve-template: legacy-only user -> kind legacy", bodyLegacy.kind, "legacy");

    const resB = await runWithAuthenticatedContext(userB.client as never, makeHandleResolveTemplate(getRequest("http://x/resolve-template")));
    const bodyB = await resB.json();
    check("resolve-template: canonical profile, no default -> kind selection-required", bodyB.kind, "selection-required");

    const resA = await runWithAuthenticatedContext(userA.client as never, makeHandleResolveTemplate(getRequest("http://x/resolve-template")));
    const bodyA = await resA.json();
    check("resolve-template: canonical profile with default -> kind canonical", bodyA.kind, "canonical");
    check("resolve-template: canonical -> source profile-default (no applicationId given)", bodyA.source, "profile-default");
  }

  // ==================== 11. resume-preview (untailored) route - full HTML ====================
  // Phase 6I.3: format=html now returns RAW text/html, not JSON - this is
  // the proven root cause of the broken 4-template picker thumbnails
  // (every current caller embeds this URL as <iframe src>, which needs
  // an actual HTML document, not a JSON envelope the browser would
  // render with its own JSON viewer instead of the resume).
  {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandleResumePreview(getRequest("http://x/resume-preview?templateId=creative-timeline&format=html")));
    check("resume-preview: html format for userA (has profile+version) -> 200", res.status, 200);
    checkTrue("resume-preview: html format Content-Type is text/html, not application/json", (res.headers.get("content-type") || "").includes("text/html"));
    const html = await res.text();
    checkTrue("resume-preview: full html is real, non-empty raw HTML (starts with doctype)", html.trim().toLowerCase().startsWith("<!doctype html>"));
    checkTrue("resume-preview: full html is NOT wrapped in a JSON envelope (no leading '{')", !html.trim().startsWith("{"));

    const resInvalid = await runWithAuthenticatedContext(userA.client as never, makeHandleResumePreview(getRequest("http://x/resume-preview?templateId=not-real&format=html")));
    check("resume-preview: invalid templateId -> 404 (unknown-template-id)", resInvalid.status, 404);

    const resLegacy = await runWithAuthenticatedContext(legacyUser.client as never, makeHandleResumePreview(getRequest("http://x/resume-preview?templateId=professional-ats&format=html")));
    check("resume-preview: legacy-only user (no profile) -> 404 CANONICAL_PROFILE_UNAVAILABLE", resLegacy.status, 404);

    const resBadVariant = await runWithAuthenticatedContext(userA.client as never, makeHandleResumePreview(getRequest("http://x/resume-preview?templateId=professional-ats&format=html&variant=bogus")));
    check("resume-preview: invalid variant param -> 422", resBadVariant.status, 422);
  }

  // ==================== 11b. resume-preview thumbnail variant (Phase 6I.3 - the actual bug fix under test) ====================
  {
    const templateIds = ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"];
    const thumbnailHtml: Record<string, string> = {};
    for (const templateId of templateIds) {
      const res = await runWithAuthenticatedContext(userA.client as never, makeHandleResumePreview(getRequest(`http://x/resume-preview?templateId=${templateId}&format=html&variant=thumbnail`)));
      check(`thumbnail ${templateId}: 200`, res.status, 200);
      checkTrue(`thumbnail ${templateId}: Content-Type text/html`, (res.headers.get("content-type") || "").includes("text/html"));
      const html = await res.text();
      thumbnailHtml[templateId] = html;
      checkTrue(`thumbnail ${templateId}: non-empty HTML`, html.length > 0);
      checkTrue(`thumbnail ${templateId}: explicit light color-scheme guard present (dark-mode isolation)`, html.includes("color-scheme"));
      checkTrue(`thumbnail ${templateId}: explicit white background guard present (no black-lower-half regression)`, html.includes("background:#ffffff"));
      checkTrue(`thumbnail ${templateId}: not a bare JSON envelope`, !html.trim().startsWith("{"));

      const $ = cheerio.load(html);
      const bodyChildren = $("body").children();
      check(`thumbnail ${templateId}: body has exactly 1 top-level element (page-1-only, no multi-page bleed)`, bodyChildren.length, 1);
    }
    checkTrue("thumbnails: professional-ats and modern-sidebar are structurally distinct (real per-template rendering)", thumbnailHtml["professional-ats"] !== thumbnailHtml["modern-sidebar"]);
    checkTrue("thumbnails: all 4 templates produce mutually distinct HTML (no shared fallback/placeholder reused across templates)", new Set(Object.values(thumbnailHtml)).size === 4);
  }

  // ==================== 11c. thumbnail deterministic scale formula (pure math, mirrors CanonicalTemplatePicker.tsx's own constants) ====================
  {
    const pageWidthPx = PAPER_DIMENSIONS.letter.widthPx;
    const pageHeightPx = PAPER_DIMENSIONS.letter.heightPx;
    const thumbnailWidthPx = 280;
    const thumbnailHeightPx = Math.round(thumbnailWidthPx * (pageHeightPx / pageWidthPx));
    const scale = Math.min(thumbnailWidthPx / pageWidthPx, thumbnailHeightPx / pageHeightPx);
    checkTrue("thumbnail scale is > 0", scale > 0);
    checkTrue("thumbnail scale is <= 1 (never upscaled)", scale <= 1);
    const scaledWidth = pageWidthPx * scale;
    const scaledHeight = pageHeightPx * scale;
    checkTrue("scaled page width fits within the thumbnail box width (no horizontal clipping)", scaledWidth <= thumbnailWidthPx + 0.5);
    checkTrue("scaled page height fits within the thumbnail box height (no vertical clipping)", scaledHeight <= thumbnailHeightPx + 0.5);
    checkTrue("aspect ratio preserved (scaled box matches the thumbnail box almost exactly, no letterboxing waste)", Math.abs(scaledWidth - thumbnailWidthPx) < 1 && Math.abs(scaledHeight - thumbnailHeightPx) < 1);
  }

  // ==================== 12-14. /generate inherits profile default + hard gate (no real OpenAI call) ====================
  await (async () => {
    const priorFlag = process.env.CANONICAL_GENERATE_ENABLED;
    process.env.CANONICAL_GENERATE_ENABLED = "true";
    try {
      // userB: profile exists, no default -> must be blocked by the hard
      // gate BEFORE any AI call, when templateId is omitted (inherits).
      const resB = await runWithAuthenticatedContext(userB.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: "00000000-0000-0000-0000-000000000000", jobDescriptionText: "irrelevant - must fail before reaching this" })));
      check("generate: userB (no default, no explicit templateId) -> 409 TEMPLATE_SELECTION_REQUIRED (no AI call reached)", resB.status, 409);
      const bodyB = await resB.json();
      check("generate: userB error code", bodyB?.error?.code, "TEMPLATE_SELECTION_REQUIRED");

      // userA: has a default (creative-timeline) -> passes the gate,
      // fails on the NEXT validation step instead (missing real
      // applicationId / bad jobDescriptionText) - proves it inherited
      // the template and got PAST the gate without ever reaching OpenAI.
      const resA = await runWithAuthenticatedContext(userA.client as never, makeHandleGenerate(jsonRequest("http://x/generate", "POST", { applicationId: "00000000-0000-0000-0000-000000000000" })));
      checkTrue("generate: userA (has default) -> gate passes, fails on next validation (jobDescriptionText), NOT 409", resA.status !== 409);
    } finally {
      if (priorFlag === undefined) delete process.env.CANONICAL_GENERATE_ENABLED;
      else process.env.CANONICAL_GENERATE_ENABLED = priorFlag;
    }
  })();

  // ==================== 15-19. Application-level override + Set as Default ====================
  const genA = await seedCompletedGeneration(admin, userA.userId, fixtureA, "professional-ats");
  checkTrue("seeded completed generation for userA (overlay id present)", typeof genA === "string" && genA.length > 0);
  {
    const resolveRes = await runWithAuthenticatedContext(userA.client as never, makeHandleResolveTemplate(getRequest(`http://x/resolve-template?applicationId=${fixtureA.application.id}`)));
    const resolveBody = await resolveRes.json();
    check("resolve-template with applicationId: complete_canonical_generation already snapshotted selected_template_id -> application-override", resolveBody.source, "application-override");
    check("resolve-template with applicationId: matches the template passed at generation time", resolveBody.templateId, "professional-ats");

    // Switch ONLY this application to a different template (spec section 11/17).
    const switchRes = await runWithAuthenticatedContext(userA.client as never, makeHandlePutApplicationTemplate(jsonRequest("http://x/template", "PUT", { applicationId: fixtureA.application.id, templateId: "creative-timeline" })));
    check("application template switch -> 200", switchRes.status, 200);
    const switchBody = await switchRes.json();
    check("application template switch: selectedTemplateId updated", switchBody.selectedTemplateId, "creative-timeline");
    check("application template switch WITHOUT setAsDefault: profileDefaultUpdated is false", switchBody.profileDefaultUpdated, false);

    const profileAfterSwitch = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const profileAfterSwitchBody = await profileAfterSwitch.json();
    check("profile default UNCHANGED after an application-only switch (still creative-timeline from step 1-4, i.e. not clobbered)", profileAfterSwitchBody.defaultTemplateId, "creative-timeline");

    // Now flip the profile default to something else, then switch this
    // application WITH setAsDefault:true, and confirm the profile moves.
    await runWithAuthenticatedContext(userA.client as never, makeHandlePutTemplatePreference(jsonRequest("http://x/template-preference", "PUT", { templateId: "executive-minimal" })));
    const switchWithDefaultRes = await runWithAuthenticatedContext(userA.client as never, makeHandlePutApplicationTemplate(jsonRequest("http://x/template", "PUT", { applicationId: fixtureA.application.id, templateId: "modern-sidebar", setAsDefault: true })));
    const switchWithDefaultBody = await switchWithDefaultRes.json();
    check("application switch with setAsDefault:true -> profileDefaultUpdated true", switchWithDefaultBody.profileDefaultUpdated, true);

    const profileAfterSetDefault = await runWithAuthenticatedContext(userA.client as never, handleGetTemplatePreference);
    const profileAfterSetDefaultBody = await profileAfterSetDefault.json();
    check("explicit Set as Default DOES update the profile default", profileAfterSetDefaultBody.defaultTemplateId, "modern-sidebar");

    const resolveAfter = await runWithAuthenticatedContext(userA.client as never, makeHandleResolveTemplate(getRequest(`http://x/resolve-template?applicationId=${fixtureA.application.id}`)));
    const resolveAfterBody = await resolveAfter.json();
    check("resolve-template for this application now resolves the application override (modern-sidebar), priority 1 over profile default", resolveAfterBody.templateId, "modern-sidebar");
    check("resolve-template source is still application-override (priority 1 wins even though it now equals the new default)", resolveAfterBody.source, "application-override");
  }

  // ==================== 20. Cross-user attack: userB cannot switch userA's application ====================
  {
    const res = await runWithAuthenticatedContext(userB.client as never, makeHandlePutApplicationTemplate(jsonRequest("http://x/template", "PUT", { applicationId: fixtureA.application.id, templateId: "creative-timeline" })));
    checkTrue("userB cannot switch userA's application template -> not 200", res.status !== 200);
  }

  // ==================== 21. Invalid template id on application switch -> 422 ====================
  {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePutApplicationTemplate(jsonRequest("http://x/template", "PUT", { applicationId: fixtureA.application.id, templateId: "not-real" })));
    check("application switch invalid template id -> 422", res.status, 422);
  }

  // ==================== 22. Stale/unknown applicationId on switch -> not found ====================
  {
    const res = await runWithAuthenticatedContext(userA.client as never, makeHandlePutApplicationTemplate(jsonRequest("http://x/template", "PUT", { applicationId: "00000000-0000-0000-0000-000000000000", templateId: "creative-timeline" })));
    checkTrue("switch on a nonexistent applicationId -> not 200", res.status !== 200);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
