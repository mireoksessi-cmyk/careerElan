/*
  TASK 4 gate test - experience/volunteer entry extraction. Covers
  entry-boundary patterns A-E from spec section 9, professional/
  volunteer separation, and real-fixture verification against the
  hardest cases found during design research: bench/resume-C-mid-
  ats.pdf and threepage-pdf-resume.pdf (5-6 entries, ZERO bullets),
  google-docs-resume.docx (one-line header, no bullets),
  generated-table-resume.pdf (organization-first line order).
  Run with `npx tsx lib/documentPreservation/resumeStructured/experienceExtractor.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractExperienceEntries, segmentEntryRanges } from "./experienceExtractor";
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

// --- Pattern A: Role\nCompany,Location-Date\nBullets ---
const patternA = [
  block("Marketing Coordinator"),
  block("Northgate Consumer Brands, Mississauga, ON - Jun 2023 - Present"),
  block("Coordinate quarterly campaigns.", "bullet"),
  block("Manage the content calendar.", "bullet"),
];
const entriesA = extractExperienceEntries("s1", patternA, false);
check("pattern A: exactly one entry", entriesA.length, 1);
check("pattern A: role extracted", entriesA[0].role?.value, "Marketing Coordinator");
check("pattern A: organization extracted", entriesA[0].organization?.value, "Northgate Consumer Brands");
check("pattern A: location extracted", entriesA[0].location?.value, "Mississauga, ON");
check("pattern A: dateRangeText extracted verbatim", entriesA[0].dateRangeText?.value, "Jun 2023 - Present");
check("pattern A: 2 bullets captured", entriesA[0].bullets.length, 2);
check("pattern A: not uncertain (both role+organization resolved)", entriesA[0].isUncertain, false);

// --- Pattern C: one-line "Role, Company, Location (Date)" ---
counter = 0;
const patternC = [
  block("Marketing Coordinator, Pacific Grove Foods, Richmond, BC (2021 - Present)"),
  block("Manage social media campaigns and email newsletters for a regional grocery brand."),
  block("Increased newsletter open rate from 18% to 27% over one year."),
  block("Marketing Assistant, Fraser Valley Co-op, Abbotsford, BC (2019 - 2021)"),
  block("Coordinated in-store promotions and supplier partnership events."),
];
const entriesC = extractExperienceEntries("s1", patternC, false);
check("pattern C (google-docs shape): TWO entries correctly separated despite zero bullets", entriesC.length, 2);
check("pattern C: entry1 role/org/location", [entriesC[0].role?.value, entriesC[0].organization?.value, entriesC[0].location?.value], [
  "Marketing Coordinator",
  "Pacific Grove Foods",
  "Richmond, BC",
]);
check("pattern C: entry1 has 2 description paragraphs, zero bullets", [entriesC[0].descriptionParagraphs.length, entriesC[0].bullets.length], [2, 0]);
check("pattern C: entry2 role/org/location", [entriesC[1].role?.value, entriesC[1].organization?.value, entriesC[1].location?.value], [
  "Marketing Assistant",
  "Fraser Valley Co-op",
  "Abbotsford, BC",
]);

// --- Pattern D: Company\nRole|Date (organization-first, generated-table-resume shape) ---
counter = 0;
const patternD = [block("Acme Corp"), block("Software Engineer | 2019-01 - Present"), block("Built internal tools used by 40+ engineers.", "bullet")];
const entriesD = extractExperienceEntries("s1", patternD, false);
check("pattern D (organization-first): organization is 'Acme Corp', not the role", entriesD[0].organization?.value, "Acme Corp");
check("pattern D (organization-first): role correctly pulled from the date line, not swapped", entriesD[0].role?.value, "Software Engineer");
check("pattern D: dateRangeText handles YYYY-MM format", entriesD[0].dateRangeText?.value, "2019-01 - Present");

// --- multi-role-same-employer boundary (5-entry bench-C shape, synthetic minimal) ---
counter = 0;
const multiRole = [
  block("Operations Manager"),
  block("Foothills Distribution Group, Calgary, AB - Mar 2020 - Present"),
  block("Oversee daily operations of a large distribution centre serving several retail"),
  block("accounts across the province."),
  block("Assistant Operations Manager"),
  block("Foothills Distribution Group, Calgary, AB - Jul 2017 - Feb 2020"),
  block("Supervised a team of 18 warehouse associates across two shifts."),
];
const multiRoleEntries = extractExperienceEntries("s1", multiRole, false);
check("multi-role same employer: two distinct entries, not merged into one", multiRoleEntries.length, 2);
check("multi-role same employer: both entries correctly attribute the SAME organization", [multiRoleEntries[0].organization?.value, multiRoleEntries[1].organization?.value], [
  "Foothills Distribution Group",
  "Foothills Distribution Group",
]);
check("multi-role same employer: distinct roles", [multiRoleEntries[0].role?.value, multiRoleEntries[1].role?.value], ["Operations Manager", "Assistant Operations Manager"]);

// --- date-less entry (required test case) ---
counter = 0;
const dateless = [block("Freelance Consultant"), block("Assisted several small businesses with bookkeeping and tax preparation.")];
const datelessEntries = extractExperienceEntries("s1", dateless, false);
check("date-less entry: NOT deleted, preserved as a single uncertain entry", datelessEntries.length, 1);
checkTrue("date-less entry: isUncertain=true (no date evidence to split fields)", datelessEntries[0].isUncertain);
check("date-less entry: raw header text preserved verbatim regardless", datelessEntries[0].rawHeaderText, "Freelance Consultant");
checkTrue("date-less entry: description paragraph preserved, not dropped", datelessEntries[0].descriptionParagraphs.length >= 1);

// --- bullet-less entry (required test case, distinct from date-less) ---
counter = 0;
const bulletless = [
  block("Senior Analyst"),
  block("Meridian Capital Partners, Toronto, ON - Jan 2019 - Dec 2021"),
  block("Provided financial modeling and valuation support for mid-market transactions."),
];
const bulletlessEntries = extractExperienceEntries("s1", bulletless, false);
check("bullet-less entry: exactly one entry, not dropped", bulletlessEntries.length, 1);
check("bullet-less entry: description paragraph captured, zero bullets", [bulletlessEntries[0].descriptionParagraphs.length, bulletlessEntries[0].bullets.length], [1, 0]);
checkTrue("bullet-less entry: role/organization still resolved despite no bullets", bulletlessEntries[0].organization !== undefined && bulletlessEntries[0].role !== undefined);

// --- isVolunteer flag propagation ---
counter = 0;
const volunteerBlocks = [block("Volunteer Logistics Coordinator"), block("Calgary Food Bank - 2019 - Present"), block("Coordinate volunteer scheduling.", "bullet")];
const volunteerEntries = extractExperienceEntries("s1", volunteerBlocks, true);
checkTrue("isVolunteer=true is propagated onto the produced entry", volunteerEntries[0].isVolunteer);
const nonVolunteerEntries = extractExperienceEntries("s1", volunteerBlocks, false);
check("isVolunteer=false when caller passes false, same extractor", nonVolunteerEntries[0].isVolunteer, false);

// --- empty input ---
counter = 0;
check("empty body blocks: zero entries, no crash", extractExperienceEntries("s1", [], false), []);

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function checkRealFixture(fileName: string, format: "pdf" | "docx", expectedMinEntries: number, expectVolunteerSeparate: boolean) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });

  const expSection = doc.sections.find((s) => s.normalizedType === "experience");
  checkTrue(`${fileName}: has an experience section`, expSection !== undefined);
  if (!expSection) return;
  const bodyBlocks = expSection.blocks.filter((b) => b.blockType !== "heading");
  const entries = extractExperienceEntries(expSection.id, bodyBlocks, false);
  checkTrue(`${fileName}: at least ${expectedMinEntries} experience entr${expectedMinEntries === 1 ? "y" : "ies"} detected`, entries.length >= expectedMinEntries);
  checkTrue(`${fileName}: every entry's bullets+descriptionParagraphs+rawHeaderText trace back to real blocks (non-empty source)`, entries.every((e) => e.source.sourceBlockIds.length > 0));

  if (expectVolunteerSeparate) {
    const volSection = doc.sections.find((s) => s.normalizedType === "volunteering");
    checkTrue(`${fileName}: has a separate volunteering section`, volSection !== undefined);
  }
}

async function main() {
  await checkRealFixture("bench/resume-A-junior-ats.pdf", "pdf", 1, true);
  await checkRealFixture("bench/resume-C-mid-ats.pdf", "pdf", 5, false);
  await checkRealFixture("threepage-pdf-resume.pdf", "pdf", 6, true);
  await checkRealFixture("regtest1-regulated-nurse-resume.docx", "docx", 2, false);
  await checkRealFixture("google-docs-resume.docx", "docx", 2, false);
  await checkRealFixture("generated-table-resume.pdf", "pdf", 1, false);
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
