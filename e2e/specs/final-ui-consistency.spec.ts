/*
  Phase 2F.5 - Final cross-page visual consistency audit. Verifies the
  presentation-only normalization applied across all 8 authenticated
  pages (shared Sidebar/Header/MobileNav/JobDetail/JobList/CareerInsights/
  FilterBar/StatsCards color-token cleanup, Card adoption on Create
  Package) did not regress page load, responsive layout, or navigation
  on any of them. No AI/external API calls are triggered.
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
  user = await createSyntheticE2eUser(admin, "2f5-consistency");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

const PAGES: Array<{ path: string; heading: RegExp | string }> = [
  { path: "/dashboard", heading: /Good morning|Good afternoon|Good evening/ },
  { path: "/paste-job", heading: /Paste (a )?Job/i },
  { path: "/career-memory", heading: /Career Memory/i },
  { path: "/find-jobs", heading: "Find Jobs in Career Élan" },
  { path: "/job-tracker", heading: "Job Tracker" },
  { path: "/settings", heading: "Settings" },
  { path: "/analytics", heading: "Analytics" },
  { path: "/create-package", heading: "Create Full Package" },
];

test.describe("Phase 2F.5 final cross-page consistency", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} loads for an authenticated user and shows its primary heading`, async ({ page }) => {
      await loginViaUi(page, user);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 10_000 });
    });
  }

  for (const { path } of PAGES) {
    test(`${path} has no horizontal overflow at 375x667`, async ({ page }) => {
      await loginViaUi(page, user);
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(path);
      await page.waitForTimeout(300);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
    });
  }

  for (const { path } of PAGES) {
    test(`${path} has no horizontal overflow at 1440x900`, async ({ page }) => {
      await loginViaUi(page, user);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await page.waitForTimeout(300);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(1440 + 1);
    });
  }

  test("MobileNav hamburger is visible at 375px and hidden at 1440px on Job Tracker", async ({ page }) => {
    await loginViaUi(page, user);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/job-tracker");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
  });

  test("Desktop sidebar is visible at 1440px and hidden at 375px on Analytics", async ({ page }) => {
    await loginViaUi(page, user);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/analytics");
    await expect(page.locator("aside").first()).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await expect(page.locator("aside").first()).toBeHidden();
  });

  test("Job Tracker primary controls (stats, filter, delete-all) remain accessible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/job-tracker");
    await expect(page.getByPlaceholder("Search company...")).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete All/ })).toBeVisible();
  });

  test("Create Package primary CTAs (Find Jobs / Paste Job) remain accessible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.goto("/create-package");
    await expect(page.getByRole("link", { name: /Find Jobs in Career Élan/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Paste Job URL or Description/ })).toBeVisible();
  });
});
