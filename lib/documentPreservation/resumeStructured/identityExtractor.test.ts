/*
  TASK 3 gate test - identity extraction. Synthetic unit tests for
  pattern matching + false-positive prevention, plus real-fixture checks
  confirming the identityBlocks-vs-first-custom-section fallback works
  against actual Phase 1 output.
  Run with `npx tsx lib/documentPreservation/resumeStructured/identityExtractor.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractIdentity, hasIdentitySignal } from "./identityExtractor";
import type { SemanticContentBlock } from "../losslessSemantic/types";

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
function block(text: string): SemanticContentBlock {
  const i = counter++;
  return {
    id: `block-p0-b${i}`,
    sourceElementIds: [`el-p0-e${i}`],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: i,
    blockType: "paragraph",
  };
}

// --- synthetic: pipe-delimited contact line ---
const pipeBlocks = [block("David Nguyen"), block("Calgary, AB | (403) 555-0147 | david.nguyen@example.com | linkedin.com/in/davidnguyen")];
const pipeIdentity = extractIdentity("section-s0", pipeBlocks);
check("pipe-delimited: fullName extracted verbatim", pipeIdentity.fullName?.value, "David Nguyen");
check("pipe-delimited: email extracted", pipeIdentity.email?.value, "david.nguyen@example.com");
check("pipe-delimited: phone extracted", pipeIdentity.phone?.value, "(403) 555-0147");
check("pipe-delimited: location extracted", pipeIdentity.location?.value, "Calgary, AB");
check("pipe-delimited: linkedin extracted", pipeIdentity.linkedin?.value, "linkedin.com/in/davidnguyen");

// --- synthetic: middot-delimited, different field order ---
counter = 0;
const middotBlocks = [block("Emily Tran"), block("emily.tran@example.com · (604) 555-0182 · Vancouver, BC")];
const middotIdentity = extractIdentity("section-s0", middotBlocks);
check("middot-delimited, different order: email still correctly classified", middotIdentity.email?.value, "emily.tran@example.com");
check("middot-delimited, different order: phone still correctly classified", middotIdentity.phone?.value, "(604) 555-0182");
check("middot-delimited, different order: location still correctly classified", middotIdentity.location?.value, "Vancouver, BC");

// --- false-positive prevention ---
counter = 0;
const emailFirstBlocks = [block("david.nguyen@example.com"), block("Calgary, AB")];
const emailFirstIdentity = extractIdentity("section-s0", emailFirstBlocks);
check("false-positive prevention: an email as the FIRST block is never mistaken for a name", emailFirstIdentity.fullName, undefined);

counter = 0;
const cityFirstBlocks = [block("Rachel Kim"), block("Toronto, ON | (555) 010-2231 | rachel.kim@example.com")];
const cityFirstIdentity = extractIdentity("section-s0", cityFirstBlocks);
check("false-positive prevention: a city line is never mistaken for a headline", cityFirstIdentity.headline, undefined);

check("false-positive prevention: no country/address invented beyond source text", cityFirstIdentity.location?.value, "Toronto, ON");

// --- headline (a real short title line under the name, not a contact line) ---
counter = 0;
const headlineBlocks = [block("Priya Chandran"), block("Registered Dietitian"), block("Halifax, NS | priya.chandran@example.com")];
const headlineIdentity = extractIdentity("section-s0", headlineBlocks);
check("headline: short non-contact line under name is captured as headline", headlineIdentity.headline?.value, "Registered Dietitian");
check("headline: original casing preserved verbatim (never forced to Title Case)", headlineIdentity.fullName?.value, "Priya Chandran");

// --- hasIdentitySignal ---
counter = 0;
checkTrue("hasIdentitySignal: true for a block set containing an email", hasIdentitySignal([block("john@example.com")]));
counter = 0;
checkTrue("hasIdentitySignal: false for a block set with no email/phone", !hasIdentitySignal([block("Board & Leadership Activities")]));

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function checkRealFixture(fileName: string, format: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });

  if (doc.identityBlocks.length > 0) {
    const identity = extractIdentity("identity", doc.identityBlocks);
    checkTrue(`${fileName}: real identityBlocks path extracts a name`, identity.fullName !== undefined);
    checkTrue(`${fileName}: real identityBlocks path extracts an email or phone`, identity.email !== undefined || identity.phone !== undefined);
  } else {
    const first = doc.sections[0];
    checkTrue(`${fileName}: no identityBlocks -> first section is identity-shaped (custom + identity signal)`, first.normalizedType === "custom" && hasIdentitySignal(first.blocks));
    const identity = extractIdentity(first.id, first.blocks);
    checkTrue(`${fileName}: fallback path extracts a name from the mis-segmented first section`, identity.fullName !== undefined);
    checkTrue(`${fileName}: fallback path extracts an email or phone`, identity.email !== undefined || identity.phone !== undefined);
  }
}

async function main() {
  await checkRealFixture("standard-pdf-resume.pdf", "pdf");
  await checkRealFixture("google-docs-resume.docx", "docx");
  await checkRealFixture("word-docx-resume.docx", "docx");
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
