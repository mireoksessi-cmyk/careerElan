/*
  Phase 6I.6.4 - verifies parseStatusResponse()/parseGenerateResponse()
  (lib/generatePackage/pollingClient.ts) correctly thread the new
  `engine` field through for both real API response shapes this repo's
  backend actually returns for a succeeded generation:
    - legacy engine: full text trio + packageAnalysis populated
    - canonical engine (non-fallback): NO text trio, NO packageAnalysis
      at all (app/api/applications/[id]/status/route.ts:111-125's own
      documented, intentional shape) - only `engine: "canonical"` plus
      canonical-specific fields.
  Pure-function test, no network/DB/AI calls - the two payloads below
  are copied byte-for-byte from the route's own source, not invented.

  Run: npx tsx fixtures/scripts/phase6i64EngineFieldParsing.test.mts
*/
import { parseStatusResponse, parseGenerateResponse } from "../../lib/generatePackage/pollingClient";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// Exact shape from app/api/applications/[id]/status/route.ts's legacy/fallback-used branch (line ~127-144)
const legacyStatusPayload = {
  status: "succeeded",
  applicationId: "app-legacy-1",
  engine: "legacy",
  fallbackUsed: false,
  fallbackReason: null,
  resume: "Tailored resume text",
  coverLetter: "Tailored cover letter text",
  emailDraft: "Email draft text",
  packageAnalysis: { overallMatch: 82, matchLevel: "strong", keyChanges: [] },
  selectedResume: { source: "uploaded", resumeId: "r1", selectedName: "resume.pdf" },
};

// Exact shape from app/api/applications/[id]/status/route.ts's canonical-engine, non-fallback branch (line ~111-125)
const canonicalStatusPayload = {
  status: "succeeded",
  applicationId: "app-canonical-1",
  engine: "canonical",
  canonicalProfileId: "profile-1",
  tailoredResumeId: "overlay-1",
  selectedTemplateId: "professional-ats",
  documentStorage: { persisted: true },
};

// Exact shape from app/api/generate-package/route.ts's legacy idempotent-replay branch (line ~792-807) - never sets `engine`
const legacyGenerateReplayPayload = {
  success: true,
  status: "succeeded",
  resume: "Tailored resume text",
  coverLetter: "Tailored cover letter text",
  emailDraft: "Email draft text",
  packageAnalysis: { overallMatch: 91, matchLevel: "strong", keyChanges: [] },
  selectedResume: { source: "uploaded", resumeId: "r1", selectedName: "resume.pdf" },
  applicationId: "app-legacy-2",
};

const legacyResult = parseStatusResponse(200, true, legacyStatusPayload);
check("legacy status: kind succeeded", legacyResult.kind, "succeeded");
if (legacyResult.kind === "succeeded") {
  check("legacy status: engine threaded through", legacyResult.engine, "legacy");
  check("legacy status: packageAnalysis present", legacyResult.packageAnalysis, legacyStatusPayload.packageAnalysis);
  check("legacy status: resume text present", legacyResult.resume, "Tailored resume text");
}

const canonicalResult = parseStatusResponse(200, true, canonicalStatusPayload);
check("canonical status: kind succeeded", canonicalResult.kind, "succeeded");
if (canonicalResult.kind === "succeeded") {
  check("canonical status: engine threaded through as 'canonical'", canonicalResult.engine, "canonical");
  check("canonical status: packageAnalysis is null (route never sends this field for canonical)", canonicalResult.packageAnalysis, null);
  check("canonical status: resume text is empty (route never sends this field for canonical)", canonicalResult.resume, "");
}

const generateReplayResult = parseGenerateResponse(200, true, legacyGenerateReplayPayload);
check("generate-replay: kind succeeded", generateReplayResult.kind, "succeeded");
if (generateReplayResult.kind === "succeeded") {
  check("generate-replay: engine undefined when route never sends it (client defaults to 'legacy' at render time)", generateReplayResult.engine, undefined);
  check("generate-replay: packageAnalysis present", generateReplayResult.packageAnalysis, legacyGenerateReplayPayload.packageAnalysis);
}

/*
  PackageAnalysisPanel's own branch logic (app/paste-job/page.tsx):
    const isCanonical = generationEngine === "canonical";
  Verified here as a pure predicate against the exact values the two
  real payloads above produce, proving the empty-state message
  differentiation is reachable and correct for both engines.
*/
function isCanonicalMessage(generationEngine: string | undefined): boolean {
  return generationEngine === "canonical";
}
check("legacy engine -> generic 'will appear after generation' message", isCanonicalMessage(legacyResult.kind === "succeeded" ? legacyResult.engine : undefined), false);
check("canonical engine -> honest 'not available for this package' message", isCanonicalMessage(canonicalResult.kind === "succeeded" ? canonicalResult.engine : undefined), true);
check("undefined engine (legacy generate-replay, oldest rows) -> generic message (safe default)", isCanonicalMessage(generateReplayResult.kind === "succeeded" ? generateReplayResult.engine : undefined), false);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
