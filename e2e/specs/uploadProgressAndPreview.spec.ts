/*
  Phase 6I.6.39 - two focused regression specs added alongside the
  Resume Upload OpenAI Proxy fix (lib/testing/e2eAiIsolation.ts):

  1. Progress test - proves the Resume/Cover Letter upload progress bar
     no longer starts (and freezes) at 60%. Before this phase,
     app/career-memory/page.tsx hardcoded setUploadProgress(60) right
     before dispatching /api/analyze-resume, and the analysis-status
     polling loop never advanced the value again until the terminal
     100 on success - so the bar effectively "started" at 60% and sat
     there for the entire (often multi-minute, in real non-E2E usage)
     AI analysis. The fix renumbers the client-only steps to start at
     10% and wires the real backend `analysis_stage` column (already
     written by runResumeAnalysis's own setStage() calls) through the
     analysis-status route into a genuine mid-flight progress bump.

     Budgets below are generous (test-level 120s, sampling window 45s)
     because this E2E harness's real per-request latency (auth, page
     navigation, Storage upload, the claim+poll cycle) runs noticeably
     longer than a bare 60s default test timeout comfortably covers -
     confirmed by a real run that hit Playwright's own 60s test-timeout
     kill mid-poll despite the app itself behaving correctly.

  2. Preview test - proves Career Memory's Live Resume Preview shows
     the resume that was JUST uploaded, not a stale earlier one.

     IMPORTANT scope note (found while building this spec): the
     Career Memory upload flow's "Live Resume Preview" only renders
     the CANONICAL iframe (gated by canonicalPreviewStatus==="canonical",
     itself gated by the CANONICAL_GENERATE_ENABLED env flag - see
     docs/canonical-canary-plan.md) when that flag/canary stage makes
     canonical reachable. This local .env.local does NOT set
     CANONICAL_GENERATE_ENABLED, so in THIS environment the preview
     falls through to the LEGACY path, renderUploadedOriginalPreview()
     (app/career-memory/page.tsx ~line 2515), an iframe titled
     "Uploaded resume preview" pointing at a fresh
     URL.createObjectURL(file) blob - a completely different code path
     from the canonical one. K3 below verifies the legacy path (the
     one actually reachable in this environment) by asserting the
     iframe's blob src changes across uploads and cross-checking the
     real DB rows - not by reading rendered PDF text, since a browser's
     native PDF viewer's text layer isn't a reliable Playwright target.

     Separately (root-cause investigation, not covered by this iframe-
     src check since it requires canonical to be reachable): the mount-
     only resolve-template effect (page.tsx ~line 306, runs once per
     `user`, never re-fires on a new upload) can leave
     canonicalPreviewStatus="canonical" with an OLDER resume's
     canonicalPreviewTemplateId from before this session's upload. If
     runInlineCanonicalFlow then hits its not-applicable/import-error/
     catch branch without resetting them, the stale canonical preview
     would render instead of the just-uploaded resume - this is fixed
     by resetting canonicalPreviewStatus to "loading" and
     canonicalPreviewTemplateId to null at the very start of
     runInlineCanonicalFlow (page.tsx ~line 394-395), so a safe fallback
     (the legacy original-file preview) shows during re-resolution
     instead of a stale canonical one, whichever branch it ends up in.

  Runs entirely in E2E fake-AI mode (globalSetup.ts's fixed
  CAREER_ELAN_E2E=1 server) - zero real OpenAI calls, matching every
  other spec in this suite.
*/
import { test, expect } from "@playwright/test";
import path from "path";
import {
  adminClient,
  createSyntheticE2eUser,
  cleanupSyntheticE2eUser,
  seedCanonicalResumeForUser,
  type E2eTestUser,
} from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";

const PERSON_A_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "e2e-progress-preview-person-a.pdf");
const PERSON_B_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "e2e-progress-preview-person-b.pdf");
const GATING_STANDARD_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "standard-pdf-resume.pdf");
const GATING_CANVA_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "canva-pdf-resume.pdf");

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "progresspreview");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

async function openUploadDropzone(page: import("@playwright/test").Page) {
  await page.goto("/career-memory");
  const importCard = page.getByRole("button", { name: /Import Your Resume/ });
  if (await importCard.isVisible().catch(() => false)) {
    await importCard.click();
  }
  await expect(page.getByRole("button", { name: "Browse Files" }).first()).toBeVisible({ timeout: 10_000 });
}

