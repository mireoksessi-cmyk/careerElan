/*
  Phase 2D - Form & Modal Accessibility Polish. Minimum assertions
  A1-A8 required by the phase spec: form labels resolve via a real
  programmatic accessible name, dialogs expose correct ARIA semantics,
  icon-only controls have accessible names, Job Tracker's converted
  div-to-button cards are keyboard operable, and MobileNav (built in
  Phase 2B) still behaves correctly after this phase's shared changes.
  No destructive forms are ever submitted (Delete Account is opened
  and cancelled, never confirmed).
*/
import { test, expect } from "@playwright/test";
import {
  adminClient,
  createSyntheticE2eUser,
  seedCanonicalResumeForUser,
  cleanupSyntheticE2eUser,
  type E2eTestUser,
} from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";
import { E2E_EMPLOYER_NAME, E2E_JOB_TITLE } from "../../lib/testing/e2eMarkers";

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "a11y-basics");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
  // One minimal real application row (same pattern as
  // aiRoutesDirect.spec.ts) so the Job Tracker keyboard-access test
  // (A7) has a real card to focus, without running a real generation.
  const { error } = await user.client.from("applications").insert({
    user_id: user.userId,
    company: E2E_EMPLOYER_NAME,
    job_title: E2E_JOB_TITLE,
    status: "saved",
  });
  if (error) throw error;
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("Phase 2D accessibility basics", () => {
  test("A1/A3/A4. /login route has properly labelled fields and correct auth dialog semantics", async ({ page }) => {
    await page.goto("/login");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const labelledbyId = await dialog.getAttribute("aria-labelledby");
    expect(labelledbyId).toBeTruthy();
    await expect(page.locator(`#${labelledbyId}`)).toBeVisible();

    const closeButton = page.getByRole("button", { name: "Close" });
    await expect(closeButton).toBeVisible();

    const idInput = page.getByPlaceholder("ID");
    const idInputId = await idInput.getAttribute("id");
    expect(idInputId).toBeTruthy();
    await expect(page.locator(`label[for="${idInputId}"]`)).toHaveClass(/sr-only/);

    const pwInput = page.getByPlaceholder("Password");
    const pwInputId = await pwInput.getAttribute("id");
    expect(pwInputId).toBeTruthy();
    await expect(page.locator(`label[for="${pwInputId}"]`)).toHaveCount(1);
  });

  test("A2. /signup route has properly labelled fields", async ({ page }) => {
    await page.goto("/signup");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const fullNameInput = page.getByPlaceholder("Full name");
    const fullNameId = await fullNameInput.getAttribute("id");
    expect(fullNameId).toBeTruthy();
    await expect(page.locator(`label[for="${fullNameId}"]`)).toHaveCount(1);
  });

  test("A5/A6. Settings form labels map to inputs and the delete-account modal has correct dialog semantics", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/settings");

    for (const id of ["settings-full-name", "settings-login-id", "settings-email", "settings-phone", "settings-timezone", "settings-new-password", "settings-confirm-password"]) {
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    await page.getByRole("button", { name: "Delete Account" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("aria-modal", "true");
    const labelledbyId = await modal.getAttribute("aria-labelledby");
    expect(labelledbyId).toBeTruthy();
    await expect(page.locator(`#${labelledbyId}`)).toHaveText("Delete Account");

    // Cancel, never confirm - this must never actually delete the account.
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeFocused();
    await cancelButton.click();
    await expect(modal).not.toBeVisible();
  });

  test("A7. Job Tracker application card is keyboard accessible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/job-tracker");

    const card = page.getByRole("button", { name: new RegExp(E2E_EMPLOYER_NAME) });
    await expect(card).toBeVisible();
    await card.focus();
    await expect(card).toBeFocused();
    await card.press("Enter");
    await expect(page.getByRole("heading", { name: E2E_EMPLOYER_NAME, level: 2 })).toBeVisible({ timeout: 10_000 });
  });

  test("A8. MobileNav retains keyboard/Escape behavior after Phase 2D changes", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");

    const openButton = page.getByRole("button", { name: "Open navigation" });
    await expect(openButton).toBeVisible();
    await openButton.click();

    const nav = page.getByRole("dialog", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(nav).not.toBeVisible();
    await expect(openButton).toBeFocused();
  });
});
