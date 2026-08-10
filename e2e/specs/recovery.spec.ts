/*
  Phase 6I.6.35 Part H - the refresh/recovery golden path (P1 gap #1
  from Phase 6I.6.34): Generate Package -> refresh mid-generation ->
  page reload resumes via sessionStorage recovery (app/paste-job/
  page.tsx's own recovery useEffect - readActiveGeneration() +
  beginPolling(..., {persist:false, immediate:true})) -> completes ->
  exactly one logical application, never a second one created merely
  because the page refreshed -> Job Tracker shows the same application.
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
import { E2E_SUPPORTED_JOB_POSTING } from "../helpers/jobPostings";
import { E2E_JOB_TITLE, E2E_EMPLOYER_NAME } from "../../lib/testing/e2eMarkers";

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "recovery");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

test.describe("refresh/recovery golden path", () => {
  test("H. refreshing mid-generation resumes via sessionStorage recovery and produces exactly one application", async ({ page }) => {
    /*
      Generation legitimately takes several seconds even with the
      deterministic E2E path (claim -> enqueue -> worker -> canonical
      tailoring -> render -> persist), matching the observed ~8-9s
      total in golden-path.spec.ts's own timing - budget generously
      above playwright.config.ts's 60s default so the post-reload
      completion wait (up to 120s, mirroring the UI's own "1 to 2
      minutes" copy) always fits inside the test's own timeout.
    */
    test.setTimeout(150_000);

    await loginViaUi(page, user);
    await page.goto("/paste-job");
    await page.getByRole("button", { name: "📄 Paste Description" }).click();
    await page.getByPlaceholder("Paste the full job description here...").fill(E2E_SUPPORTED_JOB_POSTING);
    await page.getByRole("button", { name: "Analyze Job" }).click();
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    const generateButton = page.getByRole("button", {
      name: /Generate Full Package|Submitting Request|Generating Package|Your package is ready/,
    });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });

    /*
      writeActiveGeneration() (app/paste-job/page.tsx's beginPolling())
      only runs AFTER the initial POST /api/generate-package claim/
      enqueue call resolves - waitForResponse() here waits for that
      exact response, so the reload below is guaranteed to land after
      the sessionStorage entry actually exists. A bare click()+immediate
      reload() (tried first) reloads before that response even arrives,
      landing on a still-idle page and proving nothing about recovery.
    */
    const [enqueueResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/generate-package") && res.request().method() === "POST"),
      generateButton.click(),
    ]);
    expect(enqueueResponse.ok()).toBeTruthy();

    /*
      One more explicit signal beyond the raw HTTP response: the
      "Generating Package..."/"Submitting Request..." button copy only
      renders after setGenerationPhase("pending") runs, which happens in
      the same beginPolling() call right after the sessionStorage write
      - waiting for it closes the last timing gap between "response
      arrived" and "React has applied the resulting state," so the
      reload is guaranteed to observe a real in-flight generation.
    */
    await expect(page.getByText(/Submitting Request|Generating Package/)).toBeVisible({ timeout: 5_000 });

    await page.reload();

    /*
      Either signal proves the SAME logical generation was recovered,
      not a fresh one silently started: the explicit resuming message
      (readActiveGeneration() found the stored entry and beginPolling()
      fired), or - if the race was lost and generation had already
      finished by the time the reload's own recovery effect ran - the
      success state appearing without ever showing an empty/blank Paste
      Job form in between.
    */
    await expect(
      page
        .getByText("Resuming a previously started application package generation...")
        .or(page.getByText("✅ Your package is ready"))
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("✅ Your package is ready")).toBeVisible({ timeout: 120_000 });

    const admin = adminClient();
    const { data: apps } = await admin
      .from("applications")
      .select("id, generation_status")
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE);

    expect(apps).toHaveLength(1);
    expect(apps![0].generation_status).toBe("succeeded");

    await page.goto("/job-tracker");
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 15_000 });
  });
});
