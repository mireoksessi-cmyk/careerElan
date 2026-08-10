/*
  Phase 6I.6.35B Part 3 - direct, real HTTP proof that the four AI
  routes hardened in 6I.6.35 (recommend-jobs, career-insight,
  analytics-summary, analyze-job-url) all take the deterministic
  E2E-fake branch and never reach OpenAI, exercised directly rather
  than only incidentally via other flows (recommend-jobs was already
  incidentally covered by every spec's own Dashboard visit through
  loginViaUi(), but that never asserted anything about ITS response -
  it only happened to not crash the page).

  Each request goes through a REAL authenticated session (real login,
  real cookies via page.request, not a service-role bypass) so RLS and
  auth are exercised for real, not skipped. Each assertion checks for
  the specific deterministic marker text only e2eFakeResponses.ts's
  fake builders ever produce - a real OpenAI response could not
  accidentally satisfy these (E2E_PACKAGE_ANALYSIS_MARKER is not a
  string any real model output would contain).
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
import { E2E_PACKAGE_ANALYSIS_MARKER, E2E_JOB_TITLE, E2E_EMPLOYER_NAME } from "../../lib/testing/e2eMarkers";

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "ai-routes-direct");
  await seedCanonicalResumeForUser(admin, user, "professional-ats");
  // analytics-summary's computeAnalyticsInput() early-returns
  // NO_DATA_SUMMARY (never reaching the OpenAI branch at all) when the
  // caller owns zero applications rows - seed exactly one minimal real
  // row via this user's own RLS-scoped client so the route actually
  // has to run its real aggregation + AI-branch logic.
  const { error } = await user.client.from("applications").insert({
    user_id: user.userId,
    company: E2E_EMPLOYER_NAME,
    job_title: E2E_JOB_TITLE,
    status: "saved",
  });
  if (error) throw error;
});

test.afterAll(async () => {
  await cleanupSyntheticE2eUser(adminClient(), user.userId);
});

test.describe("direct AI-route exercise (Phase 6I.6.35B Part 3)", () => {
  test("P. /api/analyze-job-url uses the deterministic E2E fake and never reaches OpenAI", async ({ page }) => {
    await loginViaUi(page, user);

    const res = await page.request.post("/api/analyze-job-url", {
      data: { jobUrl: "http://127.0.0.1:3101/how-it-works" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.title).toBe(E2E_JOB_TITLE);
    expect(body.company).toBe(E2E_EMPLOYER_NAME);
    expect(body.summary).toContain(E2E_PACKAGE_ANALYSIS_MARKER);
  });

  test("Q. /api/analytics-summary uses the deterministic E2E fake and never reaches OpenAI", async ({ page }) => {
    await loginViaUi(page, user);

    const res = await page.request.post("/api/analytics-summary", { data: {} });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.summary).toContain(E2E_PACKAGE_ANALYSIS_MARKER);
    expect(body.cached).toBe(false);
  });

  test("R. /api/recommend-jobs uses the deterministic E2E fake and never reaches OpenAI", async ({ page }) => {
    await loginViaUi(page, user);

    const res = await page.request.post("/api/recommend-jobs", {
      data: { selectedResumeSource: "uploaded", selectedResumeId: (await adminClient().from("resumes").select("id").eq("user_id", user.userId).single()).data!.id },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs.length).toBeGreaterThan(0);
    expect(body.jobs.some((job: { title: string }) => job.title.includes(E2E_PACKAGE_ANALYSIS_MARKER))).toBe(true);
  });

  test("S. /api/career-insight uses the deterministic E2E fake and never reaches OpenAI", async ({ page }) => {
    await loginViaUi(page, user);

    const res = await page.request.post("/api/career-insight", {
      data: {
        resume_text: "E2E-RESUME-MARKER-635 deterministic synthetic resume text.",
        job_description: "A real, detailed job description with enough length to pass server-side checks.",
        job_title: E2E_JOB_TITLE,
        company: E2E_EMPLOYER_NAME,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.mismatch.summary).toContain(E2E_PACKAGE_ANALYSIS_MARKER);
    expect(body.recommendation.summary).toContain(E2E_PACKAGE_ANALYSIS_MARKER);
  });
});
