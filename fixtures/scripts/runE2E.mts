/*
  E2E runner (Phase 1-4 Hardening follow-up: real PDF/DOCX E2E
  verification round). Drives the REAL Generate Package path end to end
  for each seeded fixture:

    real login (via the actual /login modal on the homepage - login_id
    defaults to the email's local-part via handle_new_user()'s own
    fallback, so no extra seeding was needed for this) -> real POST
    /api/generate-package (claim + enqueue, exactly as a real click on
    the product's own "Generate Package" button would do) -> the REAL
    local-dev worker (app/api/internal/generate-package-worker/route.ts)
    runs runPackageGeneration() in-process on the dev server, calling
    real OpenAI, real Protected Claims validation, and real DPE
    (runDpePreservationForApplication) -> real DB save via
    complete_generate_package_generation.

  This script only drives the HTTP/browser side and polls the DB for the
  final outcome; it does not call any DPE/Generate Package internals
  directly (that introspection happens separately in
  fixtures/scripts/introspectDpe.mts, reusing the SAME real artifacts
  this run produces).
*/
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { RESUME_FIXTURES, COVER_LETTER_FIXTURE, E2E_PASSWORD } from "./seedE2E.mts";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

type JobPosting = { title: string; company: string; description: string };

// Each job posting is a real, substantive, Canadian PRIVATE-sector
// posting (not a one-liner) so validateCanadianScope has real text to
// classify from, and is a plausible next step for that fixture's own
// resume content (different employer than the one already on the
// resume, so this is a genuine "applying elsewhere" scenario, not a
// same-employer re-application).
const JOB_POSTINGS: Record<string, JobPosting> = {
  word_docx: {
    title: "Senior Frontend Developer",
    company: "Pacific Coast Apparel",
    description: `Pacific Coast Apparel is a Vancouver, BC based private retail company looking for a Senior Frontend Developer to join our e-commerce engineering team.

Location: Vancouver, British Columbia, Canada
Employment type: Full-time, permanent
Company type: Private retail company (not a government or public-sector employer)

Responsibilities:
- Build and maintain customer-facing React applications for our online storefront
- Improve page load performance and Core Web Vitals scores
- Collaborate with backend engineers on REST API integration
- Mentor junior frontend developers and participate in code reviews

Requirements:
- 4+ years of professional frontend development experience
- Strong experience with React, TypeScript, and modern CSS
- Experience improving web application performance
- Experience mentoring junior engineers

This is a private-sector position based in British Columbia, Canada.`,
  },
  standard_pdf: {
    title: "Supply Chain Analyst",
    company: "Rocky Mountain Energy Partners",
    description: `Rocky Mountain Energy Partners is a private energy-sector logistics company based in Calgary, Alberta, Canada, seeking a Supply Chain Analyst.

Location: Calgary, Alberta, Canada
Employment type: Full-time, permanent
Company type: Private energy logistics company

Responsibilities:
- Analyze and improve inventory reconciliation and vendor delivery workflows
- Build reporting dashboards for the regional operations team
- Track vendor performance across multiple suppliers

Requirements:
- 3+ years of experience in operations or supply chain analysis
- Strong Excel and Power BI skills
- Experience with vendor management and process improvement
- Background in Business Administration or Supply Chain Management preferred

This is a private-sector position based in Alberta, Canada.`,
  },
  canva_pdf: {
    title: "Product Designer",
    company: "Bayview Fintech",
    description: `Bayview Fintech is a private consumer banking technology company based in Toronto, Ontario, Canada, hiring a Product Designer.

Location: Toronto, Ontario, Canada
Employment type: Full-time, permanent
Company type: Private fintech company

Responsibilities:
- Design and maintain UI/UX for our consumer banking application
- Establish and evolve a shared component library across product teams
- Conduct user research to inform design decisions

Requirements:
- 5+ years of experience in UX/product design
- Strong portfolio in Figma and Adobe XD
- Experience building and maintaining design systems
- Experience with user research methods

This is a private-sector position based in Ontario, Canada.`,
  },
  google_docs_docx: {
    title: "Marketing Coordinator",
    company: "Harbourfront Consumer Goods",
    description: `Harbourfront Consumer Goods is a private consumer packaged goods company based in Richmond, British Columbia, Canada, hiring a Marketing Coordinator.

Location: Richmond, British Columbia, Canada
Employment type: Full-time, permanent
Company type: Private consumer goods company

Responsibilities:
- Manage social media campaigns and email newsletter marketing
- Coordinate in-store promotions and supplier partnerships
- Track and report on campaign performance metrics

Requirements:
- 2+ years of experience in marketing coordination
- Experience with email marketing platforms and social media management
- Experience with Adobe Photoshop and Google Analytics
- Bachelor's degree in Marketing, Commerce, or related field

This is a private-sector position based in British Columbia, Canada.`,
  },
  pdf_cover_letter: {
    title: "Frontend Developer",
    company: "Cascade Digital Solutions",
    description: `Cascade Digital Solutions is a private web development agency based in Vancouver, British Columbia, Canada, hiring a Frontend Developer.

Location: Vancouver, British Columbia, Canada
Employment type: Full-time, permanent
Company type: Private web development agency

Responsibilities:
- Build customer-facing web applications for retail and logistics clients
- Improve application performance and reliability
- Collaborate with designers and backend engineers

Requirements:
- 3+ years of professional frontend development experience
- Experience with React and modern JavaScript
- Experience with performance optimization

This is a private-sector position based in British Columbia, Canada.`,
  },
};

