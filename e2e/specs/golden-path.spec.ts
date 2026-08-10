/*
  Phase 6I.6.35 Part F/G - the centerpiece golden path: pasting a real
  Canadian job posting through the actual Paste Job UI, analyzing it via
  the deterministic E2E path (classifyCanadaJobScope() itself is real
  and unmocked - see e2e/helpers/jobPostings.ts), then Generate Package
  through to a persisted, deterministic package. Content markers
  (E2E_COVER_MARKER/E2E_EMAIL_MARKER, from lib/testing/e2eMarkers.ts)
  prove the real generation pipeline produced and rendered this run's
  own output, not stale/placeholder data.
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
import { loginViaUi } from "../helpers/uiActions";
import { E2E_SUPPORTED_JOB_POSTING, E2E_UNSUPPORTED_JOB_POSTING } from "../helpers/jobPostings";
import {
  E2E_JOB_TITLE,
  E2E_EMPLOYER_NAME,
  E2E_COVER_MARKER,
  E2E_EMAIL_MARKER,
} from "../../lib/testing/e2eMarkers";

const SEEDED_TEMPLATE_ID = "professional-ats";

let user: E2eTestUser;
let resumeId: string;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "goldenpath");
  const seeded = await seedCanonicalResumeForUser(admin, user, SEEDED_TEMPLATE_ID);
  resumeId = seeded.resumeId;
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

async function pasteAndAnalyze(page: import("@playwright/test").Page, jobText: string) {
  await page.goto("/paste-job");
  await page.getByRole("button", { name: "📄 Paste Description" }).click();
  await page.getByPlaceholder("Paste the full job description here...").fill(jobText);
  await page.getByRole("button", { name: "Analyze Job" }).click();
}

test.describe("golden path: Paste Job -> Generate Package", () => {
  test("F1. a supported Canadian job posting parses real fields and enables Generate Package", async ({ page }) => {
    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);

    await expect(page.getByRole("heading", { name: E2E_JOB_TITLE })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible();

    const generateButton = page.getByRole("button", { name: /Generate Full Package/ });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
  });

  test("F2. a non-Canada job posting is deterministically rejected and blocks generation, no AI call needed", async ({ page }) => {
    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_UNSUPPORTED_JOB_POSTING);

    /*
      classifyCanadaJobScope() (lib/jobPosting/canadaScopeClassifier.ts)
      is real and unmocked even in E2E mode - this text's explicit "US
      residents only" exclusion phrase deterministically classifies as
      UNSUPPORTED regardless of the AI-fake title/company fields, so
      this exercises the real rejection path with zero extra mocking.
    */
    await expect(page.getByText("This posting is outside the currently supported scope.")).toBeVisible({ timeout: 20_000 });

    const generateButton = page.getByRole("button", { name: /Generate Full Package/ });
    await expect(generateButton).toBeDisabled();
  });

  test("G. Generate Package produces the deterministic package exactly once and populates Cover Letter/Email Draft", async ({ page }) => {
    /*
      playwright.config.ts's global per-test timeout is 60s, shorter
      than the 120s this test already budgets for the generation-success
      wait below (matching the UI's own "usually takes about 1 to 2
      minutes" copy) - without raising it here the whole test aborts at
      60s regardless of that wait's own timeout argument.
    */
    test.setTimeout(150_000);
    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    /*
      The button's own accessible name changes with generationPhase
      ("Generate Full Package ✨" -> "Submitting Request..." ->
      "Generating Package..." -> "✅ Your package is ready" - see
      app/paste-job/page.tsx's h3 inside this same <button>), so a
      locator scoped to the literal enabled-state text would stop
      resolving the instant the click fires. Matching across every
      phase's text keeps this one locator valid through the whole
      lifecycle.
    */
    const generateButton = page.getByRole("button", {
      name: /Generate Full Package|Submitting Request|Generating Package|Your package is ready/,
    });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await generateButton.click();

    /*
      Duplicate-click guard: handleGeneratePackage() disables the CTA
      itself the moment isGenerating flips true (app/paste-job/page.tsx
      disabled={... || isGenerating ...}), so Playwright's own click
      actionability check refusing a second click here is a real
      assertion of the guard, not merely skipped. Idempotency across a
      literal double-submit (same generationRequestId reused, not a
      second row) is exercised via the async claim route's own
      real-DB regression suite - this test's own DB check below proves
      exactly one row exists for this run.
    */
    await expect(generateButton).toBeDisabled({ timeout: 5_000 });

    await expect(page.getByText("✅ Your package is ready")).toBeVisible({ timeout: 120_000 });

    /*
      The sidebar's own "Selected Cover Letter" card (app/paste-job/
      page.tsx ~3606) also renders a button whose accessible name
      contains "Cover Letter", so a bare name match resolves to 3
      elements. The real results tab is the only one of the three that
      also carries its own "Click to preview and edit"/"Viewing and
      editing now" caption (see the results tab-bar's own <p> sibling),
      which the sidebar card and the Generate/Apply CTAs never do.
    */
    /*
      The left-hand "Paste Job URL or Description" form (its own
      job-description <textarea placeholder="Paste the full job
      description here...">) stays mounted on the page alongside the
      results panel, and is the FIRST textarea in DOM order - a bare
      `textarea.first()` silently grabs it instead of the results tab's
      own content. Both the Cover Letter (A4Preview's per-page
      textarea) and Email Draft textareas render with no placeholder
      attribute at all, so excluding [placeholder] reliably picks the
      real results content instead of relying on DOM order.
    */
    await page.getByRole("button", { name: "Cover Letter" }).filter({ hasText: /preview and edit|Viewing and editing/ }).click();
    const coverLetterTextarea = page.locator("textarea:not([placeholder])").first();
    await expect(coverLetterTextarea).toBeVisible();
    await expect(coverLetterTextarea).toHaveValue(new RegExp(E2E_COVER_MARKER));

    await page.getByRole("button", { name: "Email Draft" }).filter({ hasText: /preview and edit|Viewing and editing/ }).click();
    const emailDraftTextarea = page.locator("textarea:not([placeholder])").first();
    await expect(emailDraftTextarea).toBeVisible();
    await expect(emailDraftTextarea).toHaveValue(new RegExp(E2E_EMAIL_MARKER));

    const admin = adminClient();
    const { data: apps } = await admin
      .from("applications")
      .select("id, generation_status, company, job_title, cover_letter_text, email_draft, selected_template_id, tailored_resume_id, canonical_profile_id, generation_engine")
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE);

    expect(apps).toHaveLength(1);
    const app = apps![0];
    expect(app.generation_status).toBe("succeeded");
    expect(app.company).toBe(E2E_EMPLOYER_NAME);
    expect(app.cover_letter_text).toContain(E2E_COVER_MARKER);
    expect(app.email_draft).toContain(E2E_EMAIL_MARKER);
    /*
      Canonical-engine rows persist the template on selected_template_id
      (see app/api/applications/[id]/status/route.ts's own canonical
      response branch) - resume_template_id is the legacy engine's own
      column and stays null for a canonical generation, not a bug.
    */
    expect(app.selected_template_id).toBe(SEEDED_TEMPLATE_ID);
    expect(app.generation_engine).toBe("canonical");
    expect(app.tailored_resume_id).toBeTruthy();
    expect(app.canonical_profile_id).toBeTruthy();
  });

  test("I/J. Cover Letter edit persists through Save, and PDF/DOCX downloads are real, valid documents", async ({ page }) => {
    test.setTimeout(150_000);
    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    const generateButton = page.getByRole("button", {
      name: /Generate Full Package|Submitting Request|Generating Package|Your package is ready/,
    });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await generateButton.click();
    await expect(page.getByText("✅ Your package is ready")).toBeVisible({ timeout: 120_000 });

    /*
      Test G (earlier in this same file, same shared `user`) already
      created its own application row with this identical job_title -
      every generation in this file pastes the same fixed
      E2E_SUPPORTED_JOB_POSTING text, and E2E_JOB_TITLE itself comes
      from the deterministic AI-fake response
      (buildE2eJobAnalysisResponseText()), not from anything a test can
      vary. Filtering by job_title alone is therefore ambiguous from
      this test onward - order by created_at desc + limit 1 to reliably
      grab THIS test's own just-created row regardless of how many
      earlier rows share the same title (tests in one file run
      sequentially, never concurrently, so nothing else can be creating
      a newer row at this exact moment).
    */
    const admin = adminClient();
    const { data: myApp } = await admin
      .from("applications")
      .select("id")
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const applicationId = myApp!.id;

    await page.getByRole("button", { name: "Cover Letter" }).filter({ hasText: /preview and edit|Viewing and editing/ }).click();
    const coverLetterTextarea = page.locator("textarea:not([placeholder])").first();
    await expect(coverLetterTextarea).toBeVisible();

    const editMarker = "E2E-EDIT-MARKER-635-" + Date.now();
    const originalText = await coverLetterTextarea.inputValue();
    await coverLetterTextarea.fill(`${originalText}\n${editMarker}`);

    /*
      savePackage() (app/paste-job/page.tsx) confirms via a native
      window.alert(), not an in-page toast - must be accepted or the
      dialog blocks the page indefinitely.
    */
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Save Package" }).first().click();

    await expect(async () => {
      const { data } = await admin
        .from("applications")
        .select("id, cover_letter_text")
        .eq("id", applicationId)
        .maybeSingle();
      expect(data?.cover_letter_text).toContain(editMarker);
    }).toPass({ timeout: 10_000 });

    /*
      Preview/Edit/Save must not silently diverge (spec Part I): reload
      through the DB-sourced ?applicationId= recovery path (not
      sessionStorage) and confirm the SAVED edit - not the original
      generated text - is what's authoritative afterward.
    */
    await page.goto(`/paste-job?applicationId=${applicationId}`);
    await expect(page.getByText("✅ Your package is ready")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cover Letter" }).filter({ hasText: /preview and edit|Viewing and editing/ }).click();
    const reloadedTextarea = page.locator("textarea:not([placeholder])").first();
    await expect(reloadedTextarea).toHaveValue(new RegExp(editMarker));

    /*
      Download PDF/DOCX for the Cover Letter tab - client-side generated
      (exportPdf/exportDocx from packageData.coverLetter, see
      app/paste-job/page.tsx's downloadPdf/downloadDocx) via a real
      <a download> + blob URL, which Playwright's download event
      captures like any real browser download. Verified by real file
      signature, not pixel-identical content, per the spec's own J
      requirement.
    */
    // Both the top toolbar and the bottom action row render their own
    // "Download PDF"/"Download DOCX" buttons for the same tab (see
    // app/paste-job/page.tsx ~4280-4292 and ~4474-4486) - .first() picks
    // either one, they trigger the identical downloadPdf()/downloadDocx().
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).first().click(),
    ]);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();
    const pdfBytes = await readFile(pdfPath!);
    expect(pdfBytes.byteLength).toBeGreaterThan(0);
    expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const [docxDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download DOCX" }).first().click(),
    ]);
    const docxPath = await docxDownload.path();
    expect(docxPath).toBeTruthy();
    const docxBytes = await readFile(docxPath!);
    expect(docxBytes.byteLength).toBeGreaterThan(0);
    // OOXML files are real ZIP archives - "PK\x03\x04" is the ZIP local-file-header magic.
    expect(docxBytes.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  });
});
