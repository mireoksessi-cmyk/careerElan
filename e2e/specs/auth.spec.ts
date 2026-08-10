/*
  Phase 6I.6.35 - Part G (Auth golden path) + smoke proof that the
  dedicated E2E server/AI-isolation scaffold actually works end to end
  (globalSetup spawned server + synthetic user + fault-injection
  guards), not just that the code compiles.
*/
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { E2E_STATE_FILE } from "../helpers/env";

function loadState() {
  if (!existsSync(E2E_STATE_FILE)) throw new Error("E2E state file missing - globalSetup did not run or failed");
  return JSON.parse(readFileSync(E2E_STATE_FILE, "utf8")) as { userId: string; email: string; password: string };
}

test.describe("auth golden path", () => {
  test("A. logged-out homepage shows Log in / Get Started", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Log in" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Get Started" }).first()).toBeVisible();
  });

  test("B/C/D. native login, protected Dashboard access, refresh persists session", async ({ page }) => {
    const state = loadState();

    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();

    // The "ID" field is looked up against profiles.login_id, which
    // handle_new_user()'s own fallback sets to the email's local-part
    // (split_part(email, '@', 1)) - not the full email address (see
    // fixtures/scripts/runE2E.mts's identical note on this same
    // fallback, and supabase/migrations/20260726220000_legal_consent_
    // columns.sql's handle_new_user() definition).
    const loginId = state.email.split("@")[0];
    const idInput = page.getByPlaceholder("ID");
    await expect(idInput).toBeVisible();
    await idInput.fill(loginId);
    await page.getByPlaceholder("Password").fill(state.password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Dashboard is the protected post-login destination.
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // D. Refresh persists session (protected route stays accessible, no redirect to /).
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);

    // C. Direct protected URL access while authenticated.
    await page.goto("/job-tracker");
    await expect(page).toHaveURL(/\/job-tracker/);
  });
});
