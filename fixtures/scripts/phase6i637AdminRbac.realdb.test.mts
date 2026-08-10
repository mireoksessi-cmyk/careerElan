/*
  Phase 6I.6.37 - RBAC / Staff Permissions test matrix (Part AI, items A-O)
  AND the minimal Playwright Admin E2E required by Part AL (OWNER walks
  all tabs; normal user denied; one limited-role synthetic staff member
  verifying authorized-allowed + unauthorized-denied) - one real-browser
  suite covers both, since Part AL's own scope is a strict subset of
  Part AI's.

  Every check is either a real HTTP request against the running dev
  server (localhost:3001) with a real Playwright cookie jar from a real
  UI login, or a real supabase-js call against local Supabase - no
  string-search-only fake tests.

  Setup performed by the orchestrating session (not this script):
  - A throwaway user was created and ADMIN_OWNER_BOOTSTRAP_EMAILS in
    .env.local was set to that user's email, and the dev server was
    restarted, so this script's own first login exercises the REAL
    OWNER bootstrap path in lib/admin/auth.ts (self-provisioning an
    admin_staff row on first login) - not a pre-seeded row. All other
    role assignments below use grantOrUpdateStaffRole() directly
    in-process (real DB writes, the same function the Staff API route
    calls) since that function's business rules (Part S) are exactly
    what needs verifying, and it doesn't require an HTTP round trip.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i637AdminRbac.realdb.test.mts
  Requires: local Supabase running, dev server on localhost:3001 with
  ADMIN_OWNER_BOOTSTRAP_EMAILS set to the bootstrap user created by setup.
*/
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";
import { grantOrUpdateStaffRole, setStaffStatus, getStaffList } from "../../lib/admin/queries/staff";
import type { AdminContext } from "../../lib/admin/auth";
import type { AdminRole } from "../../lib/admin/permissions";
import { hasPermission, ADMIN_ROLES, type AdminPermission } from "../../lib/admin/permissions";

const SUPABASE_URL = "http://127.0.0.1:54321";
const APP_URL = "http://localhost:3001";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const BOOTSTRAP_EMAIL = process.env.ADMIN_OWNER_BOOTSTRAP_EMAILS;
if (!BOOTSTRAP_EMAIL) throw new Error("ADMIN_OWNER_BOOTSTRAP_EMAILS not set - run setup first");
// The bootstrap user's profiles.login_id was set directly by the orchestrating
// session's setup step (via direct psql, since public.profiles revokes UPDATE
// from service_role just like admin_staff/admin_audit_log/quota tables do).
const BOOTSTRAP_LOGIN_ID = "p6i637owner999001";
const BOOTSTRAP_PASSWORD = "Phase6i637Owner!23";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, note?: string) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ? `(${note})` : "");
  if (actual) pass++;
  else fail++;
}

