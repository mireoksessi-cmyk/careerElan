/*
  Phase 6I.6.31B - dedicated automated auth regression suite (Part R).
  Phase 6I.6.31 built middleware-based protection for 8 routes but added no
  automated coverage; this file closes that gap. Every test either performs
  a real HTTP request against the running dev server (no cookies, or a real
  cookie jar from a real Playwright login), or a real supabase-js call
  against the running local Supabase instance - no string-search-only
  fake tests, per the phase spec's explicit instruction.

  Requires: local Supabase running (127.0.0.1:54321) AND the dev server
  running on localhost:3001 (`npm run dev`), matching Phase 6I.6.31's own
  established local-UAT setup.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i631bAuthRegression.realdb.test.mts
*/
import { URL as NodeURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { chromium } from "playwright";

const SUPABASE_URL = "http://127.0.0.1:54321";
const APP_URL = "http://localhost:3001";
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
function checkTrue(label: string, actual: boolean, note?: string) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ? `(${note})` : "");
  if (actual) pass++;
  else fail++;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PROTECTED_PATHS = [
  "/dashboard",
  "/career-memory",
  "/find-jobs",
  "/paste-job",
  "/create-package",
  "/job-tracker",
  "/analytics",
  "/settings",
];

const PUBLIC_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
];

async function makeNativeUser(prefix: string) {
  const email = `phase6i631b-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "Phase6i631bTest!23";
  const loginId = `p6i631b${prefix}${Date.now().toString().slice(-6)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `Phase 6I.6.31B ${prefix}`,
      login_id: loginId,
      legal_consent: true,
      consent_source: "email_signup",
    },
  });
  if (error) throw error;
  return { userId: data.user.id, email, password, loginId };
}

