/*
  TASK 5 gate test - alias-exact-match precedence, content-rule
  classification, low-confidence custom fallback, context-boost
  support-only behavior, and the AI stub's must-not-be-callable
  contract. Pure synthetic unit tests (no fixtures/AI/network needed -
  this layer operates on SemanticContentBlock[], already covered against
  real fixtures by blockAdapter.test.ts/sectionBoundaryDetector.test.ts).
  Run with `npx tsx lib/documentPreservation/losslessSemantic/classifier.test.ts`.
*/
import { classifySection } from "./classifier";
import { classifyAmbiguousSectionWithAi } from "./aiClassifierStub";
import type { SemanticContentBlock } from "./types";

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

let counter = 0;
function block(text: string, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const i = counter++;
  return {
    id: `block-p0-b${i}`,
    sourceElementIds: [`el-p0-e${i}`],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: i,
    blockType,
  };
}

// --- alias exact match wins regardless of body content ---
const aliasResult = classifySection("Professional Summary", [block("This person managed teams from 2019 - 2022 with bullet-style achievements.")]);
check("alias exact match: type", aliasResult.normalizedType, "summary");
check("alias exact match: method", aliasResult.classificationMethod, "dictionary");
checkTrue("alias exact match: high confidence", aliasResult.confidence >= 0.9);

// --- content-rule classification: ambiguous heading, real experience-shaped body ---
const experienceBody: SemanticContentBlock[] = [
  block("Senior Analyst, Acme Corp — 2019 - 2022", "paragraph"),
  block("Led a cross-functional initiative", "bullet"),
  block("Reduced costs by 15% year over year", "bullet"),
  block("Analyst, Beta Inc — 2016 - 2019", "paragraph"),
  block("Built quarterly reporting pipeline", "bullet"),
];
const experienceResult = classifySection("Experience Highlights", experienceBody);
check("content-rule classification: ambiguous heading + experience-shaped body -> experience", experienceResult.normalizedType, "experience");
check("content-rule classification: method", experienceResult.classificationMethod, "content-rule");

// --- content-rule classification: education-shaped body under unmatched heading ---
const educationBody: SemanticContentBlock[] = [
  block("Bachelor of Science in Computer Science", "paragraph"),
  block("University of Somewhere, GPA 3.8", "paragraph"),
  block("2014 - 2018", "paragraph"),
];
const educationResult = classifySection("Academic Path", educationBody);
check("content-rule classification: education-shaped body -> education", educationResult.normalizedType, "education");

// --- content-rule classification: skills-shaped body ---
const skillsBody: SemanticContentBlock[] = [
  block("Python, TypeScript, SQL, Docker", "bullet"),
  block("Kubernetes, AWS, Terraform, CI/CD", "bullet"),
];
const skillsResult = classifySection("What I Know", skillsBody);
check("content-rule classification: skills-shaped body -> skills", skillsResult.normalizedType, "skills");

// --- low-confidence custom fallback: genuinely ambiguous/thin content ---
const thinBody: SemanticContentBlock[] = [block("A short note about something.", "paragraph")];
const thinResult = classifySection("Board & Leadership Activities", thinBody);
check("low-confidence fallback: unknown heading + thin evidence -> custom", thinResult.normalizedType, "custom");
check("low-confidence fallback: method", thinResult.classificationMethod, "fallback");
check("low-confidence fallback: confidence is zero", thinResult.confidence, 0);
checkTrue(
  "low-confidence fallback: reasonCodes explain the fallback",
  thinResult.reasonCodes.some((c) => c.includes("below-classification-confidence-threshold"))
);

// --- combined heading preserved as custom rather than force-split ---
const combinedBody: SemanticContentBlock[] = [
  block("Registered Nurse License, British Columbia", "bullet"),
  block("Certified Wound Care Specialist", "bullet"),
];
const combinedResult = classifySection("Licenses & Certifications", combinedBody);
checkTrue(
  "combined heading: classifies as either licenses or certifications, never forced to an unrelated type",
  combinedResult.normalizedType === "licenses" || combinedResult.normalizedType === "certifications" || combinedResult.normalizedType === "custom"
);

// --- context boost is support-only: zero content evidence + context still yields custom ---
const emptyNarrativeBody: SemanticContentBlock[] = [block("Hi.", "paragraph")];
const contextOnlyResult = classifySection("Board & Leadership Activities", emptyNarrativeBody, {
  isFirstSectionInDocument: true,
  immediatelyFollowsIdentityBlocks: true,
});
check("context-only: cannot confirm a type from context signal alone (zero content evidence)", contextOnlyResult.normalizedType, "custom");

// --- context boost DOES help when content evidence already exists but is borderline ---
const borderlineSummaryBody: SemanticContentBlock[] = [
  block(
    "A dedicated professional with a demonstrated history of delivering results across cross-functional teams and complex programs.",
    "paragraph"
  ),
];
const withoutContext = classifySection("Snapshot", borderlineSummaryBody);
const withContext = classifySection("Snapshot", borderlineSummaryBody, {
  isFirstSectionInDocument: true,
  immediatelyFollowsIdentityBlocks: true,
});
checkTrue(
  "context boost: confidence with context >= confidence without context for the same body",
  (withContext.normalizedType === "summary" ? withContext.confidence : 0) >= (withoutContext.normalizedType === "summary" ? withoutContext.confidence : 0)
);

// --- no-heading section still runs content rules (headingText null) ---
const noHeadingExperience = classifySection(null, experienceBody);
check("no-heading section: content rules still run when headingText is null", noHeadingExperience.normalizedType, "experience");

// --- AI classifier stub must not be silently callable/usable in the main path ---
let aiStubThrew = false;
try {
  classifyAmbiguousSectionWithAi({ headingText: null, bodyBlocks: [] });
} catch {
  aiStubThrew = true;
}
checkTrue("AI classifier stub throws rather than silently classifying (Phase 1 must never call it)", aiStubThrew);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
