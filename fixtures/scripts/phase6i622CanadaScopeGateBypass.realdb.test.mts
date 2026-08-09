/*
  Phase 6I.6.22 - Part L (bypass regression), Part M (UNKNOWN-passes-gate),
  and Part J (client-flag-spoofing resistance) proofs, using real, imported
  production code - not re-implemented/simulated logic.

  No real OpenAI call anywhere in this file. No real Supabase network call
  either: `supabase` is passed as a Proxy that THROWS on any property
  access, so if dispatchCanonicalGeneration() ever failed to short-circuit
  on an UNSUPPORTED jobText (i.e. the bug this phase fixes reappeared), this
  test would fail loudly with a proxy-trap error instead of silently
  passing - the negative-path proof is causal, not just an assertion on the
  returned status code. isNetlifyProductionRuntime() is false in this local
  run (NETLIFY/CONTEXT unset), so quota reservation (the one path that would
  touch the real supabaseAdmin singleton) is skipped structurally for every
  case in this file - never invoked, positive or negative.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i622CanadaScopeGateBypass.realdb.test.mts
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dispatchCanonicalGeneration, type CanonicalDispatchParams } from "../../lib/careerMemory/orchestration/canonicalGenerateDispatchService";
import { assertCanadaJobScopeAllowed, GenerationValidationError } from "../../lib/generatePackage/shared";
import { CANADA_SCOPE_UNSUPPORTED_MESSAGE } from "../../lib/jobPosting/canadaScopeClassifier";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

const UNTOUCHED_SUPABASE = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`UNTOUCHED_SUPABASE proxy trap fired on property "${String(prop)}" - the Canada-scope gate did not short-circuit before touching supabase.`);
    },
  }
) as unknown as CanonicalDispatchParams["supabase"];

function baseParams(overrides: Partial<CanonicalDispatchParams>): CanonicalDispatchParams {
  return {
    supabase: UNTOUCHED_SUPABASE,
    userId: "00000000-0000-0000-0000-000000000000",
    memory: null,
    generationRequestId: "11111111-1111-1111-1111-111111111111",
    jobText: "",
    title: "Test Title",
    company: "Test Company",
    applicantName: "Test Applicant",
    analysis: {},
    jobUrl: null,
    body: {},
    requestOrigin: "http://localhost:3000",
    routingReason: "test",
    canaryStage: 0,
    ...overrides,
  };
}

const NON_CANADA_JOB_TEXT = "Location: New York, NY. On-site role, 5 days a week. US residents only.";
const CANADA_JOB_TEXT = "Location: Toronto, Ontario. We are hiring a software developer.";
const UNKNOWN_GEO_JOB_TEXT = "Location: Remote. Join our growing team!";

async function main() {
  /* ==================== Part L - canonical bypass regression: explicit non-Canada job must be blocked before any DB/AI call ==================== */
  {
    const res = await dispatchCanonicalGeneration(baseParams({ jobText: NON_CANADA_JOB_TEXT }));
    check("canonical: UNSUPPORTED jobText -> HTTP 422", res.status, 422);
    const json = await res.json();
    check("canonical: UNSUPPORTED jobText -> code CANADIAN_SCOPE_FAILED", json.code, "CANADIAN_SCOPE_FAILED");
    check("canonical: UNSUPPORTED jobText -> safe generic error message", json.error, CANADA_SCOPE_UNSUPPORTED_MESSAGE);
    checkTrue("canonical: UNSUPPORTED jobText -> never touched supabase (0 DB/AI calls, proxy did not trap)", true);
  }

  /* ==================== Part J - client-supplied flag spoofing must not override the server-computed classification ==================== */
  {
    const spoofedAnalysis = {
      jobContext: {
        country: "Canada",
        supportedByCareerElan: true,
        isCanadian: true,
        canadaScope: "SUPPORTED",
      },
    };
    const res = await dispatchCanonicalGeneration(
      baseParams({ jobText: NON_CANADA_JOB_TEXT, analysis: spoofedAnalysis, body: { supportedByCareerElan: true, country: "Canada", isCanadian: true } })
    );
    check("canonical: spoofed client flags do not bypass the gate -> still HTTP 422", res.status, 422);
    const json = await res.json();
    check("canonical: spoofed client flags -> still CANADIAN_SCOPE_FAILED", json.code, "CANADIAN_SCOPE_FAILED");
  }

  /* ==================== Part M - SUPPORTED/UNKNOWN must pass the gate (proven by getting far enough to touch supabase, which then throws our proxy trap) ==================== */
  for (const [label, jobText] of [
    ["SUPPORTED (Toronto)", CANADA_JOB_TEXT],
    ["UNKNOWN (Remote, no geography)", UNKNOWN_GEO_JOB_TEXT],
  ] as const) {
    let threwProxyTrap = false;
    let sawGateBlock = false;
    try {
      const res = await dispatchCanonicalGeneration(baseParams({ jobText }));
      if (res.status === 422) {
        const json = await res.json();
        if (json.code === "CANADIAN_SCOPE_FAILED") sawGateBlock = true;
      }
    } catch (error) {
      threwProxyTrap = error instanceof Error && error.message.includes("UNTOUCHED_SUPABASE proxy trap fired");
    }
    checkTrue(`canonical: ${label} jobText -> gate does NOT block (proceeds past Canada-scope check into resume resolution)`, threwProxyTrap && !sawGateBlock);
  }

  /* ==================== Part L - legacy: assertCanadaJobScopeAllowed() throws for UNSUPPORTED, passes for SUPPORTED/UNKNOWN ==================== */
  {
    let threw = false;
    let code: string | undefined;
    try {
      assertCanadaJobScopeAllowed(NON_CANADA_JOB_TEXT);
    } catch (error) {
      threw = true;
      if (error instanceof GenerationValidationError) code = error.code;
    }
    checkTrue("legacy: assertCanadaJobScopeAllowed throws for UNSUPPORTED jobText", threw);
    check("legacy: thrown error code is CANADIAN_SCOPE_FAILED", code, "CANADIAN_SCOPE_FAILED");
  }
  {
    let threw = false;
    try {
      assertCanadaJobScopeAllowed(CANADA_JOB_TEXT);
    } catch {
      threw = true;
    }
    checkTrue("legacy: assertCanadaJobScopeAllowed does NOT throw for SUPPORTED jobText", !threw);
  }
  {
    let threw = false;
    try {
      assertCanadaJobScopeAllowed(UNKNOWN_GEO_JOB_TEXT);
    } catch {
      threw = true;
    }
    checkTrue("legacy: assertCanadaJobScopeAllowed does NOT throw for UNKNOWN jobText", !threw);
  }

  /* ==================== Part L - legacy: static source-order proof that the gate runs BEFORE Call1 (0 OpenAI invocations for UNSUPPORTED) ==================== */
  {
    const generateCoreSource = readFileSync(join(__dirname, "../../lib/generatePackage/generateCore.ts"), "utf8");
    const runPackageGenerationStart = generateCoreSource.indexOf("export async function runPackageGeneration");
    checkTrue("static: runPackageGeneration() found in generateCore.ts", runPackageGenerationStart !== -1);

    const gateCallIndex = generateCoreSource.indexOf("assertCanadaJobScopeAllowed(jobText)", runPackageGenerationStart);
    const firstCallOpenAiIndex = generateCoreSource.indexOf("callOpenAiWithRetry(", runPackageGenerationStart);
    checkTrue("static: assertCanadaJobScopeAllowed(jobText) call found inside runPackageGeneration", gateCallIndex !== -1);
    checkTrue("static: first callOpenAiWithRetry(...) call found inside runPackageGeneration", firstCallOpenAiIndex !== -1);
    checkTrue("static: gate call appears BEFORE the first OpenAI call in source order (Part H/L: 0 invocations for UNSUPPORTED)", gateCallIndex < firstCallOpenAiIndex);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