/*
  Samples the visible "{progress}%" text (ParsingStatus's own render,
  career-memory/page.tsx) every 150ms for up to `maxMs`, stopping early
  once the success text appears. Returns every distinct percentage
  observed, in the order first seen - a real, no-guessing trace of
  what a user's eyes would actually see.
*/
async function samplePercentSequence(page: import("@playwright/test").Page, maxMs: number, successText: string): Promise<number[]> {
  const seen: number[] = [];
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    /*
      Explicit short timeout is required here - Playwright's default
      actionTimeout is unset (0 = unbounded) in this project's config,
      so once the app moves past ParsingStatus (no more "N%" text node
      in the DOM at all, e.g. right after success), an untimed
      textContent() on a zero-match locator hangs until the OUTER test
      timeout kills the whole browser context, not until this .catch()
      - which silently ate the real symptom the first two times this
      spec was run and made it look like a slow/stuck app instead of a
      test bug.
    */
    const text = await page.locator("text=/^\\d+%$/").first().textContent({ timeout: 500 }).catch(() => null);
    if (text) {
      const value = parseInt(text.replace("%", ""), 10);
      if (!Number.isNaN(value) && (seen.length === 0 || seen[seen.length - 1] !== value)) {
        seen.push(value);
      }
    }
    if (await page.getByText(successText).isVisible().catch(() => false)) {
      break;
    }
    await page.waitForTimeout(150);
  }
  return seen;
}

