/*
  Phase 6I.6.35 spec Parts K (Storage write failure injection) and L
  (PDF/DOCX render failure injection). Exercises the real, production
  fault-injection hooks:
    - lib/careerMemory/orchestration/canonicalDocumentStorageService.ts's
      isStorageWriteFaultInjected() (env: E2E_FAULT_INJECT_STORAGE_WRITE)
    - lib/careerMemory/orchestration/canonicalRenderService.ts's
      isRenderFaultInjected() (env: E2E_FAULT_INJECT_RENDER)
  Both are double-gated behind isE2eAiModeActive() (fail-closed to local
  Supabase + non-Netlify) and read a server-process env var only - never
  any client-supplied input.

  These env vars are read via process.env inside the ONE long-running
  dev server process e2e/globalSetup.ts spawns per `npx playwright test`
  invocation - the fault is therefore fixed for that whole invocation and
  cannot be toggled mid-run. Each test below self-skips unless its own
  matching env var is set, so this file must be run three times, once
  per env var, to get full coverage:

    E2E_FAULT_INJECT_STORAGE_WRITE=both npx playwright test e2e/specs/render-failure.spec.ts
    E2E_FAULT_INJECT_RENDER=pdf         npx playwright test e2e/specs/render-failure.spec.ts
    E2E_FAULT_INJECT_RENDER=docx        npx playwright test e2e/specs/render-failure.spec.ts

  and once with neither set (every test self-skips, 0 failures) as a
  smoke check that the file itself is well-formed.

  "Retry succeeds once the injection is removed" (a spec requirement) is
  deliberately NOT built as a live in-test toggle - the fault is fixed
  for the server's whole lifetime (see above), so nothing in a single
  Playwright run can remove it. golden-path.spec.ts's own test G (run
  with neither fault env var set) is the un-injected control that
  already proves this identical generation path succeeds end-to-end once
  no fault is active; this file only needs to prove the FAULTY side
  behaves safely.

  IMPORTANT real-architecture finding, verified empirically (see the
  actual DB row dumped while writing this file - a render fault DOES
  first trigger the fallback machinery exactly as read from
  lib/careerMemory/orchestration/canonicalGenerationFallbackService.ts /
  canonicalGenerationWorker.ts): TemplateRenderingError is a
  FALLBACK-ELIGIBLE error category, and this repo's own .env.local sets
  CANONICAL_LEGACY_FALLBACK_ENABLED=true (inherited into the E2E
  server's env by globalSetup.ts's `{ ...process.env, ...baseEnv }`
  merge), so canonicalGenerationWorker.ts DOES call mark_canonical_fallback
  (fallback_used=true, fallback_reason='template_rendering_failure',
  generation_engine='legacy') and DOES invoke legacy's own
  runPackageGeneration() against the SAME row.

  However, that legacy retry attempt itself ALSO fails, every time - not
  because of anything this test injects, but because of a SEPARATE,
  pre-existing E2E-harness gap: every OTHER AI call site in this codebase
  (app/api/analyze-job/route.ts, lib/documentAnalysis/resumeAnalysisCore.ts,
  lib/careerMemory/orchestration/canonicalTailoringService.ts) has its own
  isE2eAiModeActive() short-circuit that returns a deterministic fixture
  BEFORE ever touching the OpenAI client (see lib/testing/e2eFakeResponses.ts's
  own header comment on this pattern) - but lib/generatePackage/generateCore.ts's
  two legacy OpenAI calls (Call1 "resume+analysis", Call2 "cover letter+email")
  have NO such short-circuit, because until this phase's canonical->legacy
  fallback existed, legacy generation was never reachable at all while
  CAREER_ELAN_E2E=1 (every E2E generation test routes to canonical - see
  canonicalTrafficRouter.ts's own isE2eAiModeActive() override). The instant
  legacy IS reached (via this exact fallback path), it calls the real,
  wrapped OpenAI client (lib/testing/e2eAiIsolation.ts's
  wrapOpenAiClientForE2eSafety()), which throws the hard backstop error
  REAL_OPENAI_CALL_BLOCKED_IN_E2E - a plain Error, caught by generateCore.ts's
  own classifyGenerationError() and landing in the generic VALIDATION_FAILED
  bucket ("The generated package failed a content-quality check."), which is
  never exposed to the client (classifyGenerationError never copies a caught
  error's own message into what gets persisted/shown).

  Confirmed via a real, un-cleaned-up DB row from an actual
  E2E_FAULT_INJECT_RENDER=pdf run: generation_status='failed',
  generation_error_code='VALIDATION_FAILED', generation_engine='legacy',
  fallback_used=true, fallback_reason='template_rendering_failure',
  generated_pdf_document_id/generated_docx_document_id both null, exactly
  one row. This is a genuine E2E-test-infrastructure gap (legacy's own
  OpenAI calls are not fake-response-wired), NOT a production bug - real
  OpenAI calls in Production would let the legacy fallback attempt actually
  complete. Fixing it would mean adding a realistic deterministic Call1/
  Call2 fixture to a large, heavily-validated pipeline (resume/cover-letter/
  email validators: validateSourceIntegrity, validateCanadianScope,
  validateRequirementEvidence, validateProtectedClaims, etc.) which is a
  substantial, separate change on its own - flagged as a follow-up task
  rather than attempted blind inside this test-writing pass. Part L below
  therefore tests the VERIFIED real outcome: a render fault safely fails
  the whole generation (after genuinely attempting - and correctly
  recording - the fallback), with no leaked error detail, no duplicate
  row, and no fabricated canonical document rows.
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
import { E2E_SUPPORTED_JOB_POSTING } from "../helpers/jobPostings";
import {
  E2E_JOB_TITLE,
  E2E_EMPLOYER_NAME,
  E2E_COVER_MARKER,
  E2E_EMAIL_MARKER,
} from "../../lib/testing/e2eMarkers";

const SEEDED_TEMPLATE_ID = "professional-ats";

const GENERATE_BUTTON_NAME =
  /Generate Full Package|Submitting Request|Generating Package|Your package is ready/;

async function pasteAndAnalyze(page: import("@playwright/test").Page, jobText: string) {
  await page.goto("/paste-job");
  await page.getByRole("button", { name: "📄 Paste Description" }).click();
  await page.getByPlaceholder("Paste the full job description here...").fill(jobText);
  await page.getByRole("button", { name: "Analyze Job" }).click();
}

test.describe("Part K: Storage write failure injection", () => {
  let user: E2eTestUser;

  test.beforeAll(async () => {
    const admin = adminClient();
    user = await createSyntheticE2eUser(admin, "storagefault");
    await seedCanonicalResumeForUser(admin, user, SEEDED_TEMPLATE_ID);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await cleanupSyntheticE2eUser(admin, user.userId);
  });

  test("K1. a Storage write failure prevents a false success state - generation safely fails/falls back, persists no document rows, no fabricated ids, no leaked error detail", async ({ page }) => {
    test.skip(!process.env.E2E_FAULT_INJECT_STORAGE_WRITE, "run with E2E_FAULT_INJECT_STORAGE_WRITE=both set");
    test.setTimeout(180_000);

    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    const generateButton = page.getByRole("button", { name: GENERATE_BUTTON_NAME });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await generateButton.click();
    await expect(generateButton).toBeDisabled({ timeout: 5_000 });

    /*
      Phase 6I.6.39 (consistency fix, superseding this test's own prior
      expectation) - renderCanonicalPackage() now throws the SAME
      GeneratedDocumentError it already throws for the sibling "RPC
      itself failed" case whenever a tailored resume exists but required
      document persistence did not succeed (storage disabled, or - as
      this fault-injection test forces once the storage flag is on -
      the upload itself failing). classifyForFallback() correctly
      classifies this as fallback-eligible (generated_document_failure) -
      but this repo's actual current .env.local does NOT set
      CANONICAL_LEGACY_FALLBACK_ENABLED=true (verified live: this test
      previously failed here waiting for Part L's generic legacy-fallback
      failure text, because that text is only reached once a fallback
      attempt runs), so runCanonicalWithFallbackDecision()'s own
      `if (!isCanonicalLegacyFallbackEnabled()) throw error;` branch
      rethrows immediately instead of engaging fallback - the row never
      leaves generation_engine='canonical'. The rethrow is caught by
      canonicalGenerationWorker.ts's outer catch, which marks the row
      failed with its own fixed p_error_summary literal, verified live
      against the real rendered page: "Canonical generation failed and
      could not be completed." A false "Your package is ready" success
      state is no longer produced either way - that is the one
      invariant this test exists to prove.
    */
    const FAILURE_MESSAGE = "Canonical generation failed and could not be completed.";
    await expect(page.getByText(FAILURE_MESSAGE).first()).toBeVisible({ timeout: 170_000 });
    await expect(page.getByText("✅ Your package is ready")).not.toBeVisible();

    // The button must return to its normal idle, retryable state - never stay stuck disabled/"Generating...".
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Generate Full Package ✨" })).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/at Object\.|TypeError|node_modules|\.ts:\d+:\d+/);
    // The raw injected-fault message/internal error class name must never leak to the client.
    expect(bodyText).not.toMatch(/E2E_FAULT_INJECT_STORAGE_WRITE|E2E fault injection|REAL_OPENAI_CALL_BLOCKED|GeneratedDocumentError|simulated upload failure/);

    const admin = adminClient();
    const { data: apps } = await admin
      .from("applications")
      .select(
        "id, generation_status, generation_engine, generation_error_code, fallback_used, fallback_reason, generated_pdf_document_id, generated_docx_document_id"
      )
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE);

    expect(apps).toHaveLength(1);
    const app = apps![0];
    expect(app.generation_status).toBe("failed");
    expect(app.generation_error_code).toBe("generated_document_failed");
    /*
      Fallback did NOT engage (CANONICAL_LEGACY_FALLBACK_ENABLED is off
      in this environment - see the comment above), so
      mark_canonical_fallback/release_canonical_claim_for_legacy_fallback
      were never called and the row never left the canonical engine -
      the checkable proof the classification happened (fallback-eligible)
      is generation_error_code itself, set from classifyForFallback()'s
      SAME error-class switch (GeneratedDocumentError -> generated_
      document_failed), not a fallback_used flag this run path never
      touches.
    */
    expect(app.fallback_used).toBeFalsy();
    expect(app.fallback_reason).toBeNull();
    expect(app.generation_engine).toBe("canonical");
    // No canonical document was ever produced or persisted - the canonical
    // attempt never got past the (now-thrown) persistence check, and these
    // ids are written solely by complete_canonical_generation, which this
    // row's canonical attempt never reached.
    expect(app.generated_pdf_document_id).toBeNull();
    expect(app.generated_docx_document_id).toBeNull();

    const { data: docs } = await admin
      .from("generated_resume_documents")
      .select("id")
      .eq("application_id", app.id);
    expect(docs ?? []).toHaveLength(0);

    // No duplicate row was created for this attempt.
    const { data: allAppsForJob } = await admin
      .from("applications")
      .select("id")
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE);
    expect(allAppsForJob).toHaveLength(1);
  });
});

