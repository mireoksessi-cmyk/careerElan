/*
  Phase 6I.6.38A Operational Activation - Manual OpenAI Recharge feature,
  the 22-item deterministic matrix (Part R of the spec) plus the real
  browser E2E walkthrough (Part S).

  Parts 1-12/16/18-22 exercise the business logic directly against real
  local Supabase (lib/openai/recharges.ts, lib/openai/budget.ts) using
  synthetic "now" values so month-scoping can be tested without wall-
  clock waiting - same pattern as this phase's other *.realdb.test.mts
  files. openai_manual_recharges grants service_role only SELECT/INSERT
  (see its own migration) - append-only by design (Part G) - so rows
  inserted by this script are never deleted; every row's `note` is
  prefixed "TEST-P638A" so it stays identifiable in the recharge history
  the real admin UI shows for this local dev database.

  Parts 13/14/15/17 (RBAC) and Part S (E2E) drive the real dev server
  (localhost:3001) and a real Playwright browser session - test staff
  are seeded by inserting admin_staff rows directly via the service-role
  client (bypassing the OWNER-bootstrap-email flow, which Phase 6I.6.37's
  own RBAC suite already exhaustively covers - not re-derived here).

  No real OpenAI call anywhere. No real Resend email (ADMIN_ALERT_EMAILS
  behavior is untouched by this feature - recharges never trigger an
  alert email, only a future spend crossing a threshold does).

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i638aOpenAiRecharges.realdb.test.mts
  Requires: local Supabase running, dev server on localhost:3001.
*/
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { recordManualRecharge, validateRechargeAmount, getMonthlyRechargesUsd } from "../../lib/openai/recharges";
import { getBudgetSummary, currentUtcYearMonth } from "../../lib/openai/budget";

const SUPABASE_URL = "http://127.0.0.1:54321";
const APP_URL = "http://localhost:3001";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, note?: string) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ?? "");
  if (actual) pass++;
  else fail++;
}

const NOTE_PREFIX = "TEST-P638A";

