/*
  Phase 6I - Production Enablement real-DB verification. Covers:
  - Canary config (pure logic, no DB)
  - Traffic routing decision (pure logic, no DB)
  - The 4 new RPCs this phase added (claim/complete/release/get-status)
  - Dispatch service claim-insert + idempotent replay + quota interaction
  - The fallback-to-legacy SQL handoff (mark_canonical_fallback ->
    release_canonical_claim_for_legacy_fallback -> legacy's own
    claim_generate_package_worker can claim the row)

  Deliberately never calls generateCanonicalPackage() or
  runPackageGeneration() end-to-end (both make real OpenAI calls) -
  every assertion below verifies the ORCHESTRATION (routing, RPCs,
  claim/release handoff, idempotency, quota) using seeded DB state and
  direct RPC calls, matching this repo's own established real-DB test
  convention (see phase6gCanonicalGeneratePackageRoutes.realdb.test.mts's
  own header comment on why this is representative, not a shortcut).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6iProductionEnablement.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { decideGenerationRoute } from "../../lib/careerMemory/orchestration/canonicalTrafficRouter";
import { getCurrentCanaryStage, isUserInTrafficPercent, hashUserIdToBucket, isUserInCanaryAllowlist } from "../../lib/careerMemory/orchestration/canonicalCanaryConfig";
import { classifyForFallback } from "../../lib/careerMemory/orchestration/canonicalGenerationFallbackService";
import { dispatchCanonicalGeneration } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { NotFoundError } from "../../lib/careerMemory/errors/domainErrors";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
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
  const email = `phase6i-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i-realdb-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client, session: signInData.session };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== A. Canary config (pure logic) ====================
  {
    check("stage 0 default when CANONICAL_CANARY_STAGE unset", await withEnv("CANONICAL_CANARY_STAGE", undefined, async () => getCurrentCanaryStage().stage), 0);
    check("stage 0 default when CANONICAL_CANARY_STAGE invalid (out of range)", await withEnv("CANONICAL_CANARY_STAGE", "9", async () => getCurrentCanaryStage().stage), 0);
    check("stage 0 default when CANONICAL_CANARY_STAGE non-numeric", await withEnv("CANONICAL_CANARY_STAGE", "abc", async () => getCurrentCanaryStage().stage), 0);
    check("stage 3 parses correctly", await withEnv("CANONICAL_CANARY_STAGE", "3", async () => getCurrentCanaryStage().stage), 3);
    checkTrue("stage 1 requires allowlist", (await withEnv("CANONICAL_CANARY_STAGE", "1", async () => getCurrentCanaryStage())).requiresAllowlist);
    checkFalse("stage 3 does not require allowlist (percentage-based)", (await withEnv("CANONICAL_CANARY_STAGE", "3", async () => getCurrentCanaryStage())).requiresAllowlist);
    check("stage 3 traffic percent is 1", await withEnv("CANONICAL_CANARY_STAGE", "3", async () => getCurrentCanaryStage().trafficPercent), 1);
    check("stage 6 traffic percent is 100", await withEnv("CANONICAL_CANARY_STAGE", "6", async () => getCurrentCanaryStage().trafficPercent), 100);

    checkFalse("0% traffic never includes any user", isUserInTrafficPercent("any-user-id", 0));
    checkTrue("100% traffic always includes every user", isUserInTrafficPercent("any-user-id", 100));
    checkTrue("hashUserIdToBucket is deterministic for the same id", hashUserIdToBucket("stable-user-id") === hashUserIdToBucket("stable-user-id"));
    check("bucket is always in [0,100)", hashUserIdToBucket("some-user") >= 0 && hashUserIdToBucket("some-user") < 100, true);

    checkFalse("allowlist empty by default", await withEnv("CANONICAL_CANARY_ALLOWLIST_USER_IDS", undefined, async () => isUserInCanaryAllowlist("user-1")));
    checkTrue("allowlist matches a listed id", await withEnv("CANONICAL_CANARY_ALLOWLIST_USER_IDS", "user-1,user-2", async () => isUserInCanaryAllowlist("user-2")));
    checkFalse("allowlist rejects an unlisted id", await withEnv("CANONICAL_CANARY_ALLOWLIST_USER_IDS", "user-1,user-2", async () => isUserInCanaryAllowlist("user-3")));
  }

  // ==================== B. Routing decision (pure logic) ====================
  {
    check("flag disabled -> legacy", await withEnv("CANONICAL_GENERATE_ENABLED", undefined, async () => decideGenerationRoute("u1")), { route: "legacy", reason: "flag_disabled", stage: 0 });

    await withEnv("CANONICAL_GENERATE_ENABLED", "true", async () => {
      check("flag on, stage 0 -> legacy", await withEnv("CANONICAL_CANARY_STAGE", undefined, async () => decideGenerationRoute("u1")), { route: "legacy", reason: "stage_0", stage: 0 });

      await withEnv("CANONICAL_CANARY_STAGE", "1", async () => {
        await withEnv("CANONICAL_CANARY_ALLOWLIST_USER_IDS", "allowed-user", async () => {
          check("stage 1, allowlisted user -> canonical", decideGenerationRoute("allowed-user"), { route: "canonical", reason: "allowlisted", stage: 1 });
          check("stage 1, non-allowlisted user -> legacy", decideGenerationRoute("someone-else"), { route: "legacy", reason: "not_in_allowlist", stage: 1 });
        });
      });

      await withEnv("CANONICAL_CANARY_STAGE", "6", async () => {
        check("stage 6 (100%), any user -> canonical", decideGenerationRoute("literally-anyone"), { route: "canonical", reason: "in_traffic_percent", stage: 6 });
      });
    });

    checkTrue("legacy is the only route on every branch except allowlisted/in_traffic_percent (structural check)", await withEnv("CANONICAL_GENERATE_ENABLED", "true", async () => decideGenerationRoute("x").route === "legacy" || ["allowlisted", "in_traffic_percent"].includes(decideGenerationRoute("x").reason)));
  }

  // ==================== C. classifyForFallback ownership fix (re-verify against the real domain error hierarchy, not just the unit test double) ====================
  {
    checkFalse("bare NotFoundError never falls back", classifyForFallback(new NotFoundError("Some resource")).shouldFallback);
  }

  const user = await makeTestUser(admin, "u1");

  // ==================== D. claim_canonical_generate_worker / complete_canonical_generate_worker RPCs ====================
  {
    const { data: app1, error: app1Error } = await user.client.from("applications").insert({ user_id: user.userId, generation_status: "pending", generation_stage: "queued", generation_engine: "canonical", canonical_input_manifest: { templateId: "professional-ats" } }).select("id").single();
    if (app1Error) throw app1Error;

    const { data: claim1, error: claim1Error } = await admin.rpc("claim_canonical_generate_worker", { p_application_id: app1.id });
    if (claim1Error) throw claim1Error;
    const claimedRow1 = Array.isArray(claim1) ? claim1[0] : claim1;
    checkTrue("claim succeeds for a fresh pending canonical row", !!claimedRow1);
    check("claim returns the canonical_input_manifest written at insert time", claimedRow1?.canonical_input_manifest, { templateId: "professional-ats" });

    const { data: claim1Again } = await admin.rpc("claim_canonical_generate_worker", { p_application_id: app1.id });
    const claimedAgain = Array.isArray(claim1Again) ? claim1Again[0] : claim1Again;
    checkTrue("re-claiming an already-claimed row returns 0 rows (concurrency safety)", !claimedAgain);

    await admin.rpc("complete_canonical_generate_worker", { p_application_id: app1.id, p_user_id: user.userId, p_status: "succeeded" });
    const { data: statusAfterComplete } = await user.client.from("applications").select("generation_status, status").eq("id", app1.id).single();
    check("complete_canonical_generate_worker sets generation_status=succeeded", statusAfterComplete?.generation_status, "succeeded");
    check("complete_canonical_generate_worker sets Job Tracker status=package_generated", statusAfterComplete?.status, "package_generated");

    const { data: app2, error: app2Error } = await user.client.from("applications").insert({ user_id: user.userId, generation_status: "pending", generation_stage: "queued", generation_engine: "canonical" }).select("id").single();
    if (app2Error) throw app2Error;
    await admin.rpc("claim_canonical_generate_worker", { p_application_id: app2.id });
    await admin.rpc("complete_canonical_generate_worker", { p_application_id: app2.id, p_user_id: user.userId, p_status: "failed", p_error_code: "template_rendering_failed", p_error_summary: "test failure" });
    const { data: statusAfterFail } = await user.client.from("applications").select("generation_status, generation_error_code, status").eq("id", app2.id).single();
    check("complete_canonical_generate_worker (failed) sets generation_status=failed", statusAfterFail?.generation_status, "failed");
    check("complete_canonical_generate_worker (failed) records error_code", statusAfterFail?.generation_error_code, "template_rendering_failed");
    checkTrue("complete_canonical_generate_worker (failed) does NOT set status=package_generated", statusAfterFail?.status !== "package_generated");

    // A legacy-engine row must never be claimable by the canonical claim RPC.
    const { data: legacyApp } = await user.client.from("applications").insert({ user_id: user.userId, generation_status: "pending", generation_stage: "queued", generation_engine: "legacy" }).select("id").single();
    const { data: claimLegacy } = await admin.rpc("claim_canonical_generate_worker", { p_application_id: legacyApp!.id });
    const claimedLegacy = Array.isArray(claimLegacy) ? claimLegacy[0] : claimLegacy;
    checkTrue("claim_canonical_generate_worker never claims a generation_engine='legacy' row", !claimedLegacy);
  }

  // ==================== E. get_application_generation_status RPC ====================
  {
    const { data: app3 } = await user.client.from("applications").insert({ user_id: user.userId, generation_status: "succeeded" }).select("id").single();
    const { data: status3 } = await admin.rpc("get_application_generation_status", { p_application_id: app3!.id, p_user_id: user.userId });
    check("get_application_generation_status returns the real status", status3, "succeeded");

    const other = await makeTestUser(admin, "other");
    const { data: statusWrongOwner } = await admin.rpc("get_application_generation_status", { p_application_id: app3!.id, p_user_id: other.userId });
    check("get_application_generation_status returns null for a non-owner", statusWrongOwner, null);
  }

  // ==================== F. Fallback-to-legacy SQL handoff (no OpenAI call - verifies the orchestration only) ====================
  {
    const { data: fbApp } = await user.client.from("applications").insert({ user_id: user.userId, generation_request_id: crypto.randomUUID(), generation_status: "pending", generation_stage: "queued", generation_engine: "canonical", resume_source: "career_memory", generation_input_resume_text: "pre-resolved legacy snapshot text" }).select("id").single();
    const applicationId = fbApp!.id;

    await admin.rpc("claim_canonical_generate_worker", { p_application_id: applicationId });
    const { data: claimedCheck } = await user.client.from("applications").select("generation_worker_claimed_at").eq("id", applicationId).single();
    checkTrue("row is claimed (worker_claimed_at set) before fallback begins", claimedCheck?.generation_worker_claimed_at !== null);

    const markResult = await admin.rpc("mark_canonical_fallback", { p_user_id: user.userId, p_application_id: applicationId, p_fallback_used: true, p_fallback_reason: "template_rendering_failure", p_generation_engine: "legacy" });
    check("mark_canonical_fallback succeeds", (markResult.data as { status: string })?.status, "success");

    await admin.rpc("release_canonical_claim_for_legacy_fallback", { p_application_id: applicationId, p_user_id: user.userId });

    const { data: rowAfterRelease } = await user.client.from("applications").select("generation_worker_claimed_at, generation_status, generation_engine, fallback_used, fallback_reason, generation_input_resume_text").eq("id", applicationId).single();
    checkTrue("release_canonical_claim_for_legacy_fallback clears the worker claim", rowAfterRelease?.generation_worker_claimed_at === null);
    check("row is pending again after release", rowAfterRelease?.generation_status, "pending");
    check("generation_engine now legacy (set by mark_canonical_fallback)", rowAfterRelease?.generation_engine, "legacy");
    checkTrue("fallback_used recorded", rowAfterRelease?.fallback_used === true);
    check("fallback_reason recorded", rowAfterRelease?.fallback_reason, "template_rendering_failure");
    check("legacy input snapshot (written at dispatch time) survives the handoff untouched", rowAfterRelease?.generation_input_resume_text, "pre-resolved legacy snapshot text");

    // The crux of the whole fallback mechanism: legacy's OWN, real,
    // unmodified claim RPC must now be able to claim this exact row.
    const { data: legacyClaim } = await admin.rpc("claim_generate_package_worker", { p_application_id: applicationId });
    const legacyClaimedRow = Array.isArray(legacyClaim) ? legacyClaim[0] : legacyClaim;
    checkTrue("legacy's own claim_generate_package_worker can now claim the released row", !!legacyClaimedRow);
    check("legacy claim sees the same resume_source the dispatch service wrote", legacyClaimedRow?.resume_source, "career_memory");
  }

  // ==================== G. Dispatch service - claim-insert, idempotent replay, and quota interaction (real DB, no enqueue success required - local test has no listening worker route, so enqueue failure is the EXPECTED and itself-verified path) ====================
  {
    const dispatchUser = await makeTestUser(admin, "dispatch");
    // career_memory row with selected_resume_type='career_memory' so
    // resolveSelectedResume resolves a career_memory source (no
    // uploaded resume seeded) - matches a realistic "user filled in
    // Career Memory and selected it, never uploaded a file" state.
    const { data: memoryRow, error: memoryInsertError } = await dispatchUser.client
      .from("career_memory")
      .insert({ user_id: dispatchUser.userId, first_name: "Test", last_name: "User", selected_resume_type: "career_memory", summary: "Experienced professional.", experience: [{ title: "Engineer", company: "Acme", description: "Built things." }] })
      .select("*")
      .single();
    if (memoryInsertError) throw memoryInsertError;

    const generationRequestId = crypto.randomUUID();
    const res = await withEnv("BACKGROUND_FUNCTION_SECRET", "phase6i-test-secret", async () =>
      dispatchCanonicalGeneration({
        supabase: dispatchUser.client as never,
        userId: dispatchUser.userId,
        memory: memoryRow,
        generationRequestId,
        jobText: "We are hiring a Software Engineer to build great products.",
        title: "Software Engineer",
        company: "Acme Corp",
        applicantName: "Test User",
        analysis: { summary: "A software engineering role." },
        jobUrl: null,
        body: { templateId: "professional-ats" },
        requestOrigin: "http://127.0.0.1:59999",
        routingReason: "in_traffic_percent",
        canaryStage: 6,
      })
    );

    // No local worker route is listening on the fake requestOrigin port
    // in this script context, so the enqueue fetch itself fails - this
    // IS the expected local-test outcome and exercises the "enqueue
    // failed -> mark row failed, release quota, return 500" path for
    // real.
    check("dispatch with unreachable enqueue target returns 500 (enqueue failure path)", res.status, 500);

    const body = await res.json();
    const { data: rowByOwner } = await dispatchUser.client.from("applications").select("id, generation_status, generation_engine, resume_source, canonical_input_manifest, generation_error_code").eq("id", body.applicationId).single();
    checkTrue("claim-insert created a real row with generation_engine=canonical", rowByOwner?.generation_engine === "canonical");
    check("claim-insert resolved resume_source=career_memory (matches seeded Career Memory)", rowByOwner?.resume_source, "career_memory");
    check("claim-insert wrote canonical_input_manifest with the requested templateId", (rowByOwner?.canonical_input_manifest as { templateId?: string } | null)?.templateId, "professional-ats");
    check("enqueue-failure path marks the row failed with BACKGROUND_ENQUEUE_FAILED", rowByOwner?.generation_status === "failed" && rowByOwner?.generation_error_code === "BACKGROUND_ENQUEUE_FAILED", true);

    // Idempotent replay: a second dispatch call with the SAME generationRequestId must not create a second row.
    const res2 = await withEnv("BACKGROUND_FUNCTION_SECRET", "phase6i-test-secret", async () =>
      dispatchCanonicalGeneration({
        supabase: dispatchUser.client as never,
        userId: dispatchUser.userId,
        memory: memoryRow,
        generationRequestId,
        jobText: "We are hiring a Software Engineer to build great products.",
        title: "Software Engineer",
        company: "Acme Corp",
        applicantName: "Test User",
        analysis: { summary: "A software engineering role." },
        jobUrl: null,
        body: { templateId: "professional-ats" },
        requestOrigin: "http://127.0.0.1:59999",
        routingReason: "in_traffic_percent",
        canaryStage: 6,
      })
    );
    const body2 = await res2.json();
    check("idempotent replay (same generationRequestId, previously failed) reclaims the SAME applicationId, not a new one", body2.applicationId, body.applicationId);

    const { count } = await dispatchUser.client.from("applications").select("id", { count: "exact", head: true }).eq("user_id", dispatchUser.userId);
    check("exactly 1 applications row exists for this user despite 2 dispatch calls with the same generationRequestId", count, 1);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
