/*
  Phase 2F.1 - Dashboard design-system polish. Verifies the presentation-only
  changes (Card/Button primitive adoption, Overview/sidebar-widget copy
  fixes, primary CTA prominence) did not regress the Dashboard's structure,
  navigation, or responsive layout. Does not trigger real OpenAI generation -
  only checks that the page renders and its primary controls are present.
*/
import { test, expect } from "@playwright/test";
import { adminClient, createSyntheticE2eUser, seedCanonicalResumeForUser, cleanupSyntheticE2eUser, type E2eTestUser } from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "dashboard-polish");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("Phase 2F.1 Dashboard polish", () => {
  test("D1/D2/D5. Authenticated Dashboard loads with primary CTA and core sections visible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/dashboard");

    await expect(page.getByRole("button", { name: /Create Full Package/ })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recommended Jobs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Career Memory Progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI Usage" })).toBeVisible();
  });

  test("D3. No horizontal overflow at 375x667", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");
    await page.waitForTimeout(300);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });

  test("D4. Mobile navigation still works on Dashboard", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");

    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();
    await expect(page.locator("aside").first()).toBeHidden();

    await menuButton.click();
    const dialog = page.getByRole("dialog", { name: "Main navigation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("D6. Desktop 1440 layout shows sidebar, no mobile hamburger duplication", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");

    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toHaveCount(0);
  });
});