async function main() {
  console.log("=== Phase 6I.6.31B Auth Regression Suite ===");

  /* ==================== TEST A / F / H - public route matrix, logged out ==================== */
  for (const path of [...PUBLIC_PATHS, "/login", "/signup"]) {
    const res = await fetch(`${APP_URL}${path}`, { redirect: "manual" });
    checkTrue(`TEST A/F/H: public ${path} reachable (status ${res.status})`, res.status === 200);
  }

  /* ==================== TEST G - /auth/callback excluded from protected guard ==================== */
  {
    const res = await fetch(`${APP_URL}/auth/callback`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    checkTrue(
      "TEST G: /auth/callback (no code) redirects to its own error path, not blocked by protected guard",
      (res.status === 307 || res.status === 302) && location.includes("authError=missing_code"),
      `status=${res.status} location=${location}`
    );
  }

  /* ==================== TEST C / E - protected route matrix, logged out ==================== */
  for (const path of PROTECTED_PATHS) {
    const res = await fetch(`${APP_URL}${path}`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isRedirectToHome = (res.status === 307 || res.status === 302) && new NodeURL(location, APP_URL).pathname === "/";
    checkTrue(`TEST C/E: protected ${path} logged-out -> redirected to "/" (status ${res.status})`, isRedirectToHome, `location=${location}`);
  }

  /* ==================== TEST I - no protected content ever reaches a logged-out client ==================== */
  {
    const res = await fetch(`${APP_URL}/job-tracker`, { redirect: "follow" });
    const body = await res.text();
    checkTrue(
      "TEST I: logged-out /job-tracker never renders Job Tracker page content (server redirected before any render)",
      !body.includes("Total Applications") && !body.includes("id=\"job-tracker-root\""),
      "followed redirect body should be the homepage, not Job Tracker markup"
    );
  }

  /* ==================== TEST L / M - Google/Facebook OAuth provider wiring (real call) ==================== */
  {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    for (const provider of ["google", "facebook"] as const) {
      const { data, error } = await anon.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${APP_URL}/auth/callback`, skipBrowserRedirect: true },
      });
      checkTrue(
        `TEST ${provider === "google" ? "L" : "M"}: signInWithOAuth(provider="${provider}") returns a real authorize URL for that provider`,
        !error && typeof data?.url === "string" && data.url.includes(`provider=${provider}`),
        `error=${error?.message} url=${data?.url}`
      );
    }
  }

  /* ==================== TEST N - native login wiring (real signInWithPassword) ==================== */
  const nativeUser = await makeNativeUser("native");
  {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await anon.auth.signInWithPassword({
      email: nativeUser.email,
      password: nativeUser.password,
    });
    checkTrue(
      "TEST N: real signInWithPassword() succeeds for a confirmed native account and returns the matching user id",
      !error && data.user?.id === nativeUser.userId,
      error?.message
    );
  }

  /* ==================== TEST O - native signup wiring (real signUp) ==================== */
  {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const freshEmail = `phase6i631b-signup-${Date.now()}@example.test`;
    const { data, error } = await anon.auth.signUp({
      email: freshEmail,
      password: "Phase6i631bTest!23",
      options: { data: { full_name: "Phase Signup Wiring", login_id: `p6i631bsu${Date.now().toString().slice(-6)}`, legal_consent: true, consent_source: "email_signup" } },
    });
    checkTrue(
      "TEST O: real signUp() succeeds and returns a user (auto-confirmed locally -> session present)",
      !error && Boolean(data.user),
      error?.message
    );
    if (data.user) await admin.auth.admin.deleteUser(data.user.id);
  }

  /* ==================== TEST P / Q - password recovery wiring + open-redirect prevention (real round trip via Mailpit) ==================== */
  {
    const recoveryUser = await makeNativeUser("recovery");
    const jar = new Map<string, string>();
    const browserClient = createBrowserClient(SUPABASE_URL, ANON_KEY, {
      auth: { flowType: "pkce" },
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookies: { name: string; value: string }[]) => {
          for (const c of cookies) jar.set(c.name, c.value);
        },
      },
    });

    const { error: resetError } = await browserClient.auth.resetPasswordForEmail(recoveryUser.email, {
      redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent("/?resetPassword=true")}`,
    });
    checkTrue("TEST P: real resetPasswordForEmail() call succeeds (no error)", !resetError, resetError?.message);

    await new Promise((r) => setTimeout(r, 1500));

    const listRes = await fetch("http://127.0.0.1:54324/api/v1/messages");
    const list = await listRes.json();
    const mine = (list.messages || []).find((m: any) => m.To?.[0]?.Address === recoveryUser.email);
    checkTrue("TEST P: real recovery email captured for the test account", Boolean(mine));

    if (mine) {
      const msgRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${mine.ID}`);
      const msg = await msgRes.json();
      const verifyUrlMatch = (msg.Text as string).match(/\(\s*(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s)]+)\s*\)/);
      const verifyUrl = verifyUrlMatch?.[1];
      checkTrue("TEST P: recovery email contains a verify link", Boolean(verifyUrl));

      if (verifyUrl) {
        const verifyRes = await fetch(verifyUrl, { redirect: "manual" });
        const gotrueLocation = verifyRes.headers.get("location") || "";
        const code = gotrueLocation ? new NodeURL(gotrueLocation, SUPABASE_URL).searchParams.get("code") : null;
        checkTrue("TEST P: GoTrue verify step issues a real PKCE code", Boolean(code));

        const verifierValue = jar.get("sb-127-auth-token-code-verifier");
        if (code && verifierValue) {
          /*
            TEST Q - real, causal open-redirect proof: exchange the real code
            against our OWN app's callback route with a malicious `next`
            pointing off-site, and confirm the app never redirects there.
          */
          const maliciousNext = encodeURIComponent("https://evil.example.com");
          const cbRes = await fetch(`${APP_URL}/auth/callback?code=${code}&next=${maliciousNext}`, {
            redirect: "manual",
            headers: { Cookie: `sb-127-auth-token-code-verifier=${verifierValue}` },
          });
          const cbLocation = cbRes.headers.get("location") || "";
          checkTrue(
            "TEST Q: /auth/callback with a real code + malicious next never redirects off-site",
            (cbRes.status === 307 || cbRes.status === 302) && new NodeURL(cbLocation, APP_URL).host === new NodeURL(APP_URL).host,
            `location=${cbLocation}`
          );
        } else {
          checkTrue("TEST Q: open-redirect proof (skipped - could not obtain code/verifier pair)", false, "see PART L in Korean report");
        }
      }
    }
    await admin.auth.admin.deleteUser(recoveryUser.userId);
  }

  /* ==================== Browser-driven tests: B / D / J / K (real Playwright session) ==================== */
  const browser = await chromium.launch();
  const page = await browser.newPage();

  /* TEST K (logged-out half) - public Header shows Log in/Get Started */
  await page.goto(`${APP_URL}/`);
  await page.waitForSelector('button:has-text("Log in")', { timeout: 10000 });
  const loggedOutHeaderText = await page.locator("body").innerText();
  checkTrue("TEST K: logged-out Header shows Log in / Get Started", loggedOutHeaderText.includes("Log in") && loggedOutHeaderText.includes("Get Started"));

  /* Real native login through the actual homepage modal (not a shortcut) */
  await page.getByRole("button", { name: "Log in", exact: true }).first().click();
  await page.locator('input[placeholder="ID"]').fill(nativeUser.loginId);
  await page.locator('input[placeholder="Password"]').fill(nativeUser.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/career-memory" || url.pathname === "/dashboard", { timeout: 15000 });
  checkTrue("TEST N (browser): real UI login via ID+password reaches an authenticated page", true);

  /* TEST D / E (logged-in half) - all 8 protected routes reachable while authenticated */
  for (const path of PROTECTED_PATHS) {
    await page.goto(`${APP_URL}${path}`);
    const finalPath = new NodeURL(page.url()).pathname;
    checkTrue(`TEST D/E: protected ${path} logged-in -> stays on ${path} (no redirect)`, finalPath === path, `final=${finalPath}`);
  }

  /* TEST K (logged-in half) - public page no longer shows auth CTAs */
  await page.goto(`${APP_URL}/features`);
  const loggedInHeaderText = await page.locator("body").innerText();
  checkTrue(
    "TEST K: logged-in Header on /features has no Log in / Get Started CTA",
    !loggedInHeaderText.includes("Log in") && !loggedInHeaderText.includes("Get Started")
  );

  /* TEST R - Footer/public navigation link clicks do not sign the user out */
  await page.locator('a[href="/pricing"]').first().click();
  await page.waitForURL((url) => url.pathname === "/pricing");
  await page.goto(`${APP_URL}/dashboard`);
  checkTrue("TEST R: navigating public Footer/Header links did not sign the user out (dashboard still reachable)", new NodeURL(page.url()).pathname === "/dashboard");

  /* TEST J - logout transition */
  await page.goto(`${APP_URL}/settings`);
  await page.evaluate(() => {
    // @ts-ignore - test-harness-only override so the native confirm() dialog doesn't block automated logout
    window.confirm = () => true;
  });
  await page.locator("button", { hasText: "Log Out" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await page.goto(`${APP_URL}/dashboard`);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  checkTrue("TEST J: after real logout, /dashboard is protected again (redirected to \"/\")", new NodeURL(page.url()).pathname === "/");

  await browser.close();

  /* ==================== TEST S / Part U - cross-user ownership (RLS), no request-controlled user id ==================== */
  {
    const userA = await makeNativeUser("crossA");
    const userB = await makeNativeUser("crossB");

    const clientA = createClient(SUPABASE_URL, ANON_KEY);
    await clientA.auth.signInWithPassword({ email: userA.email, password: userA.password });
    await clientA.from("career_memory").upsert({ user_id: userA.userId, required_completed: true });

    const clientB = createClient(SUPABASE_URL, ANON_KEY);
    await clientB.auth.signInWithPassword({ email: userB.email, password: userB.password });

    /* User B explicitly queries for User A's row by id - RLS must return nothing. */
    const { data: crossRead, error: crossReadError } = await clientB
      .from("career_memory")
      .select("user_id")
      .eq("user_id", userA.userId);
    checkTrue(
      "TEST S/Part U: User B querying User A's career_memory row by explicit id returns zero rows (RLS enforced, not query-controlled)",
      !crossReadError && Array.isArray(crossRead) && crossRead.length === 0,
      `error=${crossReadError?.message} rows=${crossRead?.length}`
    );

    /* User B attempting to write a row claiming User A's id must be rejected. */
    const { error: crossWriteError } = await clientB
      .from("career_memory")
      .upsert({ user_id: userA.userId, required_completed: true });
    checkTrue(
      "TEST S/Part U: User B cannot write a career_memory row under User A's user_id (RLS rejects, no request-controlled auth source)",
      Boolean(crossWriteError),
      crossWriteError ? "rejected as expected" : "write unexpectedly succeeded"
    );

    await admin.auth.admin.deleteUser(userA.userId);
    await admin.auth.admin.deleteUser(userB.userId);
  }

  await admin.auth.admin.deleteUser(nativeUser.userId);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (${pass + fail} total) ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SUITE ERROR:", err);
  process.exit(1);
});
