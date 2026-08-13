/*
  Phase 2E - Toast + Confirm Dialog system. Verifies the shared
  ToastProvider/ConfirmDialogProvider (components/ui/ToastProvider.tsx,
  components/ui/ConfirmDialogProvider.tsx) that replaced every
  user-facing browser-native alert()/confirm() call in the authenticated
  product UI. A page.on("dialog") listener that fails the test if fired
  proves the branded UI is used instead of a native browser dialog -
  Playwright would otherwise silently auto-dismiss an unhandled native
  dialog, which would hide a regression back to window.alert/confirm.
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
  user = await createSyntheticE2eUser(admin, "toast-confirm");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("Phase 2E toast + confirm dialog system", () => {
  test("T1. A non-destructive action shows a branded toast, not a native alert()", async ({ page }) => {
    let nativeDialogFired = false;
    page.on("dialog", () => {
      nativeDialogFired = true;
    });

    await loginViaUi(page, user);
    await page.goto("/settings");

    // Triggers Settings' changePassword() validation warning - previously
    // alert("Enter a new password."), now toast.warning(...).
    await page.getByRole("button", { name: "Change Password" }).click();

    const toast = page.getByRole("status").filter({ hasText: "Enter a new password." });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    expect(nativeDialogFired).toBe(false);

    const dismissButton = toast.getByRole("button", { name: "Dismiss notification" });
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
    await expect(toast).not.toBeVisible();
  });

  test("T2. A destructive action shows the branded Confirm Dialog; Cancel/Escape prevent it, Confirm performs the same delete", async ({ page }) => {
    let nativeDialogFired = false;
    page.on("dialog", () => {
      nativeDialogFired = true;
    });

    // Disposable E2E-only application row, deleted by this test itself
    // (or by the destructive Confirm path being exercised).
    const { error } = await user.client.from("applications").insert({
      user_id: user.userId,
      company: E2E_EMPLOYER_NAME,
      job_title: E2E_JOB_TITLE,
      status: "saved",
    });
    if (error) throw error;

    await loginViaUi(page, user);
    await page.goto("/job-tracker");

    const card = page.getByRole("button", { name: new RegExp(E2E_EMPLOYER_NAME) });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("heading", { name: E2E_EMPLOYER_NAME, level: 2 })).toBeVisible({ timeout: 10_000 });

    const deleteButton = page.getByRole("button", { name: "Delete Package" });
    await expect(deleteButton).toBeVisible();

    // Cancel prevents the delete.
    await deleteButton.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Delete this job package permanently?")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toBeVisible();

    // Escape also prevents the delete.
    await deleteButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(card).toBeVisible();
    await expect(deleteButton).toBeFocused();

    // Confirm performs the exact same deletion the original confirm()
    // gated - the card disappears and a success toast appears.
    await deleteButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Package deleted." })).toBeVisible({ timeout: 10_000 });
    await expect(card).not.toBeVisible();

    expect(nativeDialogFired).toBe(false);
  });

  test("T3. 375x667: toast and confirm dialog stay within the viewport and add no horizontal overflow of their own", async ({ page }) => {
    /*
      Settings' own "max-w-4xl" content column already exceeds 375px at
      this width (a pre-existing Settings-page layout gap unrelated to
      Phase 2E - out of scope here per the phase's own "do not redesign
      unrelated page layouts" instruction). This test asserts the toast
      and confirm dialog stay fully inside the viewport and never make
      that pre-existing scrollWidth any wider - the bar Phase 2E's own
      components are actually responsible for.
    */
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/settings");
    await page.waitForTimeout(200);
    const baselineScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

    await page.getByRole("button", { name: "Change Password" }).click();
    const toast = page.getByRole("status").filter({ hasText: "Enter a new password." });
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    expect(toastBox).not.toBeNull();
    expect(toastBox!.x).toBeGreaterThanOrEqual(0);
    expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(375 + 1);
    const scrollWidthWithToast = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthWithToast).toBeLessThanOrEqual(baselineScrollWidth);

    await page.getByRole("button", { name: "Log Out" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375 + 1);
    const scrollWidthWithDialog = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthWithDialog).toBeLessThanOrEqual(baselineScrollWidth);

    await page.keyboard.press("Escape");
  });

  test("T4. Confirm Dialog traps Tab/Shift+Tab focus and Escape closes it", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Log Out" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    // Shift+Tab from the first focusable element wraps to the last.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Log Out", exact: true })).toBeFocused();

    // Tab from the last wraps back to the first.
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
});