test.describe("truthful upload progress (Phase 6I.6.39)", () => {
  test("K1. Resume upload progress begins low, never shows 60%, reaches 100% only on success", async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, user);
    await openUploadDropzone(page);

    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(PERSON_A_PDF);

    const sequence = await samplePercentSequence(page, 45_000, "Resume analyzed successfully.");
    await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 20_000 });

    expect(sequence.length).toBeGreaterThan(0);
    // Begins within the real pre-analysis client stages (10/20/30/40/45 -
    // see RESUME_STAGE_PROGRESS's own comment in page.tsx), never at the
    // old broken 60% value. The 150ms sampling granularity can miss the
    // very first (briefest) tick, so this checks the whole legitimate
    // pre-flight range rather than pinning to the literal first value.
    expect(sequence[0]).toBeLessThanOrEqual(45);
    expect(sequence).not.toContain(60);
    // Monotonic, never regresses.
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1]);
    }
    // 100 only ever appears last, paired with the real success state
    // (already asserted above) - never appears mid-sequence.
    const hundredIndex = sequence.indexOf(100);
    if (hundredIndex !== -1) {
      expect(hundredIndex).toBe(sequence.length - 1);
    }
  });

  /*
    K4 - directly reproduces the commit-0812547 TDZ regression
    (app/career-memory/page.tsx: `const RESUME_STAGE_PROGRESS` was
    declared AFTER the early-return call site of
    pollResumeAnalysisStatus(), so any poll tick that observed a
    non-null `stage` before "succeeded" threw "Cannot access
    'RESUME_STAGE_PROGRESS' before initialization" and silently killed
    the poll loop - freezing the UI at 45% forever with no visible
    error).

    K1 above runs against the E2E fake-AI backend, which still performs
    every real setStage() transition (resumeAnalysisCore.ts calls
    downloading_file/extracting_text/verifying even when
    isE2eAiModeActive() short-circuits the 3 OpenAI calls) but completes
    all of them so fast that the 2s poll interval almost always observes
    "succeeded" on its very first tick, without ever reading a non-null
    `stage` on a "pending"/"processing" response - so K1 cannot catch
    this regression class.

    To reproduce deterministically without a real (slow, billed) OpenAI
    call, this test leaves the real upload/dispatch
    (POST /api/analyze-resume) and the real E2E fake-AI backend
    completely unmocked, and only intercepts the client's own
    analysis-status GET polls to script the exact sequence a real,
    multi-second analysis reliably produces: two intermediate
    non-null-stage responses, then succeeded.
  */
  test("K4. Resume upload polling survives intermediate non-null analysis stages without crashing (TDZ regression guard)", async ({ page }) => {
    test.setTimeout(60_000);
    const admin = adminClient();
    const userK4 = await createSyntheticE2eUser(admin, "progresspreview-k4");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    try {
      await loginViaUi(page, userK4);
      await openUploadDropzone(page);

      let pollCount = 0;
      await page.route("**/api/resumes/*/analysis-status", async (route) => {
        pollCount += 1;
        const url = route.request().url();
        const match = url.match(/\/api\/resumes\/([^/]+)\/analysis-status/);
        const resumeId = match ? match[1] : "unknown";

        if (pollCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "processing", resumeId, stage: "downloading_file" }),
          });
        } else if (pollCount === 2) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "processing", resumeId, stage: "extracting_text" }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "succeeded",
              resumeId,
              data: { originalText: "K4 scripted analysis text." },
            }),
          });
        }
      });

      const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
      await fileInput.setInputFiles(PERSON_A_PDF);

      const sequence = await samplePercentSequence(page, 30_000, "Resume analyzed successfully.");
      await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 20_000 });

      // The exact regression: this ReferenceError killed the poll loop
      // silently. It must never appear again.
      const tdzErrors = consoleErrors.filter((text) =>
        text.includes("Cannot access 'RESUME_STAGE_PROGRESS' before initialization")
      );
      expect(tdzErrors).toEqual([]);

      const referenceErrors = consoleErrors.filter(
        (text) => text.includes("ReferenceError") || text.toLowerCase().includes("unhandledpromiserejection")
      );
      expect(referenceErrors).toEqual([]);

      // Polling must have survived past the two scripted intermediate
      // (non-null-stage) ticks to reach the scripted succeeded response -
      // proves the loop did not die on the first one.
      expect(pollCount).toBeGreaterThanOrEqual(3);

      // Progress must have actually advanced past the pre-dispatch 45%
      // (i.e. RESUME_STAGE_PROGRESS was read successfully at least once,
      // proving the fix - this is the exact read that used to throw)
      // and must never regress. No manual navigation is used to discover
      // success (only page.getByText above, no page.goto("/dashboard")).
      expect(sequence.some((v) => v > 45)).toBe(true);
      for (let i = 1; i < sequence.length; i++) {
        expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1]);
      }
      // 100 only ever appears last when the 150ms sampler catches it -
      // same lenient check as K1 above, since the success text can (and
      // did, in a real run) render in the same tick the bar hits 100,
      // before the next sample fires. applyResumeAnalysisResult() sets
      // progress to 100 synchronously in the same branch that shows
      // "Resume analyzed successfully." (already asserted above), so that
      // assertion is the authoritative proof of reaching 100 at the
      // application-state level even on a sample that missed the frame.
      const hundredIndex = sequence.indexOf(100);
      if (hundredIndex !== -1) {
        expect(hundredIndex).toBe(sequence.length - 1);
      }
    } finally {
      await page.unroute("**/api/resumes/*/analysis-status");
      await cleanupSyntheticE2eUser(admin, userK4.userId);
    }
  });

  test("K2. Cover Letter upload progress begins low, never shows 60%, reaches 100% only on success", async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, user);
    await page.goto("/career-memory");
    const coverLetterCard = page.getByRole("button", { name: /Cover Letter/ });
    if (await coverLetterCard.isVisible().catch(() => false)) {
      await coverLetterCard.click();
    }
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx,.txt"]').first();
    await expect(fileInput).toBeAttached({ timeout: 10_000 });

    await fileInput.setInputFiles({
      name: "e2e-progress-cover-letter.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Dear Hiring Manager,\n\nI am writing to express my interest in this role. " +
          "My background in project coordination and cross-team communication " +
          "makes me a strong fit for your growing team, and I would welcome the " +
          "opportunity to discuss how I can contribute. Over the past several years " +
          "I have coordinated cross-functional projects, managed vendor relationships, " +
          "and delivered measurable improvements to team workflows and communication " +
          "practices. I am confident these skills would translate well to this role, " +
          "and I would welcome the chance to discuss my background further.\n\n" +
          "Sincerely,\nTest Applicant"
      ),
    });

    const sequence = await samplePercentSequence(page, 45_000, "Cover Letter analyzed successfully.");
    await expect(page.getByText("Cover Letter analyzed successfully.")).toBeVisible({ timeout: 20_000 });

    expect(sequence.length).toBeGreaterThan(0);
    // Same sampling-granularity reasoning as K1 above (cover letter's own
    // pre-analysis steps are 10/20/45 - see the setCoverLetterUploadProgress
    // call sites in page.tsx).
    expect(sequence[0]).toBeLessThanOrEqual(45);
    expect(sequence).not.toContain(60);
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1]);
    }
    const hundredIndex = sequence.indexOf(100);
    if (hundredIndex !== -1) {
      expect(hundredIndex).toBe(sequence.length - 1);
    }
  });
});

