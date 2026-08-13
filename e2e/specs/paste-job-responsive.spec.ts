/*
  Phase 2C - Paste Job mobile responsive fix. Verifies /paste-job no longer
  forces horizontal scroll at narrow viewports (the content-area overflow
  was unrelated to the Phase 2B mobile-nav work: a chain of flex/grid
  children under app/paste-job/page.tsx's `xl:grid-cols-12` layout had no
  base `grid-cols-1` and no `min-w-0`, so their default `min-width: auto`
  refused to shrink below their preferred content width).
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
  user = await createSyntheticE2eUser(admin, "pastejobresp");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const { innerWidth, scrollWidth } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test.describe("Phase 2C: Paste Job mobile responsive layout", () => {
  test("R1. /paste-job at 375x667 has no horizontal overflow and primary controls are usable", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/paste-job");

    await expect(page.getByRole("heading", { name: "Paste Job URL or Description" })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Primary controls remain reachable and correctly sized.
    await expect(page.getByRole("button", { name: "🔗 Paste URL" })).toBeVisible();
    await expect(page.getByRole("button", { name: "📄 Paste Description" })).toBeVisible();
    await expect(page.getByRole("button", { name: "☁️ Upload File" })).toBeVisible();
    await expect(page.getByPlaceholder("https://www.linkedin.com/jobs/view/1234567890")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze Job" })).toBeVisible();

    // Mobile navigation (Phase 2B) still works on this page.
    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();
    await expect(page.locator("aside").first()).toBeHidden();
    await menuButton.click();
    const dialog = page.getByRole("dialog", { name: "Main navigation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await assertNoHorizontalOverflow(page);
  });

  test("R2. /paste-job at 390x844 has no horizontal overflow", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/paste-job");

    await expect(page.getByRole("heading", { name: "Paste Job URL or Description" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
