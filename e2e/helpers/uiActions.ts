/*
  Phase 6I.6.35 - shared UI actions reused across every spec file that
  needs a real, logged-in browser session (never a cookie/localStorage
  shortcut - Part B explicitly requires the real login modal). Kept
  here once so the login_id-is-the-email's-local-part fact (see
  auth.spec.ts's own comment - handle_new_user()'s fallback,
  supabase/migrations/20260726220000_legal_consent_columns.sql) and
  the exact selectors only need fixing in one place if the UI changes.
*/
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function loginViaUi(page: Page, creds: { email: string; password: string }): Promise<void> {
  const loginId = creds.email.split("@")[0];

  await page.goto("/");
  await page.getByRole("button", { name: "Log in" }).first().click();

  const idInput = page.getByPlaceholder("ID");
  await expect(idInput).toBeVisible();
  await idInput.fill(loginId);
  await page.getByPlaceholder("Password").fill(creds.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Post-login destination depends on career_memory.required_completed
  // (PublicAuthActions.tsx's handleEmailLogin()) - callers that seeded
  // a complete profile land on /dashboard; callers that didn't land on
  // /career-memory. Wait for either, let the caller assert the exact
  // one it expects.
  await page.waitForURL(/\/(dashboard|career-memory)/, { timeout: 15_000 });
  await dismissWelcomeTourIfPresent(page);
}

/*
  Dashboard shows a first-visit "Welcome to Career Élan" tour modal
  (app/dashboard/page.tsx, gated by localStorage.careerElanTourSeen)
  that every freshly-created synthetic E2E user hits, since their
  browser context has never set that key. The modal's overlay
  intercepts pointer events for any later click (e.g. "Change
  Template"), even though it doesn't block text assertions - this
  caused templates.spec.ts to time out on its first real run.
  closeTour() persists the dismissal to localStorage, so calling this
  once per fresh page/context is enough; a later page.reload() in the
  same test won't re-show it.
*/
export async function dismissWelcomeTourIfPresent(page: Page): Promise<void> {
  // Locator.isVisible() does not wait (Playwright ignores its timeout
  // option), and showTour is set from a useEffect after data loads, so
  // a real wait is required here - waitFor()'s timeout rejects instead
  // of resolving false, hence the try/catch to treat "never appeared"
  // as the normal, expected case for most callers/pages.
  const skipButton = page.getByRole("button", { name: "Skip for now" });
  try {
    await skipButton.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  await skipButton.click();
  await expect(skipButton).not.toBeVisible({ timeout: 5_000 });
}

export async function logoutViaUi(page: Page): Promise<void> {
  await page.goto("/settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Log Out" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
}