export type FixtureRunResult = {
  key: string;
  label: string;
  loginSucceeded: boolean;
  generatePackageHttpStatus: number | null;
  generatePackageHttpBody: unknown;
  applicationId: string | null;
  generationRequestId: string;
  finalGenerationStatus: string | null;
  finalRow: Record<string, unknown> | null;
  error: string | null;
};

async function pollApplicationRow(userClient: ReturnType<typeof createClient>, applicationId: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await userClient
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw new Error(`Polling applications row failed: ${error.message}`);
    if (data && (data as any).generation_status !== "pending") {
      return data as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

export async function runFixtureE2E(
  fixtureKey: string,
  email: string,
  label: string
): Promise<FixtureRunResult> {
  const posting = JOB_POSTINGS[fixtureKey];
  if (!posting) throw new Error(`No job posting configured for fixture key ${fixtureKey}`);

  const loginId = email.split("@")[0];
  const result: FixtureRunResult = {
    key: fixtureKey,
    label,
    loginSucceeded: false,
    generatePackageHttpStatus: null,
    generatePackageHttpBody: null,
    applicationId: null,
    generationRequestId: crypto.randomUUID(),
    finalGenerationStatus: null,
    finalRow: null,
    error: null,
  };

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByPlaceholder("ID", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByPlaceholder("ID", { exact: true }).fill(loginId);
    await page.getByPlaceholder("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    result.loginSucceeded = true;

    const response = await context.request.post(`${BASE_URL}/api/generate-package`, {
      data: {
        jobDescription: posting.description,
        jobAnalysis: { title: posting.title, company: posting.company },
        generationRequestId: result.generationRequestId,
      },
      timeout: 30_000,
    });

    result.generatePackageHttpStatus = response.status();
    result.generatePackageHttpBody = await response.json().catch(() => null);

    const applicationId = (result.generatePackageHttpBody as any)?.applicationId ?? null;
    result.applicationId = applicationId;

    if (response.status() !== 202 || !applicationId) {
      result.error = `Generate Package HTTP call did not return 202+applicationId (status=${response.status()}, body=${JSON.stringify(result.generatePackageHttpBody)})`;
      return result;
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await userClient.auth.signInWithPassword({ email, password: E2E_PASSWORD });
    if (signInError) throw new Error(`Re-sign-in for polling failed: ${signInError.message}`);

    const finalRow = await pollApplicationRow(userClient, applicationId);
    if (!finalRow) {
      result.error = `Timed out after ${POLL_TIMEOUT_MS}ms waiting for generation_status to leave "pending".`;
      return result;
    }

    result.finalRow = finalRow;
    result.finalGenerationStatus = (finalRow as any).generation_status ?? null;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await browser.close();
  }

  return result;
}

export async function runAllFixturesE2E(): Promise<FixtureRunResult[]> {
  const results: FixtureRunResult[] = [];

  for (const fixture of RESUME_FIXTURES) {
    console.log(`\n=== Running real Generate Package E2E: ${fixture.label} (${fixture.email}) ===`);
    const result = await runFixtureE2E(fixture.key, fixture.email, fixture.label);
    console.log(JSON.stringify(result, null, 2));
    results.push(result);
  }

  console.log(`\n=== Running real Generate Package E2E: ${COVER_LETTER_FIXTURE.label} (${COVER_LETTER_FIXTURE.email}) ===`);
  const coverLetterResult = await runFixtureE2E(COVER_LETTER_FIXTURE.key, COVER_LETTER_FIXTURE.email, COVER_LETTER_FIXTURE.label);
  console.log(JSON.stringify(coverLetterResult, null, 2));
  results.push(coverLetterResult);

  return results;
}

import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runAllFixturesE2E()
    .then((results) => {
      console.log("\n--- ALL RUNS COMPLETE ---");
      console.log(JSON.stringify(results, null, 2));
    })
    .catch((err) => {
      console.error("RUN FAILED:", err);
      process.exit(1);
    });
}
