/*
  Phase 2E.1 - Settings mobile horizontal overflow fix. Root cause was
  app/settings/page.tsx's outer wrapper missing the `flex-col md:flex-row`
  pattern already used by every other Sidebar-based page (dashboard,
  job-tracker, analytics, career-memory) - without it, Sidebar.tsx's
  Fragment (MobileNav + aside) hoists MobileNav as a row-flex sibling of
  the content <section> instead of stacking above it, pushing content off
  the right edge of the viewport. A secondary contributor was Header.tsx's
  fixed px-8 padding leaving too little room for its icon/profile cluster
  at exactly 320px. This spec locks in scrollWidth <= innerWidth at every
  target breakpoint plus usability of the affected sections.
*/
import { test, expect } from "@playwright/test";
import { adminClient, createSyntheticE2eUser, cleanupSyntheticE2eUser, type E2eTestUser } from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";

let user: E2eTestUser;

test.beforeAll(async () => {
  user = await createSyntheticE2eUser(adminClient(), "settings-responsive");
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

async function expectNoOverflow(page: import("@playwright/test").Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

test.describe("Phase 2E.1 Settings responsive", () => {
  test("R1. 375x667: no horizontal overflow, profile/password/delete sections all visible", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/settings");
    await page.waitForTimeout(200);

    await expectNoOverflow(page, 375);

    await expect(page.getByLabel("Full Name")).toBeVisible();
    await expect(page.getByLabel("Login ID")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();

    await expect(page.getByLabel("New Password")).toBeVisible();
    await expect(page.getByLabel("Confirm Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change Password" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Delete Account" })).toBeVisible();
  });

  test("R2. 375x667: opening the Delete Account modal does not create overflow", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/settings");

    await page.getByRole("button", { name: "Delete Account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Account" });
    await expect(dialog).toBeVisible();

    await expectNoOverflow(page, 375);

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375 + 1);

    await page.keyboard.press("Escape");
  });

  test("R3. 390x844: no horizontal overflow", async ({ page }) => {
    await loginViaUi(page, user);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await page.waitForTimeout(200);
    await expectNoOverflow(page, 390);
  });

  test("R4. 320x568 and 430x932: no horizontal overflow", async ({ page }) => {
    await loginViaUi(page, user);

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/settings");
    await page.waitForTimeout(200);
    await expectNoOverflow(page, 320);

    await page.setViewportSize({ width: 430, height: 932 });
    await page.reload();
    await page.waitForTimeout(200);
    await expectNoOverflow(page, 430);
  });

  test("R5. 768x1024 and 1440x900: desktop/tablet sidebar layout unaffected, no overflow", async ({ page }) => {
    await loginViaUi(page, user);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/settings");
    await page.waitForTimeout(200);
    await expectNoOverflow(page, 768);
    await expect(page.getByRole("link", { name: /Settings/ })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.waitForTimeout(200);
    await expectNoOverflow(page, 1440);
    await expect(page.getByRole("link", { name: /Settings/ })).toBeVisible();
  });
});