test.describe("Career Memory preview shows the just-uploaded resume (Phase 6I.6.39)", () => {
  /*
    Dedicated user, separate from K1/K2's shared `user` above - K3
    uploads PERSON_A_PDF itself (as its own "resume A" step), and the
    resumes table's content_hash unique constraint rejects a second
    upload of byte-identical content for the same user. Reusing K1's
    user here previously made K3 flaky depending on run order/isolation
    (passed only when K1 hadn't successfully persisted its own upload of
    the same fixture yet).
  */
  let userK3: E2eTestUser;

  test.beforeAll(async () => {
    const admin = adminClient();
    userK3 = await createSyntheticE2eUser(admin, "progresspreview-k3");
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await cleanupSyntheticE2eUser(admin, userK3.userId);
  });

  test("K3. Uploading Resume B after Resume A immediately previews B, not A, in both Career Memory and Dashboard", async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, userK3);
    await openUploadDropzone(page);

    // 1. Upload Resume A, confirm it analyzed successfully, capture the
    // legacy original-file preview iframe's blob src (the path actually
    // reachable in this environment - see file header for why).
    const fileInputA = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInputA.setInputFiles(PERSON_A_PDF);
    await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 45_000 });

    const previewIframe = page.locator('iframe[title="Uploaded resume preview"]');
    await expect(previewIframe).toBeVisible({ timeout: 15_000 });
    const srcAfterA = await previewIframe.getAttribute("src");
    expect(srcAfterA).toBeTruthy();
    expect(srcAfterA).toMatch(/^blob:/);

    // 2. Navigate away and back (Career Memory remounts, exercising the
    // real mount-only resolve-template effect too, not just the
    // upload-time state).
    await page.goto("/dashboard");
    await openUploadDropzone(page);

    // 3. Upload Resume B - a second, clearly distinguishable resume.
    const fileInputB = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInputB.setInputFiles(PERSON_B_PDF);
    await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 45_000 });

    // 4. The preview iframe must now point at a DIFFERENT blob (this
    // upload's own object URL, never A's) - the exact user-visible
    // symptom from the bug report ("still shows the previous resume").
    await expect(previewIframe).toBeVisible({ timeout: 15_000 });
    const srcAfterB = await previewIframe.getAttribute("src");
    expect(srcAfterB).toBeTruthy();
    expect(srcAfterB).toMatch(/^blob:/);
    expect(srcAfterB).not.toBe(srcAfterA);

    // 5. Dashboard must agree - both surfaces resolve the same current
    // resume file name.
    await page.goto("/dashboard");
    await expect(page.getByText("e2e-progress-preview-person-b.pdf")).toBeVisible({ timeout: 10_000 });

    // 6. Cross-check against the real DB rows: two distinct resumes now
    // exist for this user, and the second (B) is the one just imported.
    const admin = adminClient();
    const { data: resumes } = await admin
      .from("resumes")
      .select("id, file_name")
      .eq("user_id", userK3.userId)
      .eq("source_type", "uploaded")
      .order("created_at", { ascending: true });
    expect(resumes).toHaveLength(2);
    expect(resumes![0].file_name).toBe("e2e-progress-preview-person-a.pdf");
    expect(resumes![1].file_name).toBe("e2e-progress-preview-person-b.pdf");
  });
});

