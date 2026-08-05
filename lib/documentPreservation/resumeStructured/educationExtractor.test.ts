/*
  TASK 5 gate test - education entry extraction, calibrated against
  real fixture shapes (bench/resume-A-junior-ats.pdf institution-first,
  threepage-pdf-resume.pdf/word-docx-resume.docx/regtest1 credential-
  first, google-docs-resume.docx single-line, bench/resume-C-mid-ats.pdf
  single-year-only certificate line). Run with
  `npx tsx lib/documentPreservation/resumeStructured/educationExtractor.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractEducationEntries } from "./educationExtractor";
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
function block(text: string, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const i = counter++;
  return { id: `block-p0-b${i}`, sourceElementIds: [`el-p0-e${i}`], text, rawText: text, pageIndex: 0, sourceOrder: i, blockType };
}

// --- institution-first (bench-A shape) ---
const instFirst = [block("Toronto Metropolitan University"), block("Bachelor of Commerce, Marketing | Toronto, ON - 2017 - 2021")];
const instFirstEntries = extractEducationEntries("s1", instFirst);
check("institution-first: institution correctly identified (not swapped with credential)", instFirstEntries[0].institution?.value, "Toronto Metropolitan University");
check("institution-first: credential extracted", instFirstEntries[0].credential?.value, "Bachelor of Commerce");
check("institution-first: fieldOfStudy extracted", instFirstEntries[0].fieldOfStudy?.value, "Marketing");
check("institution-first: dateRangeText extracted", instFirstEntries[0].dateRangeText?.value, "2017 - 2021");

// --- credential-first (threepage/word-docx/regtest1 shape) ---
counter = 0;
const credFirst = [block("Bachelor of Science in Nursing"), block("Toronto Metropolitan University, Toronto, ON — 2013 to 2017")];
const credFirstEntries = extractEducationEntries("s1", credFirst);
/* Phase 5D.3D - resolveCredentialsFromText now recovers the embedded
   "Degree in Major" pattern from a single unsplit credential line
   (splitDegreeInMajor, tried before the old comma-only
   splitCredentialField fallback) - "Bachelor of Science in Nursing"
   now correctly splits into credential + fieldOfStudy instead of
   staying one combined string, matching this round's generalized
   Double Degree/Major field-of-study extraction. */
check("credential-first: credential correctly identified despite coming FIRST in the text", credFirstEntries[0].credential?.value, "Bachelor of Science");
check("credential-first: fieldOfStudy extracted from embedded \"in Major\" pattern", credFirstEntries[0].fieldOfStudy?.value, "Nursing");
check("credential-first: institution correctly identified from the SECOND line", credFirstEntries[0].institution?.value, "Toronto Metropolitan University");
check("credential-first: location extracted from institution line", credFirstEntries[0].location?.value, "Toronto, ON");
check("credential-first: dateRangeText extracted", credFirstEntries[0].dateRangeText?.value, "2013 to 2017");

// --- single-line compact header (google-docs-resume.docx shape) ---
counter = 0;
const singleLine = [block("Bachelor of Commerce, Marketing, Simon Fraser University (2015 - 2019)")];
const singleLineEntries = extractEducationEntries("s1", singleLine);
check("single-line: 3-segment split, credential first", singleLineEntries[0].credential?.value, "Bachelor of Commerce");
check("single-line: fieldOfStudy is the middle segment", singleLineEntries[0].fieldOfStudy?.value, "Marketing");
check("single-line: institution is the last segment", singleLineEntries[0].institution?.value, "Simon Fraser University");

// --- single-year-only, no range (bench-C's certificate line real shape) ---
counter = 0;
const singleYear = [block("Certificate in Lean Six Sigma (Green Belt)"), block("SAIT Polytechnic, Calgary, AB - 2016")];
const singleYearEntries = extractEducationEntries("s1", singleYear);
checkTrue("single-year-only: entry still produced, not dropped", singleYearEntries.length === 1);
check("single-year-only: dateRangeText captures the bare year", singleYearEntries[0].dateRangeText?.value, "2016");
check("single-year-only: institution correctly identified", singleYearEntries[0].institution?.value, "SAIT Polytechnic");

// --- multi-entry boundary (2 degrees, no bullets) ---
counter = 0;
const multiDegree = [
  block("Master of Business Administration, Operations Management"),
  block("University of Calgary, Haskayne School of Business, Calgary, AB - 2018 - 2020"),
  block("Bachelor of Commerce, Supply Chain Management"),
  block("Mount Royal University, Calgary, AB - 2008 - 2012"),
];
const multiDegreeEntries = extractEducationEntries("s1", multiDegree);
check("multi-entry: two distinct degrees, not merged", multiDegreeEntries.length, 2);
check("multi-entry: entry1 credential", multiDegreeEntries[0].credential?.value, "Master of Business Administration");
check("multi-entry: entry2 credential", multiDegreeEntries[1].credential?.value, "Bachelor of Commerce");