test.describe("Part L: PDF/DOCX render failure injection", () => {
  let user: E2eTestUser;

  test.beforeAll(async () => {
    const admin = adminClient();
    user = await createSyntheticE2eUser(admin, "renderfault");
    await seedCanonicalResumeForUser(admin, user, SEEDED_TEMPLATE_ID);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await cleanupSyntheticE2eUser(admin, user.userId);
  });

  const FAILURE_MESSAGE = "The generated package failed a content-quality check.";

  /*
    Drives one Generate Package attempt through the real UI while a
    render fault is injected, and asserts on the VERIFIED real outcome
    documented in this file's header comment: the canonical attempt
    fails, fallback correctly engages and is correctly recorded, the
    legacy retry attempt also fails (a separate, pre-existing E2E-harness
    gap - legacy's own OpenAI calls have no deterministic fixture), and
    the overall generation lands safely in generation_status='failed'
    with no leaked error detail. Returns the row's applicationId so
    callers can drive a same-row retry.
  */
  async function generateWithRenderFaultAndAssertSafeFailure(page: import("@playwright/test").Page) {
    const generateButton = page.getByRole("button", { name: GENERATE_BUTTON_NAME });
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await generateButton.click();
    await expect(generateButton).toBeDisabled({ timeout: 5_000 });

    // The failure summary renders in more than one place on this page
    // (the Generate button's own status line, plus a separate summary
    // banner) - .first() is enough to prove it's shown at all. A retry
    // attempt (reclaiming an already-failed row) has been observed to
    // take noticeably longer than a fresh attempt's ~9s - budgeted well
    // above the UI's own "1 to 2 minutes" copy to avoid flaking on that.
    await expect(page.getByText(FAILURE_MESSAGE).first()).toBeVisible({ timeout: 170_000 });

    // The button itself must return to its normal idle, retryable state -
    // never stay stuck disabled/"Generating..." after a failure.
    await expect(generateButton).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Generate Full Package ✨" })).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/at Object\.|TypeError|node_modules|\.ts:\d+:\d+/);
    // The raw injected-fault message/name must never leak to the client -
    // only the fixed, generic classifyGenerationError() summary may.
    expect(bodyText).not.toMatch(/E2E_FAULT_INJECT_RENDER|E2E fault injection|REAL_OPENAI_CALL_BLOCKED/);

    /*
      Every test in this describe block shares one `user` (and every
      generation uses the same fixed E2E_SUPPORTED_JOB_POSTING, so every
      attempt gets the identical deterministic E2E_JOB_TITLE - see
      golden-path.spec.ts's own test I/J comment on this exact ambiguity)
      - ordering by created_at desc + limit 1 reliably grabs THIS call's
      own just-created row regardless of how many earlier rows in this
      file share the same title. Tests in one file run sequentially, so
      nothing else can create a newer row at this exact moment.
    */
    const admin = adminClient();
    const { data: app } = await admin
      .from("applications")
      .select(
        "id, generation_status, generation_engine, generation_error_code, fallback_used, fallback_reason, generated_pdf_document_id, generated_docx_document_id"
      )
      .eq("user_id", user.userId)
      .eq("job_title", E2E_JOB_TITLE)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    expect(app).toBeTruthy();
    expect(app!.generation_status).toBe("failed");
    expect(app!.generation_error_code).toBe("VALIDATION_FAILED");
    /*
      Fallback genuinely engaged before the (separately, safely) failing
      legacy retry - this is the real, checkable proof that the render
      fault was correctly classified as fallback-eligible and routed
      through canonicalGenerationFallbackService.ts, not silently
      swallowed or misclassified as some other failure category.
    */
    expect(app!.fallback_used).toBe(true);
    expect(app!.fallback_reason).toBe("template_rendering_failure");
    expect(app!.generation_engine).toBe("legacy");
    /*
      No canonical document was ever produced or persisted for this row
      - the canonical attempt never got past rendering, and
      generated_pdf_document_id/generated_docx_document_id are written
      solely by complete_canonical_generation (see
      lib/careerMemory/orchestration/canonicalRenderService.ts), which
      this row's canonical attempt never reached.
    */
    expect(app!.generated_pdf_document_id).toBeNull();
    expect(app!.generated_docx_document_id).toBeNull();

    const { data: docs } = await admin
      .from("generated_resume_documents")
      .select("id")
      .eq("application_id", app!.id);
    expect(docs ?? []).toHaveLength(0);

    return app!.id as string;
  }

  test("L1. a PDF render failure safely fails the whole generation after correctly recording a fallback attempt - exactly one row, no leaked error text, no fabricated canonical documents", async ({ page }) => {
    test.skip(process.env.E2E_FAULT_INJECT_RENDER !== "pdf", "run with E2E_FAULT_INJECT_RENDER=pdf set");
    test.setTimeout(150_000);

    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    await generateWithRenderFaultAndAssertSafeFailure(page);
  });

  test("L2. a DOCX render failure safely fails the whole generation after correctly recording a fallback attempt - exactly one row, no leaked error text, no fabricated canonical documents", async ({ page }) => {
    test.skip(process.env.E2E_FAULT_INJECT_RENDER !== "docx", "run with E2E_FAULT_INJECT_RENDER=docx set");
    test.setTimeout(150_000);

    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    await generateWithRenderFaultAndAssertSafeFailure(page);
  });

  test("L3. a render failure on one application does not corrupt a different, already-succeeded application for the same user", async ({ page }) => {
    test.skip(
      process.env.E2E_FAULT_INJECT_RENDER !== "pdf" && process.env.E2E_FAULT_INJECT_RENDER !== "docx",
      "run with E2E_FAULT_INJECT_RENDER=pdf or =docx set"
    );
    test.setTimeout(150_000);

    /*
      Every real Generate Package attempt against THIS server run hits
      the same injected render fault (fixed for the whole server
      lifetime - see this file's header comment), so a genuinely
      successful application cannot be produced live through the UI
      within this run to serve as the "different, already-succeeded
      application" fixture. Seeding one directly via the admin client
      (mirroring the real completion shape a prior, fault-free run would
      have produced) is the pragmatic, honest way to establish that
      baseline without depending on cross-test/cross-run ordering.
    */
    const admin = adminClient();
    const OTHER_JOB_TITLE = "E2E-OTHER-APPLICATION-635";
    const { data: otherApp, error: otherAppError } = await admin
      .from("applications")
      .insert({
        user_id: user.userId,
        job_title: OTHER_JOB_TITLE,
        company: "E2E-OTHER-EMPLOYER-635 Inc.",
        generation_status: "succeeded",
        generation_engine: "canonical",
        cover_letter_text: `Pre-existing succeeded application. ${E2E_COVER_MARKER}`,
        email_draft: `Pre-existing succeeded application. ${E2E_EMAIL_MARKER}`,
      })
      .select("id, generation_status, cover_letter_text, email_draft")
      .single();
    expect(otherAppError).toBeNull();

    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });
    await generateWithRenderFaultAndAssertSafeFailure(page);

    const { data: reread } = await admin
      .from("applications")
      .select("id, generation_status, cover_letter_text, email_draft")
      .eq("id", otherApp!.id)
      .single();
    expect(reread).toEqual(otherApp);
  });

  test("L4. retrying after a render failure fails safely again and reuses the same application row, not a duplicate", async ({ page }) => {
    test.skip(
      process.env.E2E_FAULT_INJECT_RENDER !== "pdf" && process.env.E2E_FAULT_INJECT_RENDER !== "docx",
      "run with E2E_FAULT_INJECT_RENDER=pdf or =docx set"
    );
    // Two full generation cycles (each budgeted up to 170s inside the
    // shared helper) plus login/analyze overhead.
    test.setTimeout(360_000);

    await loginViaUi(page, user);
    await pasteAndAnalyze(page, E2E_SUPPORTED_JOB_POSTING);
    await expect(page.getByText(E2E_EMPLOYER_NAME).first()).toBeVisible({ timeout: 20_000 });

    const applicationId = await generateWithRenderFaultAndAssertSafeFailure(page);

    /*
      handleGeneratePackage() reuses the SAME generationRequestId set at
      analyze-time (see app/paste-job/page.tsx's own comment on
      generationRequestId - "or retries are idempotent on the server
      instead of creating duplicate applications"), and the Generate
      button returns to its normal idle/enabled state after a failure
      (isGenerationActive() only treats "submitting"/"pending" as active
      - see lib/generatePackage/pollingClient.ts), so a second click here
      on the SAME page is a real user-visible retry against the SAME row,
      not a fresh submission.

      generateWithRenderFaultAndAssertSafeFailure() always resolves the
      MOST RECENT row for this user+job_title (see its own comment on why
      - every test in this describe block shares one user/job_title). If
      the retry had created a genuinely NEW row instead of reclaiming this
      one, that new row would have a later created_at and would become
      "the most recent row" instead - so applicationIdRetry equalling the
      original applicationId is itself the proof no duplicate was created,
      independent of how many older rows already exist from earlier tests
      in this file.
    */
    const applicationIdRetry = await generateWithRenderFaultAndAssertSafeFailure(page);
    expect(applicationIdRetry).toBe(applicationId);
  });
});