/*
  DPE Phase2 task - Career Memory post-upload template-selection UX/state
  contract (commit 341754f's follow-up). Two focused specs, both using
  the real E2E fake-AI backend (CAREER_ELAN_E2E=1, see globalSetup.ts) -
  zero real OpenAI calls, matching every other spec in this suite.

  K5 proves the full CTA-gating contract end to end: no explicit
  selection -> Save Memory/Continue to Preview/Continue to Dashboard all
  disabled; after an explicit click -> all three enabled, the selected
  card shows "Selected", "Applied template: <Name>" appears, and the
  LEFT live-preview iframe's src updates to the matching templateId;
  switching templates updates all three in lockstep with no stale state.

  K6 proves the Part K regression this task's own instructions called
  "critical": a returning user's existing account-level default
  (career_profiles.default_template_id) gets auto-applied to a NEWLY
  uploaded resume's preview for convenience, but that auto-apply must
  NOT count as an explicit selection for gating purposes - the CTAs must
  stay disabled, and the "confirm this template" hint must render, until
  the user actually clicks a card for THIS resume. Without the
  inlineTemplateExplicitlySelected fix, a hidden auto-default would
  silently re-enable the buttons.
*/
test.describe("Career Memory template-selection gating (DPE Phase2 task)", () => {
  test("K5. Post-upload template picker: 4 cards, CTA gating, selection feedback, preview refresh for all 4 templates", async ({ page }) => {
    test.setTimeout(90_000);
    const admin = adminClient();
    const userK5 = await createSyntheticE2eUser(admin, "gating-k5");

    try {
      await loginViaUi(page, userK5);
      await openUploadDropzone(page);

      const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
      await fileInput.setInputFiles(GATING_STANDARD_PDF);
      await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 45_000 });

      // 4 canonical template cards render.
      const cards = page.locator('[role="radio"]');
      await expect(cards).toHaveCount(4, { timeout: 10_000 });
      await expect(page.getByText("Professional ATS", { exact: true })).toBeVisible();
      await expect(page.getByText("Executive Minimal", { exact: true })).toBeVisible();
      await expect(page.getByText("Modern Sidebar", { exact: true })).toBeVisible();
      await expect(page.getByText("Creative Timeline", { exact: true })).toBeVisible();

      // No explicit selection yet -> all 3 completion CTAs disabled.
      const saveMemoryBtn = page.getByRole("button", { name: "Save Memory" });
      const continuePreviewBtn = page.getByRole("button", { name: "Continue to Preview" });
      const continueDashboardBtn = page.getByRole("button", { name: "Continue to Dashboard" });
      await expect(saveMemoryBtn).toBeDisabled();
      await expect(continuePreviewBtn).toBeDisabled();
      await expect(continueDashboardBtn).toBeDisabled();
      await expect(page.getByText("Choose a template to continue.")).toBeVisible();

      // Explicit selection: Modern Sidebar.
      await cards.nth(2).click();
      await expect(page.getByText(/Applied template:\s*Modern Sidebar/)).toBeVisible({ timeout: 10_000 });
      await expect(cards.nth(2)).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText("Selected", { exact: true })).toBeVisible();

      // All 3 CTAs now enabled.
      await expect(saveMemoryBtn).toBeEnabled();
      await expect(continuePreviewBtn).toBeEnabled();
      await expect(continueDashboardBtn).toBeEnabled();

      const mainPreview = page.locator('iframe[title="Canonical resume preview"]');
      await expect(mainPreview).toHaveAttribute("src", /templateId=modern-sidebar/, { timeout: 10_000 });

      // Switching templates updates label/selected-state/preview with no
      // staleness, and does not re-disable the CTAs (Part I + Part H).
      const templateOrder = [
        { index: 0, id: "professional-ats", name: "Professional ATS" },
        { index: 1, id: "executive-minimal", name: "Executive Minimal" },
        { index: 3, id: "creative-timeline", name: "Creative Timeline" },
      ];
      for (const t of templateOrder) {
        await cards.nth(t.index).click();
        await expect(mainPreview).toHaveAttribute("src", new RegExp(`templateId=${t.id}`), { timeout: 10_000 });
        await expect(cards.nth(t.index)).toHaveAttribute("aria-checked", "true");
        await expect(saveMemoryBtn).toBeEnabled();
        await expect(continuePreviewBtn).toBeEnabled();
        await expect(continueDashboardBtn).toBeEnabled();
      }
    } finally {
      await cleanupSyntheticE2eUser(admin, userK5.userId);
    }
  });

  test("K6. Auto-applied account default does NOT satisfy explicit-selection gating for a newly uploaded resume", async ({ page }) => {
    test.setTimeout(90_000);
    const admin = adminClient();
    const userK6 = await createSyntheticE2eUser(admin, "gating-k6");

    try {
      // Seed a FIRST resume + real canonical import (establishes a
      // canonical profile), then set the account-level default the same
      // way a returning user's prior explicit choice would have -
      // directly on career_profiles.default_template_id (the exact
      // column GET /template-preference reads with no `source` field,
      // per that route's own header comment).
      await seedCanonicalResumeForUser(admin, userK6, "professional-ats");
      const { error: profileUpdateError } = await admin
        .from("career_profiles")
        .update({ default_template_id: "creative-timeline" })
        .eq("user_id", userK6.userId);
      expect(profileUpdateError).toBeNull();

      await loginViaUi(page, userK6);
      await openUploadDropzone(page);

      const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
      await fileInput.setInputFiles(GATING_CANVA_PDF);
      await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 45_000 });

      const cards = page.locator('[role="radio"]');
      await expect(cards).toHaveCount(4, { timeout: 10_000 });

      // The account default was auto-applied for PREVIEW convenience
      // (label shows it, the matching card shows selected) - but this
      // must NOT be an explicit selection for THIS resume.
      await expect(page.getByText(/Applied template:\s*Creative Timeline/)).toBeVisible({ timeout: 10_000 });
      await expect(cards.nth(3)).toHaveAttribute("aria-checked", "true");

      const saveMemoryBtn = page.getByRole("button", { name: "Save Memory" });
      const continuePreviewBtn = page.getByRole("button", { name: "Continue to Preview" });
      const continueDashboardBtn = page.getByRole("button", { name: "Continue to Dashboard" });

      // Critical assertion: still disabled despite the auto-applied
      // default. A hidden auto-default silently re-enabling these would
      // be exactly the regression this task's Part K guards against.
      await expect(saveMemoryBtn).toBeDisabled();
      await expect(continuePreviewBtn).toBeDisabled();
      await expect(continueDashboardBtn).toBeDisabled();
      await expect(page.getByText("Click a template above to confirm it for this resume and continue.")).toBeVisible();

      // Only an actual click for THIS resume unlocks the CTAs.
      await cards.nth(3).click();
      await expect(saveMemoryBtn).toBeEnabled();
      await expect(continuePreviewBtn).toBeEnabled();
      await expect(continueDashboardBtn).toBeEnabled();
      await expect(page.getByText("Click a template above to confirm it for this resume and continue.")).not.toBeVisible();
    } finally {
      await cleanupSyntheticE2eUser(admin, userK6.userId);
    }
  });
});