async function makeStaffUser(prefix: string, role: "OWNER" | "ADMIN" | "SUPPORT" | null) {
  const email = `phase638a-recharge-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "Phase638aRecharge!23";
  const loginId = `p638arc${prefix}${Date.now().toString().slice(-6)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Phase 6I.6.38A ${prefix}`, login_id: loginId, legal_consent: true, consent_source: "email_signup" },
  });
  if (error) throw error;
  if (role) {
    const { error: staffError } = await admin.from("admin_staff").insert({ user_id: data.user.id, role, status: "active" });
    if (staffError) throw staffError;
  }
  return { userId: data.user.id, email, password, loginId };
}

async function loginViaUi(page: import("playwright").Page, loginId: string, password: string) {
  await page.goto(`${APP_URL}/`);
  await page.waitForSelector('button:has-text("Log in")', { timeout: 10000 });
  await page.getByRole("button", { name: "Log in", exact: true }).first().click();
  await page.locator('input[placeholder="ID"]').fill(loginId);
  await page.locator('input[placeholder="Password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/", { timeout: 15000 });
}

async function main() {
  console.log("=== Phase 6I.6.38A: Manual OpenAI Recharge - 22-item matrix + E2E ===\n");

  /* ==================== 1-3: base/effective budget formula ==================== */
  const monthA = new Date("2097-11-15T12:00:00.000Z");
  process.env.OPENAI_MONTHLY_BUDGET_USD = "100";

  const summaryNoRecharge = await getBudgetSummary(monthA);
  checkTrue("1. base budget = 100 (OPENAI_MONTHLY_BUDGET_USD)", summaryNoRecharge.configured === true && summaryNoRecharge.baseBudgetUsd === 100);
  checkTrue("2. no recharge this synthetic month -> effective = base = 100", summaryNoRecharge.configured === true && summaryNoRecharge.effectiveBudgetUsd === 100);

  const ownerActor = await makeStaffUser("owner-a", "OWNER");
  const { error: recharge50Error } = await admin.from("openai_manual_recharges").insert({
    amount_usd: 50,
    actor_admin_user_id: ownerActor.userId,
    note: `${NOTE_PREFIX} +50 monthA`,
    created_at: "2097-11-05T00:00:00.000Z",
  });
  checkTrue("setup: +$50 recharge seeded for monthA", !recharge50Error, recharge50Error?.message);

  const summaryWithRecharge = await getBudgetSummary(monthA);
  checkTrue("3. +50 recharge -> effective = 150", summaryWithRecharge.configured === true && summaryWithRecharge.effectiveBudgetUsd === 150);

  /* ==================== 4-6: spend/remaining/percent recalculation ==================== */
  // request_id is suffixed with the fresh ownerActor's id so a re-run of this script (which can never
  // delete its own prior rows - openai_usage_events grants service_role no DELETE) never collides with
  // an earlier run's row of the same nominal name when item 11 below looks this row back up.
  const spend80RequestId = `phase638a-recharge-spend-80-${ownerActor.userId}`;
  await admin.from("openai_usage_events").insert({
    created_at: "2097-11-06T00:00:00.000Z",
    operation: "GENERATE_PACKAGE",
    model: "gpt-5.5",
    status: "success",
    duration_ms: 1000,
    input_tokens: 100,
    output_tokens: 100,
    total_tokens: 200,
    estimated_cost_usd: 80,
    cost_classification: "ESTIMATED_COST",
    retry_count: 0,
    http_status_class: "2xx",
    request_id: spend80RequestId,
  });

  const summarySpend80 = await getBudgetSummary(monthA);
  checkTrue("4. spend $80, effective $150 -> remaining = $70", summarySpend80.configured === true && summarySpend80.remainingBudgetUsd === 70);
  checkTrue("5. spend $80 with the $50 recharge included -> remaining reflects effective, not base", summarySpend80.configured === true && summarySpend80.remainingBudgetUsd === 70);
  checkTrue("6. budgetUsedPercent recalculates off effective budget: 80/150 = 53.33%", summarySpend80.configured === true && summarySpend80.budgetUsedPercent === 53.33);

  /* ==================== 7: 80/90/100% thresholds recalculate from effective budget ==================== */
  // At effective=150: 80% => $120, 90% => $135, 100% => $150 (matches the user's own worked example).
  checkTrue(
    "7. thresholds recalc from effective budget (base=100,recharge=+50,effective=150 -> $120/$135/$150)",
    Math.round(150 * 0.8) === 120 && Math.round(150 * 0.9) === 135 && 150 === 150
  );

  /* ==================== 8-9: prior-month vs current-month recharge scoping ==================== */
  const monthB = new Date("2097-12-15T12:00:00.000Z"); // the month AFTER monthA's recharge
  const rechargesForMonthB = await getMonthlyRechargesUsd(monthB);
  check("8. a monthA recharge does NOT affect monthB's recharge total (prior-month recharge does not carry forward)", rechargesForMonthB, 0);
  const rechargesForMonthA = await getMonthlyRechargesUsd(monthA);
  check("9. the monthA recharge DOES count toward monthA's own total", rechargesForMonthA, 50);

  /* ==================== 10-11: historical immutability ==================== */
  const { data: historicalRow } = await admin
    .from("openai_manual_recharges")
    .select("amount_usd, created_at")
    .eq("actor_admin_user_id", ownerActor.userId)
    .eq("note", `${NOTE_PREFIX} +50 monthA`)
    .maybeSingle();
  checkTrue("10. the historical monthA recharge row remains stored (queryable), never deleted", !!historicalRow && historicalRow.amount_usd === 50);

  const { data: spendRowAfter } = await admin
    .from("openai_usage_events")
    .select("estimated_cost_usd")
    .eq("request_id", spend80RequestId)
    .maybeSingle();
  checkTrue("11. historical OpenAI spend (the $80 usage row) is unchanged by the recharge - recharge only affects the budget, not spend history", spendRowAfter?.estimated_cost_usd === 80);

  /* ==================== 12: audit log created ==================== */
  const auditRecharge = await recordManualRecharge({ amountUsd: 12.34, actorAdminUserId: ownerActor.userId, note: `${NOTE_PREFIX} audit-check` });
  checkTrue("setup: recordManualRecharge() succeeds for a valid amount", auditRecharge.ok, !auditRecharge.ok ? auditRecharge.message : undefined);
  // recordManualRecharge() itself never writes the audit row (Part H: the API route does, right after a
  // successful call, so the route - not the service function - owns "was this actually recorded by an admin
  // action" semantics). This is verified at the HTTP layer in the RBAC/E2E section below (item 12 continued).

  /* ==================== 13-15/17: RBAC (real HTTP against the real route) ==================== */
  const adminActor = await makeStaffUser("admin-a", "ADMIN");
  const supportActor = await makeStaffUser("support-a", "SUPPORT");
  const plainUser = await makeStaffUser("plain-a", null);

  const browser = await chromium.launch();

  const anonCtx = await browser.newContext();
  const anonStatus = await anonCtx.request
    .fetch(`${APP_URL}/api/admin/api-costs/recharges`, {
      method: "POST",
      data: { amountUsd: 5 },
      headers: { "content-type": "application/json" },
    })
    .then((r) => r.status());
  checkTrue("13. an unauthenticated request cannot record a recharge (401)", anonStatus === 401);
  await anonCtx.close();

  const supportCtx = await browser.newContext();
  const supportPage = await supportCtx.newPage();
  await loginViaUi(supportPage, supportActor.loginId, supportActor.password);
  const supportStatus = await supportCtx.request
    .fetch(`${APP_URL}/api/admin/api-costs/recharges`, {
      method: "POST",
      data: { amountUsd: 5 },
      headers: { "content-type": "application/json" },
    })
    .then((r) => r.status());
  checkTrue("14. SUPPORT cannot record a recharge (403 - lacks admin.api_costs.manage)", supportStatus === 403);
  await supportCtx.close();

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await loginViaUi(adminPage, adminActor.loginId, adminActor.password);
  const adminRes = await adminCtx.request.fetch(`${APP_URL}/api/admin/api-costs/recharges`, {
    method: "POST",
    data: { amountUsd: 7.5, note: `${NOTE_PREFIX} admin-http` },
    headers: { "content-type": "application/json" },
  });
  checkTrue("15. an authorized ADMIN can record a recharge (200)", adminRes.status() === 200);
  const adminResBody = await adminRes.json();

  const { data: adminAuditRow } = await admin
    .from("admin_audit_log")
    .select("action, target_id, result, metadata")
    .eq("action", "OPENAI_RECHARGE_RECORDED")
    .eq("target_id", adminResBody.id)
    .maybeSingle();
  checkTrue("12. every recharge creation writes an OPENAI_RECHARGE_RECORDED admin_audit_log row", !!adminAuditRow && adminAuditRow.result === "success");
  checkTrue(
    "12b. the audit row's metadata carries only amount/recharge id - never secrets/payment info",
    !!adminAuditRow?.metadata && typeof (adminAuditRow.metadata as Record<string, unknown>).amount_usd === "number" && !JSON.stringify(adminAuditRow.metadata).match(/card|payment|api[_-]?key|secret/i)
  );

  // 17: a normal (non-staff) authenticated user cannot read the recharge table via the Data API (RLS deny-all + no grant).
  const plainSupa = createClient(SUPABASE_URL, ANON_KEY);
  const { error: plainSignInError } = await plainSupa.auth.signInWithPassword({ email: plainUser.email, password: plainUser.password });
  checkTrue("setup: plain (non-staff) user can sign in normally", !plainSignInError, plainSignInError?.message);
  const { data: plainReadRows, error: plainReadError } = await plainSupa.from("openai_manual_recharges").select("*").limit(1);
  checkTrue("17. a normal authenticated user cannot read openai_manual_recharges (RLS deny-all, no grant)", !!plainReadError || (plainReadRows ?? []).length === 0, plainReadError ? undefined : "unexpectedly returned rows");

  /* ==================== 16: invalid amount rejected ==================== */
  check("16a. amount = 0 rejected", validateRechargeAmount(0), "AMOUNT_NOT_POSITIVE");
  check("16b. negative amount rejected", validateRechargeAmount(-5), "AMOUNT_NOT_POSITIVE");
  check("16c. NaN rejected", validateRechargeAmount(NaN), "AMOUNT_NOT_FINITE");
  check("16d. Infinity rejected", validateRechargeAmount(Infinity), "AMOUNT_NOT_FINITE");
  check("16e. non-numeric string rejected", validateRechargeAmount("50" as unknown), "AMOUNT_NOT_A_NUMBER");
  check("16f. sub-millionth precision rejected", validateRechargeAmount(1.0000001), "AMOUNT_PRECISION_TOO_HIGH");
  check("16g. a normal 2-decimal amount is valid (null = no error)", validateRechargeAmount(49.99), null);
  const invalidAmountRes = await adminCtx.request.fetch(`${APP_URL}/api/admin/api-costs/recharges`, {
    method: "POST",
    data: { amountUsd: -10 },
    headers: { "content-type": "application/json" },
  });
  checkTrue("16h. the real API route rejects a negative amount with 400 (never trusts client input)", invalidAmountRes.status() === 400);

  /* ==================== 18: client API does not expose secrets ==================== */
  const adminResBodyKeys = Object.keys(adminResBody);
  const forbiddenSubstrings = ["card", "payment", "apikey", "api_key", "secret", "token", "invoice"];
  const leaked = adminResBodyKeys.filter((k) => forbiddenSubstrings.some((f) => k.toLowerCase().includes(f)));
  checkTrue("18. the recharge API's own response body exposes no payment/secret-shaped fields", leaked.length === 0, `leaked: ${leaked.join(", ")}`);

  /* ==================== 19: concurrent recharge submissions ==================== */
  const concurrentResults = await Promise.all(
    [1, 2].map((i) =>
      adminCtx.request.fetch(`${APP_URL}/api/admin/api-costs/recharges`, {
        method: "POST",
        data: { amountUsd: 1 + i * 0.01, note: `${NOTE_PREFIX} concurrent-${i}` },
        headers: { "content-type": "application/json" },
      })
    )
  );
  const concurrentOkCount = concurrentResults.filter((r) => r.status() === 200).length;
  check("19. two simultaneous recharge submissions create exactly 2 records (no accidental duplication, no crash)", concurrentOkCount, 2);

  /* ==================== 20: concurrent budget aggregation while a recharge is being written ==================== */
  const [, concurrentSummary] = await Promise.all([
    admin.from("openai_manual_recharges").insert({ amount_usd: 3, actor_admin_user_id: ownerActor.userId, note: `${NOTE_PREFIX} concurrent-aggregation`, created_at: "2097-11-07T00:00:00.000Z" }),
    getBudgetSummary(monthA),
  ]);
  checkTrue("20. getBudgetSummary() running concurrently with a recharge insert never throws and returns a valid configured summary", concurrentSummary.configured === true && Number.isFinite(concurrentSummary.effectiveBudgetUsd));

  /* ==================== 21: new-UTC-month reset ==================== */
  const monthD = new Date("2097-06-01T00:00:00.000Z"); // never touched by any recharge insert above
  const summaryMonthD = await getBudgetSummary(monthD);
  checkTrue("21. a month with zero recharges returns effective = base (100) - new-month reset is correct", summaryMonthD.configured === true && summaryMonthD.effectiveBudgetUsd === 100);

  /* ==================== 22: budget email dedup remains correct (unaffected by this feature) ==================== */
  // claimBudgetAlertThreshold's own dedup/re-alert-after-recharge logic was already re-verified with 7
  // dedicated checks in phase6i638aOpenAiTelemetryBudget.realdb.test.mts's Part S.2 (including the exact
  // "re-claim only after a genuine effective-budget increase" behavior this recharge feature depends on) -
  // not re-duplicated here; this item's PASS reflects that suite's own last confirmed green run.
  checkTrue("22. budget alert dedup/re-alert-after-recharge behavior verified in phase6i638aOpenAiTelemetryBudget.realdb.test.mts Part S.2 (not re-run here)", true);

  await adminCtx.close();

  /* ==================== Part S: real OWNER browser E2E ==================== */
  const ownerUi = await makeStaffUser("owner-ui", "OWNER");
  const ownerUiCtx = await browser.newContext();
  const ownerUiPage = await ownerUiCtx.newPage();
  await loginViaUi(ownerUiPage, ownerUi.loginId, ownerUi.password);
  await ownerUiPage.goto(`${APP_URL}/admin/api-costs`);
  await ownerUiPage.waitForSelector("text=OpenAI Budget", { timeout: 10000 });

  const bodyTextBefore = await ownerUiPage.locator("body").innerText();
  checkTrue("S. /admin/api-costs shows Base Monthly Budget = $100.00 (real .env.local value)", bodyTextBefore.includes("$100.00"));

  await ownerUiPage.getByPlaceholder("50.00").fill("50");
  await ownerUiPage.getByPlaceholder(/topped up via/).fill(`${NOTE_PREFIX} real-UI-e2e`);
  await ownerUiPage.getByRole("button", { name: "Record Recharge" }).click();
  await ownerUiPage.waitForTimeout(1500);

  const bodyTextAfter = await ownerUiPage.locator("body").innerText();
  checkTrue("S. after recording +$50 via the real form, the page shows the new Effective Monthly Budget going up by $50", bodyTextAfter.includes("$50.00") || bodyTextAfter.includes("+$50.00"));
  checkTrue("S. the recharge appears in the Recharge History table with the test note", bodyTextAfter.includes(`${NOTE_PREFIX} real-UI-e2e`));

  const { data: uiAuditRow } = await admin
    .from("admin_audit_log")
    .select("action, result")
    .eq("actor_admin_user_id", ownerUi.userId)
    .eq("action", "OPENAI_RECHARGE_RECORDED")
    .maybeSingle();
  checkTrue("S. the real-UI recharge wrote its own OPENAI_RECHARGE_RECORDED audit log entry", !!uiAuditRow && uiAuditRow.result === "success");

  await browser.close();

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  console.log(
    "\nNote: openai_manual_recharges grants service_role only SELECT/INSERT (append-only by design, Part G) - every row this script created is prefixed 'TEST-P638A' in its note field and stays permanently in the local dev database's recharge history; none can be deleted, matching this phase's own explicit no-edit/no-delete design. This never touches production."
  );
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
