/*
  Phase 2F.4 - Find Jobs design-system polish. Verifies the
  presentation-only changes (Card/Button primitive adoption, neutral
  color normalization, input/select recipe unification, empty-state
  placeholder) did not regress the Find Jobs page's structure,
  navigation, or responsive layout. No real search is triggered here -
  /api/search-jobs has no deterministic E2E fake and calls a real
  external job-search provider (JSearch), so these tests only exercise
  the page's default (pre-search) state.
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
  user = await createSyntheticE2eUser(admin, "find-jobs-polish");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("Phase 2F.4 Find Jobs polish", () => {
  test("F1/F2. Authenticated Find Jobs page loads and primary search/filter controls are visible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/find-jobs");

    await expect(page.getByRole("heading", { name: "Find Jobs in Career Élan" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("Search job title, company, or keyword...")).toBeVisible();
    await expect(page.getByPlaceholder("Search city...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
    await expect(page.getByText("No jobs to display yet.")).toBeVisible();
  });

  test("F3. No horizontal overflow at 375x667", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/find-jobs");
    await page.waitForTimeout(300);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });

  test("F4. Desktop 1440 layout shows sidebar, no mobile hamburger duplication", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/find-jobs");

    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Main navigation" })).toHaveCount(0);
  });

  test("F5. Primary accessible names/buttons remain available", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/find-jobs");

    await expect(page.getByRole("link", { name: /Back to Choose Method/ })).toBeVisible();
    await expect(page.getByRole("combobox").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeEnabled();
  });
});