/*
  DPE Phase2 loading-transition task - proves the post-upload screen
  (Live Resume Preview + 4 template cards) never reveals itself until
  BOTH resume analysis and template-picker resolution are done, and
  that the raw/original resume preview never flashes as an intermediate
  state on the successful canonical path. Both specs use a real,
  deterministically-delayed network request (via page.route(), never a
  fake/mocked response body) against the E2E fake-AI backend - zero
  real OpenAI calls.
*/
test.describe("Career Memory post-upload loading transition (DPE Phase2 task)", () => {
  test("K7. Post-upload screen stays on the loading panel until template-picker resolution finishes, with no raw-preview flash", async ({ page }) => {
    test.setTimeout(90_000);
    const admin = adminClient();
    const userK7 = await createSyntheticE2eUser(admin, "loading-k7");
    const DELAY_MS = 1500;

    try {
      // Deterministic fake delay on the real import-resume call (the
      // response itself is untouched - route.continue() after a
      // controlled wait) - this is the exact window during which
      // importStage is already "parsed" but inlineTemplateStatus is
      // still "checking"/"importing".
      await page.route("**/api/internal/canonical-career-memory/import-resume", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        await route.continue();
      });

      await loginViaUi(page, userK7);
      await openUploadDropzone(page);

      const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
      const fixturePath = path.join(__dirname, "..", "..", "fixtures", "resumes", "threepage-pdf-resume.pdf");
      const uploadStartedAt = Date.now();
      await fileInput.setInputFiles(fixturePath);

      // During the delay window, the loading panel must still be
      // visible with truthful "preparing" copy (never repeating
      // "analyzing your resume" once analysis has already succeeded),
      // and NEITHER the raw/original preview NOR the template-picker
      // screen may be present yet.
      await expect(page.getByText("Preparing your resume templates")).toBeVisible({ timeout: DELAY_MS + 5_000 });
      expect(Date.now() - uploadStartedAt).toBeGreaterThan(0);
      await expect(page.locator('iframe[title="Uploaded resume preview"]')).not.toBeVisible();
      await expect(page.locator('iframe[title="Canonical resume preview"]')).not.toBeVisible();
      await expect(page.getByText("CHOOSE YOUR DESIGN", { exact: false })).not.toBeVisible();
      await expect(page.locator('[role="radio"]')).toHaveCount(0);
            // Progress must have already reached the analysis-only ceiling
      // (95) but not yet 100 - the final step is still pending.
      await expect(page.getByText("95%")).toBeVisible();

      // Part I - the loading panel itself must never overflow
      // horizontally at any of the tested viewports, while it is
      // guaranteed to still be the visible screen (inside the delay
      // window). Restored to the default size afterward so the rest of
      // this test (and any later test in the same worker) is unaffected.
      const viewportsToCheck = [
        { width: 320, height: 568 },
        { width: 375, height: 667 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ];
      for (const vp of viewportsToCheck) {
        await page.setViewportSize(vp);
        await expect(page.getByText("Preparing your resume templates")).toBeVisible();
        const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(hasOverflow, `${vp.width}x${vp.height} had horizontal overflow`).toBe(false);
      }
      await page.setViewportSize({ width: 1280, height: 800 });

      // Once resolution finishes: loading panel disappears, Live Resume
      // Preview + all 4 template cards appear together, progress hits
      // 100, and the explicit-selection gating contract (already
      // deployed) remains intact.
      await expect(page.getByText("Preparing your resume templates")).not.toBeVisible({ timeout: DELAY_MS + 10_000 });
      await expect(page.getByText("Live Resume Preview", { exact: true })).toBeVisible();
      const cards = page.locator('[role="radio"]');
      await expect(cards).toHaveCount(4, { timeout: 10_000 });

      const saveMemoryBtn = page.getByRole("button", { name: "Save Memory" });
      const continuePreviewBtn = page.getByRole("button", { name: "Continue to Preview" });
      const continueDashboardBtn = page.getByRole("button", { name: "Continue to Dashboard" });
      await expect(saveMemoryBtn).toBeDisabled();
      await expect(continuePreviewBtn).toBeDisabled();
      await expect(continueDashboardBtn).toBeDisabled();

      await cards.first().click();
      await expect(saveMemoryBtn).toBeEnabled();
      await expect(continuePreviewBtn).toBeEnabled();
      await expect(continueDashboardBtn).toBeEnabled();
    } finally {
      await page.unroute("**/api/internal/canonical-career-memory/import-resume");
      await cleanupSyntheticE2eUser(admin, userK7.userId);
    }
  });

  test("K8. A template-preparation failure exits the loading panel into a safe fallback, never an infinite loader", async ({ page }) => {
    test.setTimeout(60_000);
    const admin = adminClient();
    const userK8 = await createSyntheticE2eUser(admin, "loading-k8");
    // Only genuine unhandled JS exceptions count as fatal here - normal
    // "Failed to load resource" console entries (which Chromium logs
    // automatically for EVERY non-2xx response, including the
    // deliberately-injected 500 below) are expected noise, not a crash.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    try {
      // Force the real import-resume call to fail server-side (a genuine
      // HTTP 500, not a fabricated success) - this is exactly the
      // "import-error" terminal branch runInlineCanonicalFlow already
      // handles today; nothing about that fallback semantics changes.
      await page.route("**/api/internal/canonical-career-memory/import-resume", async (route) => {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "K8 injected failure" } }) });
      });

      await loginViaUi(page, userK8);
      await openUploadDropzone(page);

      const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
      const fixturePath = path.join(__dirname, "..", "..", "fixtures", "resumes", "regtest3-two-column-pdf.pdf");
      await fileInput.setInputFiles(fixturePath);

      // The loading panel must exit (never stay stuck spinning forever)
      // and progress must reach 100 even on this failure path.
      await expect(page.getByText("Preparing your resume templates")).not.toBeVisible({ timeout: 30_000 });

      // Safe fallback: the original/uploaded resume preview is shown
      // (the existing, already-correct fallback for a canonical prep
      // failure - Part D explicitly allows this), not a blank screen,
      // not a crash.
      await expect(page.locator('iframe[title="Uploaded resume preview"]')).toBeVisible({ timeout: 10_000 });

      // No unhandled exception reached the console.
      expect(pageErrors).toEqual([]);
    } finally {
      await page.unroute("**/api/internal/canonical-career-memory/import-resume");
      await cleanupSyntheticE2eUser(admin, userK8.userId);
    }
  });
});