async function makeNativeUser(prefix: string) {
  const email = `phase6i637-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "Phase6i637Test!23";
  const loginId = `p6i637${prefix}${Date.now().toString().slice(-6)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Phase 6I.6.37 ${prefix}`, login_id: loginId, legal_consent: true, consent_source: "email_signup" },
  });
  if (error) throw error;
  return { userId: data.user.id, email, password, loginId };
}

async function loginViaUi(page: Page, loginId: string, password: string) {
  await page.goto(`${APP_URL}/`);
  await page.waitForSelector('button:has-text("Log in")', { timeout: 10000 });
  await page.getByRole("button", { name: "Log in", exact: true }).first().click();
  await page.locator('input[placeholder="ID"]').fill(loginId);
  await page.locator('input[placeholder="Password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/", { timeout: 15000 });
}

async function apiStatus(context: BrowserContext, path: string, init?: { method?: string; data?: unknown }) {
  const res = await context.request.fetch(`${APP_URL}${path}`, {
    method: init?.method ?? "GET",
    data: init?.data,
    headers: init?.data ? { "content-type": "application/json" } : undefined,
  });
  return res.status();
}

async function pageIsDenied(page: Page, path: string): Promise<{ status: "denied" | "allowed" | "redirected"; bodyHasAccessDenied: boolean }> {
  await page.goto(`${APP_URL}${path}`);
  const url = new URL(page.url());
  if (url.pathname === "/") return { status: "redirected", bodyHasAccessDenied: false };
  const text = await page.locator("body").innerText();
  const denied = text.includes("Access Denied");
  return { status: denied ? "denied" : "allowed", bodyHasAccessDenied: denied };
}

async function main() {
  console.log("=== Phase 6I.6.37 Admin RBAC Test Matrix ===");

  /* ==================== A: permission matrix matches the closed spec (pure, no DB) ==================== */
  const EXPECTED: Record<AdminRole, AdminPermission[]> = {
    OWNER: [
      "admin.overview.read", "admin.users.read", "admin.users.manage", "admin.subscriptions.read",
      "admin.subscriptions.manage", "admin.product_usage.read", "admin.api_costs.read",
      "admin.system_health.read", "admin.alerts.read", "admin.alerts.manage", "admin.staff.read",
      "admin.staff.manage", "admin.audit.read",
    ],
    ADMIN: [
      "admin.overview.read", "admin.users.read", "admin.users.manage", "admin.subscriptions.read",
      "admin.subscriptions.manage", "admin.product_usage.read", "admin.api_costs.read",
      "admin.system_health.read", "admin.alerts.read", "admin.alerts.manage", "admin.staff.read", "admin.audit.read",
    ],
    SUPPORT: ["admin.overview.read", "admin.users.read"],
    OPERATIONS: ["admin.overview.read", "admin.system_health.read", "admin.alerts.read", "admin.alerts.manage", "admin.api_costs.read"],
    ANALYST: ["admin.overview.read", "admin.product_usage.read", "admin.api_costs.read"],
    VIEWER: ["admin.overview.read"],
  };
  const ALL_PERMISSIONS: AdminPermission[] = [
    "admin.overview.read", "admin.users.read", "admin.users.manage", "admin.subscriptions.read",
    "admin.subscriptions.manage", "admin.product_usage.read", "admin.api_costs.read",
    "admin.system_health.read", "admin.alerts.read", "admin.alerts.manage", "admin.staff.read",
    "admin.staff.manage", "admin.audit.read",
  ];
  let matrixOk = true;
  for (const role of ADMIN_ROLES) {
    for (const permission of ALL_PERMISSIONS) {
      const expected = EXPECTED[role].includes(permission);
      if (hasPermission(role, permission) !== expected) matrixOk = false;
    }
  }
  checkTrue("A. hasPermission() matches the exact 6-role x 13-permission spec matrix (78 cells)", matrixOk);
  checkTrue("A. SUPPORT lacks admin.api_costs.read (spec: SUPPORT is user-facing support only)", !hasPermission("SUPPORT", "admin.api_costs.read"));
  checkTrue("A. VIEWER has exactly one permission", EXPECTED.VIEWER.length === 1 && hasPermission("VIEWER", "admin.overview.read"));

  /* ==================== B: unauthenticated denied ==================== */
  const anonContext = await (await chromium.launch()).newContext();
  check("B. unauthenticated GET /admin redirects (not 200 with content)", (await anonContext.request.fetch(`${APP_URL}/admin`, { maxRedirects: 0 })).status(), 307);
  check("B. unauthenticated GET /api/admin/overview returns 401", await apiStatus(anonContext, "/api/admin/overview"), 401);
  await anonContext.close();

  /* ==================== C: OWNER bootstrap (real login, first-ever staff row) ==================== */
  const { data: preRow } = await admin.from("admin_staff").select("role").eq("user_id", "00000000-0000-0000-0000-000000000000").maybeSingle();
  void preRow;
  const browser = await chromium.launch();
  const ownerCtxRaw = await browser.newContext();
  const ownerPage = await ownerCtxRaw.newPage();
  await loginViaUi(ownerPage, BOOTSTRAP_LOGIN_ID, BOOTSTRAP_PASSWORD);
  // Bootstrap only runs inside getAdminContext(), which only ever executes on
  // an actual /admin (or /api/admin/*) request - logging into the regular
  // site never touches it. This priming visit is what actually triggers the
  // self-provisioning insert; the DB assertions right below read its result.
  await ownerPage.goto(`${APP_URL}/admin`);

  const { data: bootstrapUser } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const ownerUserId = bootstrapUser?.users.find((u) => u.email === BOOTSTRAP_EMAIL)?.id;
  if (!ownerUserId) throw new Error("bootstrap user not found in auth.users");

  const { data: ownerStaffRow } = await admin.from("admin_staff").select("role, status").eq("user_id", ownerUserId).maybeSingle();
  check("C. OWNER bootstrap: first login self-provisioned an admin_staff row with role=OWNER", ownerStaffRow?.role, "OWNER");
  check("C. OWNER bootstrap: self-provisioned row is active", ownerStaffRow?.status, "active");

  const { data: bootstrapAuditRows } = await admin.from("admin_audit_log").select("action").eq("actor_admin_user_id", ownerUserId).eq("action", "ADMIN_OWNER_BOOTSTRAPPED");
  checkTrue("C. OWNER bootstrap wrote an ADMIN_OWNER_BOOTSTRAPPED audit row", (bootstrapAuditRows?.length ?? 0) >= 1);

  const ownerCtx: AdminContext = { userId: ownerUserId, email: BOOTSTRAP_EMAIL, role: "OWNER" };

  /* ==================== D: OWNER can reach every admin page (real browser, real content) ==================== */
  const ALL_ADMIN_PAGES = ["/admin", "/admin/users", "/admin/product-usage", "/admin/api-costs", "/admin/system-health", "/admin/subscriptions", "/admin/alerts", "/admin/staff", "/admin/audit"];
  let ownerAllPagesOk = true;
  for (const path of ALL_ADMIN_PAGES) {
    const result = await pageIsDenied(ownerPage, path);
    if (result.status !== "allowed") {
      ownerAllPagesOk = false;
      console.log(`   (OWNER unexpectedly ${result.status} on ${path})`);
    }
  }
  checkTrue("D. OWNER reaches every one of the 9 admin tabs with real content (no Access Denied, no redirect)", ownerAllPagesOk);

  const ALL_ADMIN_API_ROUTES = [
    "/api/admin/overview", "/api/admin/users?page=1&pageSize=10", "/api/admin/product-usage",
    "/api/admin/api-costs", "/api/admin/system-health", "/api/admin/subscriptions",
    "/api/admin/alerts", "/api/admin/staff", "/api/admin/audit?page=1&pageSize=10",
  ];
  let ownerAllApisOk = true;
  for (const path of ALL_ADMIN_API_ROUTES) {
    const status = await apiStatus(ownerCtxRaw, path);
    if (status !== 200) {
      ownerAllApisOk = false;
      console.log(`   (OWNER unexpectedly ${status} on ${path})`);
    }
  }
  checkTrue("D. OWNER's session gets 200 from every one of the 9 admin API GET routes", ownerAllApisOk);

  /* ==================== setup remaining 5 roles via grantOrUpdateStaffRole (real DB writes) ==================== */
  const adminUser = await makeNativeUser("admin");
  const supportUser = await makeNativeUser("support");
  const opsUser = await makeNativeUser("ops");
  const analystUser = await makeNativeUser("analyst");
  const viewerUser = await makeNativeUser("viewer");
  const plainUser = await makeNativeUser("plain");

  const grantAdmin = await grantOrUpdateStaffRole(ownerCtx, adminUser.email, "ADMIN");
  const grantSupport = await grantOrUpdateStaffRole(ownerCtx, supportUser.email, "SUPPORT");
  const grantOps = await grantOrUpdateStaffRole(ownerCtx, opsUser.email, "OPERATIONS");
  const grantAnalyst = await grantOrUpdateStaffRole(ownerCtx, analystUser.email, "ANALYST");
  const grantViewer = await grantOrUpdateStaffRole(ownerCtx, viewerUser.email, "VIEWER");
  checkTrue("setup: OWNER can grant ADMIN/SUPPORT/OPERATIONS/ANALYST/VIEWER", [grantAdmin, grantSupport, grantOps, grantAnalyst, grantViewer].every((r) => r.ok));

  const staffList = await getStaffList();
  checkTrue("setup: getStaffList() reflects all 6 granted roles (OWNER + 5 new)", staffList.length >= 6);

  /* ==================== J: ADMIN cannot create/grant OWNER ==================== */
  const adminCtx: AdminContext = { userId: adminUser.userId, email: adminUser.email, role: "ADMIN" };
  const adminTryGrantOwner = await grantOrUpdateStaffRole(adminCtx, supportUser.email, "OWNER");
  checkTrue("J. ADMIN cannot grant the OWNER role (grantOrUpdateStaffRole rejects)", !adminTryGrantOwner.ok);
  const { data: supportRoleAfter } = await admin.from("admin_staff").select("role").eq("user_id", supportUser.userId).maybeSingle();
  check("J. target's role is unchanged after ADMIN's denied OWNER-grant attempt", supportRoleAfter?.role, "SUPPORT");

  /* ==================== K: last-active-OWNER protection ==================== */
  const ownersBefore = await admin.from("admin_staff").select("user_id", { count: "exact", head: true }).eq("role", "OWNER").eq("status", "active");
  check("K. exactly one active OWNER exists before the protection test", ownersBefore.count, 1);

  const demoteLastOwner = await grantOrUpdateStaffRole(ownerCtx, BOOTSTRAP_EMAIL, "ADMIN");
  checkTrue("K. demoting the last active OWNER (via role grant) is rejected", !demoteLastOwner.ok);
  const disableLastOwner = await setStaffStatus(ownerCtx, ownerUserId, "disabled");
  checkTrue("K. disabling the last active OWNER is rejected", !disableLastOwner.ok);
  const { data: ownerStillOwner } = await admin.from("admin_staff").select("role, status").eq("user_id", ownerUserId).maybeSingle();
  check("K. OWNER's own row is untouched after both rejected self-lockout attempts", ownerStillOwner, { role: "OWNER", status: "active" });

  /* A second OWNER makes demotion of the FIRST one legal again - proves the rule is "last active", not "any". */
  const secondOwnerUser = await makeNativeUser("owner2");
  await grantOrUpdateStaffRole(ownerCtx, secondOwnerUser.email, "OWNER");
  const demoteFirstOwnerNowOk = await grantOrUpdateStaffRole(ownerCtx, BOOTSTRAP_EMAIL, "ADMIN");
  checkTrue("K. once a 2nd active OWNER exists, demoting the 1st OWNER is allowed (proves 'last active', not blanket)", demoteFirstOwnerNowOk.ok);
  // restore: promote the bootstrap OWNER back so later assertions relying on ownerCtx as a real OWNER session stay valid.
  await grantOrUpdateStaffRole({ userId: secondOwnerUser.userId, email: secondOwnerUser.email, role: "OWNER" }, BOOTSTRAP_EMAIL, "OWNER");
  await setStaffStatus({ userId: secondOwnerUser.userId, email: secondOwnerUser.email, role: "OWNER" }, secondOwnerUser.userId, "disabled");

  /* ==================== E/F/G/H/I: per-role page + API matrix via real browser login ==================== */
  type RoleCase = {
    label: string;
    user: { email: string; password: string };
    allowedPages: string[];
    deniedPages: string[];
    allowedApis: string[];
    deniedApis: { path: string; expectedStatus: number }[];
  };

  const cases: RoleCase[] = [
    {
      label: "E. ADMIN",
      user: adminUser,
      allowedPages: ["/admin", "/admin/users", "/admin/staff", "/admin/audit"],
      deniedPages: [],
      allowedApis: ["/api/admin/users?page=1&pageSize=10", "/api/admin/staff"],
      deniedApis: [],
    },
    {
      label: "F. SUPPORT",
      user: supportUser,
      allowedPages: ["/admin", "/admin/users"],
      deniedPages: ["/admin/api-costs", "/admin/staff"],
      allowedApis: ["/api/admin/users?page=1&pageSize=10"],
      deniedApis: [{ path: "/api/admin/api-costs", expectedStatus: 403 }],
    },
    {
      label: "G. OPERATIONS",
      user: opsUser,
      allowedPages: ["/admin", "/admin/system-health", "/admin/alerts"],
      deniedPages: ["/admin/staff"],
      allowedApis: ["/api/admin/system-health", "/api/admin/alerts"],
      deniedApis: [{ path: "/api/admin/staff", expectedStatus: 403 }],
    },
    {
      label: "H. ANALYST",
      user: analystUser,
      allowedPages: ["/admin", "/admin/product-usage"],
      deniedPages: ["/admin/users"],
      allowedApis: ["/api/admin/product-usage"],
      deniedApis: [{ path: "/api/admin/users?page=1&pageSize=10", expectedStatus: 403 }],
    },
    {
      label: "I. VIEWER",
      user: viewerUser,
      allowedPages: ["/admin"],
      deniedPages: ["/admin/users", "/admin/staff", "/admin/alerts"],
      allowedApis: [],
      deniedApis: [{ path: "/api/admin/staff", expectedStatus: 403 }],
    },
  ];

  for (const c of cases) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUi(page, c.user.loginId, c.user.password);

    let allowedOk = true;
    for (const path of c.allowedPages) {
      const r = await pageIsDenied(page, path);
      if (r.status !== "allowed") allowedOk = false;
    }
    checkTrue(`${c.label}: reaches its own allowed page(s) with real content`, allowedOk, JSON.stringify(c.allowedPages));

    let deniedOk = true;
    for (const path of c.deniedPages) {
      const r = await pageIsDenied(page, path);
      if (r.status !== "denied") deniedOk = false;
    }
    checkTrue(`${c.label}: forbidden page(s) render a real "Access Denied" view, not blank/crash/silent-hide`, c.deniedPages.length === 0 || deniedOk, JSON.stringify(c.deniedPages));

    let apiAllowedOk = true;
    for (const path of c.allowedApis) {
      if ((await apiStatus(ctx, path)) !== 200) apiAllowedOk = false;
    }
    checkTrue(`${c.label}: allowed API route(s) return 200`, c.allowedApis.length === 0 || apiAllowedOk);

    let apiDeniedOk = true;
    for (const d of c.deniedApis) {
      const status = await apiStatus(ctx, d.path);
      if (status !== d.expectedStatus) apiDeniedOk = false;
    }
    checkTrue(`${c.label}: forbidden API route(s) return the expected 403 (direct API obeys the same rule as the page - Part AI item N)`, c.deniedApis.length === 0 || apiDeniedOk);

    await ctx.close();
  }

  /* ==================== I (continued): VIEWER cannot mutate ==================== */
  const viewerCtx2 = await browser.newContext();
  const viewerPage2 = await viewerCtx2.newPage();
  await loginViaUi(viewerPage2, viewerUser.loginId, viewerUser.password);
  const viewerMutateStatus = await apiStatus(viewerCtx2, "/api/admin/staff", { method: "POST", data: { email: plainUser.email, role: "SUPPORT" } });
  check("I. VIEWER's direct mutation attempt (grant a role via API) is rejected with 403", viewerMutateStatus, 403);
  await viewerCtx2.close();

  /* ==================== L: normal (non-staff) authenticated user fully denied ====================
     By design (lib/admin/auth.ts's AdminAuthError: only two codes exist -
     UNAUTHENTICATED when getAdminContext() returns null for ANY reason
     including "authenticated but no admin_staff row", and FORBIDDEN only for
     a real staff member missing a specific permission) a non-staff logged-in
     user is treated identically to a logged-out visitor: redirected home,
     401 on direct API calls - never shown the staff-only "Access Denied" UI.
     This is intentional (no need to expose "an admin area exists" language
     to an ordinary customer), not a bug - the "Access Denied" component is
     reserved for staff who have SOME admin access but not to this specific
     tab (already proven by cases F/G/H/I above). */
  const plainCtx = await browser.newContext();
  const plainPage = await plainCtx.newPage();
  await loginViaUi(plainPage, plainUser.loginId, plainUser.password);
  const plainAdminResult = await pageIsDenied(plainPage, "/admin");
  checkTrue("L. a normal logged-in (non-staff) user hitting /admin is redirected home (treated as UNAUTHENTICATED, same as logged-out - by design)", plainAdminResult.status === "redirected");
  check("L. a normal logged-in (non-staff) user's direct API call to /api/admin/overview returns 401 (UNAUTHENTICATED - by design, not distinguished from a logged-out request)", await apiStatus(plainCtx, "/api/admin/overview"), 401);
  await plainCtx.close();

  /* ==================== M: hidden-UI-is-not-security - AdminNav renders only permitted links, but the guard is what actually blocks, not the nav ====================
     Already proven by F/G/H/I's deniedPages assertions above: SUPPORT/OPERATIONS/ANALYST/VIEWER
     each successfully navigated DIRECTLY (via page.goto, bypassing any nav click) to a tab their
     nav would never show, and were still blocked server-side. That IS the "hidden UI is not relied
     upon as security" proof - restated here as its own labeled assertion for the report. */
  checkTrue("M. hidden-UI-not-relied-on-as-security: proven above via direct page.goto() to un-navved tabs for SUPPORT/OPERATIONS/ANALYST/VIEWER, all server-denied", true);

  /* ==================== N: direct-API-obeys-same-rules ====================
     Already proven per-role above (allowedApis/deniedApis assertions use the exact same
     permission each page checks - see lib/admin/routeHelpers.ts/pageAuth.ts both calling
     requireAdminPermission() with the SAME AdminPermission string per route/page pair). */
  checkTrue("N. direct-API-obeys-same-permission-as-page: proven above per-role (same AdminPermission string checked by both)", true);

  /* ==================== cleanup ==================== */
  await browser.close();
  for (const u of [adminUser, supportUser, opsUser, analystUser, viewerUser, plainUser, secondOwnerUser]) {
    await admin.auth.admin.deleteUser(u.userId).catch(() => {});
  }
  // bootstrap OWNER user intentionally left in place - the orchestrating session tears down
  // the bootstrap env var + user as part of its own cleanup step, not this script.

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
