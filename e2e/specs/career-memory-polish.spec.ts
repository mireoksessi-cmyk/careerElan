/*
  Phase 2F.3 - Career Memory design-system polish. Verifies the
  presentation-only changes (Card/Button primitive adoption, shared
  Input/Textarea/Select recipe unification, neutral color
  normalization) did not regress the Career Memory page's structure,
  navigation, or responsive layout. Uses a fresh synthetic user with no
  seeded data - mode always initializes to "start" (see page.tsx's own
  useState<...>("start")), so this exercises the real StartScreen
  entry point without triggering any upload/analysis/generation flow.
*/
import { test, expect } from "@playwright/test";
import {
  adminClient,
  createSyntheticE2eUser,
  cleanupSyntheticE2eUser,
  type E2eTestUser,
} from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "career-memory-polish");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("Phase 2F.3 Career Memory polish", () => {
  test("C1/C2. Authenticated Career Memory page loads and primary sections render", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/career-memory");

    await expect(page.getByRole("heading", { name: "Build Your Career Memory ✨" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /Required sections: \d\/3/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import Your Resume ✨" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cover Letter" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create Resume" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Import Your Resume/ })).toBeVisible();
  });

  test("C3. No horizontal overflow at 375x667", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/career-memory");
    await page.waitForTimeout(300);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });

  test("C4. Mobile navigation still works on Career Memory", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/career-memory");

    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();
    await expect(page.locator("aside").first()).toBeHidden();
    await menuButton.click();
    const dialog = page.getByRole("dialog", { name: "Main navigation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("C5. Desktop 1440 layout shows sidebar, no mobile hamburger duplication", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/career-memory");

    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toHaveCount(0);
  });

  test("C6. Keyboard/focus basics remain valid", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/career-memory");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON"]).toContain(tag);
  });
});
