/*
  Phase 2B - mobile navigation drawer. Verifies the MobileNav component
  (components/job-layout/MobileNav.tsx) that replaced the old
  full-width-block mobile sidebar: at narrow viewports the desktop
  <aside> is hidden and a compact top app bar + slide-in drawer take
  over, reusing the same primary destinations as desktop.
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

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "mobilenav");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

test.describe("Phase 2B: mobile navigation drawer", () => {
  test("M1. Dashboard at 375x667 hides the desktop sidebar and the drawer opens/closes via every method", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");

    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();
    await expect(page.locator("aside").first()).toBeHidden();

    // Open via menu button.
    await menuButton.click();
    const dialog = page.getByRole("dialog", { name: "Main navigation" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    // Close via backdrop click. The drawer panel is a left-anchored 85%-width
    // overlay, so click a point on the right strip that is backdrop, not panel.
    await page.locator('div[aria-hidden="true"].absolute.inset-0').click({ position: { x: 360, y: 300 } });
    await expect(dialog).toBeHidden();

    // Close via Escape.
    await menuButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuButton).toBeFocused();

    // Close via selecting a nav item, and navigate to the right route.
    await menuButton.click();
    await dialog.getByRole("link", { name: "Settings" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForURL("**/settings", { timeout: 10_000 });
  });

  test("M2. Dashboard at 1440x900 shows the desktop sidebar with no mobile drawer artifacts", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");

    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toHaveCount(0);
  });
});
