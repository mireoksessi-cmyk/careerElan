/*
  Phase 6I.6.35 Part E - real browser exercise of the 4 canonical
  templates through Dashboard's CanonicalTemplatePicker (role=radiogroup,
  cards role=radio, "Selected" badge on the active one - verified from
  source, components/canonicalGeneratePackage/CanonicalTemplatePicker.tsx).
  Display names verified from lib/resumeTemplates/registry/
  templateMetadata.ts (not guessed): "Professional ATS" / "Modern
  Sidebar" / "Executive Minimal" / "Creative Timeline".
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

const TEMPLATE_NAMES = ["Professional ATS", "Modern Sidebar", "Executive Minimal", "Creative Timeline"] as const;
const TEMPLATE_IDS: Record<(typeof TEMPLATE_NAMES)[number], string> = {
  "Professional ATS": "professional-ats",
  "Modern Sidebar": "modern-sidebar",
  "Executive Minimal": "executive-minimal",
  "Creative Timeline": "creative-timeline",
};

let user: E2eTestUser;
let resumeId: string;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "templates");
  const seeded = await seedCanonicalResumeForUser(admin, user, "professional-ats");
  resumeId = seeded.resumeId;
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

async function openPicker(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Change Template" }).click();
  await expect(page.getByRole("radiogroup", { name: "Choose a resume template" })).toBeVisible({ timeout: 10_000 });
}

test.describe("canonical template selection", () => {
  test("A. all 4 canonical templates are offered, none is DPE/original-layout", async ({ page }) => {
    await loginViaUi(page, user);
    await openPicker(page);

    const radiogroup = page.getByRole("radiogroup", { name: "Choose a resume template" });
    for (const name of TEMPLATE_NAMES) {
      await expect(radiogroup.getByRole("radio").filter({ hasText: name })).toBeVisible();
    }
    await expect(radiogroup.getByRole("radio")).toHaveCount(4);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("dpe");
    expect(bodyText.toLowerCase()).not.toContain("original layout");
  });

  test("B. selecting Modern Sidebar persists across refresh and matches DB", async ({ page }) => {
    await loginViaUi(page, user);
    await openPicker(page);

    const radiogroup = page.getByRole("radiogroup", { name: "Choose a resume template" });
    await radiogroup.getByRole("radio").filter({ hasText: "Modern Sidebar" }).click();

    // changeResumeTemplate() (app/dashboard/page.tsx) auto-closes the
    // picker via setTemplatePickerOpenForResumeId(null) once the PUT
    // .../template-preference save succeeds - it does NOT keep the
    // radiogroup open with a "Selected" badge. Closing is the real,
    // observable proof of a successful save; re-opening the picker is
    // how "Selected" becomes visible again.
    await expect(radiogroup).not.toBeVisible({ timeout: 10_000 });

    const admin = adminClient();
    await expect(async () => {
      const { data } = await admin.from("resumes").select("selected_template").eq("id", resumeId).single();
      expect(data?.selected_template).toBe("modern-sidebar");
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await page.getByRole("button", { name: "Change Template" }).click();
    const radiogroupAfterReload = page.getByRole("radiogroup", { name: "Choose a resume template" });
    await expect(radiogroupAfterReload.getByRole("radio").filter({ hasText: "Modern Sidebar" }).getByText("Selected")).toBeVisible({ timeout: 10_000 });
  });

  for (const name of ["Professional ATS", "Executive Minimal", "Creative Timeline"] as const) {
    test(`C. selecting ${name} updates the authoritative selection`, async ({ page }) => {
      await loginViaUi(page, user);
      await openPicker(page);

      const radiogroup = page.getByRole("radiogroup", { name: "Choose a resume template" });
      await radiogroup.getByRole("radio").filter({ hasText: name }).click();
      await expect(radiogroup).not.toBeVisible({ timeout: 10_000 });

      const admin = adminClient();
      await expect(async () => {
        const { data } = await admin.from("resumes").select("selected_template").eq("id", resumeId).single();
        expect(data?.selected_template).toBe(TEMPLATE_IDS[name]);
      }).toPass({ timeout: 10_000 });
    });
  }
});
