/*
  Phase 6I.6.35 Parts M/N/O - Job Tracker end-to-end (real display/
  download/persistence after a real generation), cross-user RLS
  isolation (User B can never see User A's application via the UI list,
  a guessed direct id, or the status API), and logout ending the golden
  path (session removed, protected routes blocked again).
*/
import { test, expect } from "@playwright/test";
import { readFile } from "fs/promises";
import {
  adminClient,
  createSyntheticE2eUser,
  seedCanonicalResumeForUser,
  cleanupSyntheticE2eUser,
  type E2eTestUser,
} from "../helpers/testUser";
import { loginViaUi, logoutViaUi } from "../helpers/uiActions";
import { E2E_SUPPORTED_JOB_POSTING } from "../helpers/jobPostings";
import { E2E_JOB_TITLE, E2E_EMPLOYER_NAME, E2E_COVER_MARKER, E2E_EMAIL_MARKER } from "../../lib/testing/e2eMarkers";

let userA: E2eTestUser;
let userB: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  userA = await createSyntheticE2eUser(admin, "isolation-a");
  await seedCanonicalResumeForUser(admin, userA, "professional-ats");
  userB = await createSyntheticE2eUser(admin, "isolation-b");
  await seedCanonicalResumeForUser(admin, userB, "modern-sidebar");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, userA.userId);
  await cleanupSyntheticE2eUser(admin, userB.userId);
});

/*
  Shared by both M and N - generates one real package for userA through
  the actual Paste Job UI (same pattern as golden-path.spec.ts's test
  G), so Job Tracker/cross-user tests exercise a real, DB-persisted
  application rather than a hand-inserted row.
*/
async function generatePackageForUserA(page: import("@playwright/test").Page): Promise<string> {
  await loginViaUi(page, userA);
  await page.goto("/paste-job");
  await page.getByRole("button", { name: "📄 Paste Description" }).click();
  await page.getByPlaceholder("Paste the full job description here...").fill(E2E_SUPPORTED_JOB_POSTING);
  await page.getByRole("button", { name: "Analyze Job" }).click();
  await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

  const generateButton = page.getByRole("button", {
    name: /Generate Full Package|Submitting Request|Generating Package|Your package is ready/,
  });
  await expect(generateButton).toBeEnabled({ timeout: 10_000 });
  await generateButton.click();
  await expect(page.getByText("✅ Your package is ready")).toBeVisible({ timeout: 120_000 });

  const admin = adminClient();
  const { data: myApp } = await admin
    .from("applications")
    .select("id")
    .eq("user_id", userA.userId)
    .eq("job_title", E2E_JOB_TITLE)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return myApp!.id;
}

test.describe("Job Tracker end-to-end + cross-user isolation + logout", () => {
  test("M. Job Tracker shows the real generated application, downloads work, and state persists across refresh/navigation", async ({ page }) => {
    test.setTimeout(150_000);
    await generatePackageForUserA(page);

    await page.goto("/job-tracker");
    await page.getByText(E2E_EMPLOYER_NAME).first().click();
    /*
      Both JobList's own card (an <h3>) and JobDetail's header (an
      <h2>) render the same company text once a card is selected -
      level:2 picks only the detail panel's heading.
      */
    await expect(page.getByRole("heading", { name: E2E_EMPLOYER_NAME, level: 2 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(E2E_JOB_TITLE).first()).toBeVisible();

    await page.getByRole("button", { name: "Cover Letter", exact: true }).click();
    const coverTextarea = page.locator("textarea:not([placeholder])").first();
    await expect(coverTextarea).toHaveValue(new RegExp(E2E_COVER_MARKER));

    await page.getByRole("button", { name: "Email", exact: true }).click();
    await expect(page.getByText(new RegExp(E2E_EMAIL_MARKER))).toBeVisible();

    // Resume tab download regenerates on demand for a canonical
    // application (0 AI calls, 0 quota - see downloadPackage() in
    // app/job-tracker/page.tsx's own header comment) via a real
    // <a download> + blob URL.
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();
    const pdfBytes = await readFile(pdfPath!);
    expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const [docxDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Word" }).click(),
    ]);
    const docxPath = await docxDownload.path();
    expect(docxPath).toBeTruthy();
    const docxBytes = await readFile(docxPath!);
    expect(docxBytes.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");

    // Refresh, then navigate away and back - the same application must
    // still be listed and re-selectable, nothing silently lost.
    await page.reload();
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 10_000 });

    await page.goto("/dashboard");
    await page.goto("/job-tracker");
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 10_000 });
  });

  test("N. User B can never see User A's application via the Job Tracker list, a guessed direct id, or the status API", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const applicationId = await generatePackageForUserA(page);

    /*
      A genuinely separate authenticated browser context for User B
      (real login, real session cookies) - not a service-role bypass -
      matching the spec's own "use real authenticated browser/API
      requests, not service_role" requirement for this check.
    */
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginViaUi(pageB, userB);

    await pageB.goto("/job-tracker");
    await expect(pageB.getByText(E2E_EMPLOYER_NAME)).toHaveCount(0);

    // Guessed/direct id via the same status API the app itself polls -
    // must 404 (RLS-scoped .eq("user_id", user.id), never leak User A's
    // data or even confirm the id exists for a different owner).
    const statusResponse = await pageB.request.get(`/api/applications/${applicationId}/status`);
    expect(statusResponse.status()).toBe(404);
    const statusBody = await statusResponse.json();
    expect(JSON.stringify(statusBody)).not.toContain(E2E_JOB_TITLE);
    expect(JSON.stringify(statusBody)).not.toContain(E2E_EMPLOYER_NAME);

    await contextB.close();
  });

  test("O. Logout ends the session and blocks protected routes again", async ({ page }) => {
    await loginViaUi(page, userA);
    await page.goto("/job-tracker");
    await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible({ timeout: 10_000 });

    await logoutViaUi(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 10_000 });

    await page.goto("/job-tracker");
    await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 10_000 });
  });
});