// --- GPA extraction ---
counter = 0;
const withGpa = [block("Bachelor of Arts, Psychology"), block("University of Waterloo, Waterloo, ON - 2018 - 2022"), block("GPA: 3.85/4.0")];
const withGpaEntries = extractEducationEntries("s1", withGpa);
check("GPA: extracted from a trailing detail line", withGpaEntries[0].gpa?.value, "GPA: 3.85/4.0");

// --- honors detection ---
counter = 0;
const withHonors = [block("Bachelor of Science, Biology"), block("McGill University, Montreal, QC - 2016 - 2020"), block("Graduated with Honours, Dean's List all four years")];
const withHonorsEntries = extractEducationEntries("s1", withHonors);
checkTrue("honors: detail line with 'Honours'/'Dean's List' routed to honors[], not generic details[]", withHonorsEntries[0].honors.length === 1);

// --- degree ambiguity, but a generic INSTITUTION keyword ("University")
// still resolves it (Phase 5D.3B) - no degree keyword anywhere, but
// "University" on the second line is enough to identify it as the
// institution line without guessing at any specific school's name. ---
counter = 0;
const noDegreeKeyword = [block("Advanced Clinical Nutrition Workshop Series"), block("Dalhousie University - 2022")];
const noDegreeEntries = extractEducationEntries("s1", noDegreeKeyword);
check("institution-keyword fallback: credential is the non-institution line", noDegreeEntries[0].credential?.value, "Advanced Clinical Nutrition Workshop Series");
check("institution-keyword fallback: institution resolved via generic 'University' keyword", noDegreeEntries[0].institution?.value, "Dalhousie University");
checkTrue("institution-keyword fallback: no longer marked uncertain (both fields recovered)", !noDegreeEntries[0].isUncertain);
check("institution-keyword fallback: rawHeaderText preserved verbatim regardless", noDegreeEntries[0].rawHeaderText, "Advanced Clinical Nutrition Workshop Series\nDalhousie University - 2022");

// --- truly no lexical signal at all (neither degree nor institution
// keyword on either line) - Phase 5D.3B's positional fallback still
// preserves BOTH lines' text (never drops either), even though it
// can't confidently tell which is credential vs institution. ---
counter = 0;
const noSignalAtAll = [block("Advanced Workshop Series Alpha"), block("Beta Learning Centre - 2022")];
const noSignalEntries = extractEducationEntries("s1", noSignalAtAll);
checkTrue("no lexical signal: institution populated from the non-date line", noSignalEntries[0].institution !== undefined);
check("no lexical signal: institution is the non-date line's full text", noSignalEntries[0].institution?.value, "Advanced Workshop Series Alpha");
check("no lexical signal: credential recovered from the date line's own remainder", noSignalEntries[0].credential?.value, "Beta Learning Centre");
checkTrue("no lexical signal: reasonCodes disclose the positional fallback (not a guessed keyword match)", noSignalEntries[0].reasonCodes.includes("multi-line-header-positional-fallback-no-keyword-signal"));

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function checkRealFixture(fileName: string, format: "pdf" | "docx", expectedMinEntries: number) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });

  const eduSection = doc.sections.find((s) => s.normalizedType === "education");
  checkTrue(`${fileName}: has an education section`, eduSection !== undefined);
  if (!eduSection) return;
  const bodyBlocks = eduSection.blocks.filter((b) => b.blockType !== "heading");
  const entries = extractEducationEntries(eduSection.id, bodyBlocks);
  checkTrue(`${fileName}: at least ${expectedMinEntries} education entries detected`, entries.length >= expectedMinEntries);
  checkTrue(`${fileName}: every entry traces back to real blocks`, entries.every((e) => e.source.sourceBlockIds.length > 0));
}

async function main() {
  await checkRealFixture("bench/resume-A-junior-ats.pdf", "pdf", 2);
  await checkRealFixture("bench/resume-C-mid-ats.pdf", "pdf", 3);
  await checkRealFixture("threepage-pdf-resume.pdf", "pdf", 2);
  await checkRealFixture("regtest1-regulated-nurse-resume.docx", "docx", 1);
  await checkRealFixture("google-docs-resume.docx", "docx", 1);
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
