/*
  Admin User Controls Phase 2 - real local-DB test. Uses only throwaway
  local test users created and destroyed within this run - refuses to
  run at all unless NEXT_PUBLIC_SUPABASE_URL points at localhost, so
  this can never touch a Production database. No real (pre-existing)
  user account is ever suspended, deleted, or has its session touched -
  every user this test mutates is created by this test, in this run.
*/
import { createClient } from "@supabase/supabase-js";
import { hasPermission, ADMIN_ROLES } from "./permissions";
import {
  suspendUser,
  reactivateUser,
  changeUserPlan,
  changeUserQuotaOverride,
  deleteUserByAdmin,
} from "./queries/userControls";
import type { AdminContext } from "./auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  console.error(`REFUSING TO RUN: NEXT_PUBLIC_SUPABASE_URL is not local (${SUPABASE_URL}). This test never runs against Production.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.log(`FAIL: ${label}`, detail ?? "");
  }
}

async function createTestUser(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "Test-Password-1234!",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createTestUser failed: ${error?.message}`);
  return data.user.id;
}

async function main() {
  console.log("=== Admin User Controls Phase 2 - real local-DB test ===");

  // ---------------------------------------------------------------
  // Part 1: pure permission-matrix tests (no DB) - MARKETING denial,
  // unauthorized-role denial, authorized-role (OWNER/ADMIN) success.
  // ---------------------------------------------------------------
  check("OWNER has admin.users.manage", hasPermission("OWNER", "admin.users.manage") === true);
  check("ADMIN has admin.users.manage", hasPermission("ADMIN", "admin.users.manage") === true);
  check("MARKETING does NOT have admin.users.manage", hasPermission("MARKETING", "admin.users.manage") === false);
  check("SUPPORT does NOT have admin.users.manage", hasPermission("SUPPORT", "admin.users.manage") === false);
  check("OPERATIONS does NOT have admin.users.manage", hasPermission("OPERATIONS", "admin.users.manage") === false);
  check("ANALYST does NOT have admin.users.manage", hasPermission("ANALYST", "admin.users.manage") === false);
  check("VIEWER does NOT have admin.users.manage", hasPermission("VIEWER", "admin.users.manage") === false);
  check(
    "Exactly OWNER+ADMIN have admin.users.manage",
    ADMIN_ROLES.filter((r) => hasPermission(r, "admin.users.manage")).sort().join(",") === ["ADMIN", "OWNER"].join(",")
  );
  check(
    "MARKETING still has admin.marketing.send (unaffected by this phase)",
    hasPermission("MARKETING", "admin.marketing.send") === true
  );

  // ---------------------------------------------------------------
  // Part 2: real local-DB tests using throwaway seeded users.
  // ---------------------------------------------------------------
  const actorId = await createTestUser("phase2-actor");
  const targetAId = await createTestUser("phase2-target-a");
  const targetBId = await createTestUser("phase2-target-b");
  console.log(`seeded actor=${actorId} targetA=${targetAId} targetB=${targetBId}`);

  const actor: AdminContext = { userId: actorId, email: "actor@test.local", role: "OWNER" };

  try {
    // --- self-target guard ---
    const selfSuspend = await suspendUser(actor, actorId, "self-test");
    check("self-suspend is rejected (self-target guard)", selfSuspend.ok === false, selfSuspend);

    const selfDelete = await deleteUserByAdmin(actor, actorId);
    check("self-delete is rejected (self-target guard)", selfDelete.ok === false, selfDelete);

    // --- suspend persistence ---
    const suspendResult = await suspendUser(actor, targetAId, "test suspension reason");
    check("suspendUser succeeds", suspendResult.ok === true, suspendResult);

    const { data: profileAfterSuspend } = await admin
      .from("profiles")
      .select("suspended_at, suspended_by, suspended_reason")
      .eq("id", targetAId)
      .maybeSingle();
    check("suspended_at is set after suspend", Boolean(profileAfterSuspend?.suspended_at), profileAfterSuspend);
    check("suspended_by matches actor", profileAfterSuspend?.suspended_by === actorId, profileAfterSuspend);
    check("suspended_reason persisted", profileAfterSuspend?.suspended_reason === "test suspension reason", profileAfterSuspend);

    // --- reactivation clears suspension ---
    const reactivateResult = await reactivateUser(actor, targetAId);
    check("reactivateUser succeeds", reactivateResult.ok === true, reactivateResult);

    const { data: profileAfterReactivate } = await admin
      .from("profiles")
      .select("suspended_at, suspended_by, suspended_reason")
      .eq("id", targetAId)
      .maybeSingle();
    check(
      "suspended_at/by/reason all null after reactivate",
      !profileAfterReactivate?.suspended_at && !profileAfterReactivate?.suspended_by && !profileAfterReactivate?.suspended_reason,
      profileAfterReactivate
    );

    // --- plan-value validation ---
    const badPlan = await changeUserPlan(actor, targetAId, "not-a-real-plan");
    check("changeUserPlan rejects an unsupported plan key", badPlan.ok === false, badPlan);

    const goodPlan = await changeUserPlan(actor, targetAId, "pro");
    check("changeUserPlan accepts 'pro' (a real enabled plan_key)", goodPlan.ok === true, goodPlan);

    const { data: subRow } = await admin
      .from("subscriptions")
      .select("plan_key, status, provider")
      .eq("user_id", targetAId)
      .maybeSingle();
    check(
      "subscriptions row reflects the plan change",
      subRow?.plan_key === "pro" && subRow?.status === "active" && subRow?.provider === "manual",
      subRow
    );

    // --- quota override resolution precedence ---
    const { data: noOverrideLimit } = await admin.rpc("resolve_generate_package_quota_limit", { p_user_id: targetBId });
    const { data: freeLimit } = await admin.from("quota_plans").select("monthly_generation_limit").eq("plan_key", "free").maybeSingle();
    check(
      "with no override and no subscription, resolver falls back to free plan limit",
      noOverrideLimit === (freeLimit?.monthly_generation_limit ?? 0),
      { noOverrideLimit, freeLimit }
    );

    const setOverride = await changeUserQuotaOverride(actor, targetBId, 17, "test override note");
    check("changeUserQuotaOverride sets an override", setOverride.ok === true, setOverride);

    const { data: overriddenLimit } = await admin.rpc("resolve_generate_package_quota_limit", { p_user_id: targetBId });
    check("resolver returns the override value (17), taking precedence over plan default", overriddenLimit === 17, { overriddenLimit });

    const badQuota = await changeUserQuotaOverride(actor, targetBId, -5, null);
    check("changeUserQuotaOverride rejects a negative limit", badQuota.ok === false, badQuota);

    const clearOverride = await changeUserQuotaOverride(actor, targetBId, null, null);
    check("changeUserQuotaOverride(null) clears the override", clearOverride.ok === true, clearOverride);

    const { data: clearedLimit } = await admin.rpc("resolve_generate_package_quota_limit", { p_user_id: targetBId });
    check("resolver falls back to plan default again after clearing override", clearedLimit === (freeLimit?.monthly_generation_limit ?? 0), { clearedLimit });

    // --- month-boundary non-destructiveness: an override row has no
    // month/period column at all (see migration comment) - confirm it
    // simply persists with no expiry field to accidentally reset.
    await changeUserQuotaOverride(actor, targetBId, 9, "persists across months");
    const { data: overrideRow } = await admin
      .from("admin_user_quota_overrides")
      .select("*")
      .eq("user_id", targetBId)
      .maybeSingle();
    check(
      "quota override row has no month/period/expiry column (persists until explicitly changed)",
      Boolean(overrideRow) && !("period" in (overrideRow ?? {})) && !("month" in (overrideRow ?? {})) && !("expires_at" in (overrideRow ?? {})),
      overrideRow
    );

    // --- audit log entries generated, no sensitive content ---
    const { data: auditRows } = await admin
      .from("admin_audit_log")
      .select("action, target_id, result, metadata")
      .eq("actor_admin_user_id", actorId)
      .order("created_at", { ascending: true });

    const actions = (auditRows ?? []).map((r) => r.action);
    check("USER_SUSPENDED audit action recorded", actions.includes("USER_SUSPENDED"), actions);
    check("USER_REACTIVATED audit action recorded", actions.includes("USER_REACTIVATED"), actions);
    check("USER_PLAN_CHANGED audit action recorded", actions.includes("USER_PLAN_CHANGED"), actions);
    check("USER_QUOTA_CHANGED audit action recorded", actions.includes("USER_QUOTA_CHANGED"), actions);

    // Suspension reason IS expected in USER_SUSPENDED metadata (it's the
    // whole point of an audit trail's reason field) - only forbidden
    // content is passwords/tokens/session IDs/API keys/resume-cover-
    // letter-job text, none of which this phase's code ever logs.
    const metadataBlob = JSON.stringify(auditRows ?? []);
    check(
      "no audit metadata contains a password/token/session-id/API-key-like field",
      !metadataBlob.toLowerCase().includes("password") &&
        !metadataBlob.toLowerCase().includes("token") &&
        !metadataBlob.toLowerCase().includes("session_id") &&
        !metadataBlob.toLowerCase().includes("api_key"),
      metadataBlob.slice(0, 300)
    );

    // --- deletion-cleanup-no-orphan (Stripe-safe delete) ---
    const deleteResult = await deleteUserByAdmin(actor, targetBId);
    check("deleteUserByAdmin succeeds", deleteResult.ok === true, deleteResult);
    if (deleteResult.ok) {
      check(
        "delete result reports stripeSubscriptionNotCancelled=false (no Stripe provider on this row)",
        deleteResult.value.stripeSubscriptionNotCancelled === false,
        deleteResult.value
      );
    }

    const { data: authUserAfterDelete } = await admin.auth.admin.getUserById(targetBId);
    check("auth user is actually gone after admin delete", !authUserAfterDelete?.user, authUserAfterDelete);

    const { data: orphanSub } = await admin.from("subscriptions").select("user_id").eq("user_id", targetBId).maybeSingle();
    check("no orphaned subscriptions row after delete", !orphanSub, orphanSub);

    const { data: orphanOverride } = await admin.from("admin_user_quota_overrides").select("user_id").eq("user_id", targetBId).maybeSingle();
    check("no orphaned quota-override row after delete", !orphanOverride, orphanOverride);

    const { data: orphanProfile } = await admin.from("profiles").select("id").eq("id", targetBId).maybeSingle();
    check("no orphaned profiles row after delete", !orphanProfile, orphanProfile);

    const { data: auditRows2 } = await admin
      .from("admin_audit_log")
      .select("action, target_id, result")
      .eq("actor_admin_user_id", actorId)
      .eq("action", "USER_DELETED");
    check("USER_DELETED audit action recorded with success result", (auditRows2 ?? []).some((r) => r.result === "success"), auditRows2);
  } finally {
    // Cleanup remaining throwaway fixtures (targetB already deleted by the test itself).
    await admin.auth.admin.deleteUser(actorId).catch(() => {});
    await admin.auth.admin.deleteUser(targetAId).catch(() => {});
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
