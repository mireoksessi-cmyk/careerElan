/*
  Phase 5D.3B gate test - Generic Single-Line Header Recovery Hardening.
  Runs fixtures/resumes/lossless-synthetic/f13-single-line-headers.{pdf,docx}
  (31 anonymized Education/Certification/Award/Publication header
  patterns, covering all 20 header shapes required by this round's spec)
  through the real extraction pipeline and asserts the round's own
  acceptance bar: for every entry where the source line(s) contain real
  institution/credential/award/publication text, "date survives alone"
  (structured fields all empty except the date, AND no fallback text
  preserved anywhere) must be ZERO. Run with
  `npx tsx lib/documentPreservation/resumeStructured/singleLineHeaderFixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractEducationEntries } from "./educationExtractor";
import { extractCredentialEntries } from "./credentialExtractor";
import { extractAwardEntries } from "./awardExtractor";
import { extractPublicationEntries } from "./publicationExtractor";

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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes/lossless-synthetic");

async function runFixture(fileName: string, format: "pdf" | "docx") {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });

  // --- Education (15 patterns: shapes 1-8, 14, 17, 18, plus positional-
  // fallback and comma/em-dash/pipe-separator variants) ---
  const eduSection = doc.sections.find((s) => s.normalizedType === "education");
  checkTrue(`${fileName}: has an education section`, eduSection !== undefined);
  if (eduSection) {
    const entries = extractEducationEntries(eduSection.id, eduSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 15 education entries detected`, entries.length, 15);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateRangeText !== undefined;
      const hasAnyOtherField = e.institution !== undefined || e.credential !== undefined || e.fieldOfStudy !== undefined || e.details.length > 0;
      if (hasDate && !hasAnyOtherField) dateSurvivesAlone++;
      checkTrue(`${fileName}: education entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
      checkTrue(`${fileName}: education entry rawHeaderText preserved ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.rawHeaderText.length > 0);
    }
    check(`${fileName}: education "date survives alone" count`, dateSurvivesAlone, 0);

    // Regression anchors for the two bugs this round's fixture-building fixed:
    check(`${fileName}: date-first two-line header ("2019 - 2021\\nFairview State University") resolves institution`, entries[0].institution?.value, "Fairview State University");
    check(`${fileName}: single-line self-contained comma-split header is not swallowed by the next entry`, entries[10].institution?.value, "Riverton University");
    check(`${fileName}: positional-fallback two-line header stays its own entry`, entries[11].institution?.value, "Meridian Learning Group");
  }

  // --- Certifications (9 patterns: shapes 9, 12, 13, 15, 16, 19, 20, plus
  // parenthetical-abbreviation and numeric-month-range variants) ---
  const credSection = doc.sections.find((s) => s.normalizedType === "certifications" || s.normalizedType === "licenses");
  checkTrue(`${fileName}: has a certifications section`, credSection !== undefined);
  if (credSection) {
    const entries = extractCredentialEntries(credSection.id, credSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 9 credential entries detected`, entries.length, 9);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.issueDateText !== undefined;
      if (hasDate && e.name === undefined && e.issuer === undefined && e.details.length === 0) dateSurvivesAlone++;
      checkTrue(`${fileName}: credential entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: credential "date survives alone" count`, dateSurvivesAlone, 0);

    // Regression anchor for the Month-Year (shape 16) fix - previously
    // "Jan" was mistaken for the entire credential name and "Registered
    // Nurse License" was silently dropped.
    check(`${fileName}: Month-Year single-date header resolves the full credential name`, entries[4].name?.value, "Registered Nurse License");
    check(`${fileName}: Month-Year single-date header captures the month in the date`, entries[4].issueDateText?.value, "Jan 2021");
  }

  // --- Awards (4 patterns: shape 10, plus date-first-with-dash,
  // award-first-with-trailing-date, and issuer-via-em-dash variants) ---
  const awardSection = doc.sections.find((s) => s.normalizedType === "awards");
  checkTrue(`${fileName}: has an awards section`, awardSection !== undefined);
  if (awardSection) {
    const entries = extractAwardEntries(awardSection.id, awardSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 4 award entries detected`, entries.length, 4);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateText !== undefined;
      if (hasDate && e.name === undefined) dateSurvivesAlone++;
      checkTrue(`${fileName}: award entry traces back to real blocks ("${e.rawHeaderText}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: award "date survives alone" count`, dateSurvivesAlone, 0);
  }

  // --- Publications (3 patterns: shape 11, plus year-parenthetical and
  // comma-joined-venue variants). PublicationEntry's own `details` field
  // is, by design, ALWAYS populated with the full raw citation text
  // (unchanged this round - see publicationExtractor.ts), so the "not
  // lost" bar here is details.length > 0, not the `title` field. ---
  const pubSection = doc.sections.find((s) => s.normalizedType === "publications");
  checkTrue(`${fileName}: has a publications section`, pubSection !== undefined);
  if (pubSection) {
    const entries = extractPublicationEntries(pubSection.id, pubSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 3 publication entries detected`, entries.length, 3);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateText !== undefined;
      const hasAnyOtherField = e.title !== undefined || e.details.length > 0;
      if (hasDate && !hasAnyOtherField) dateSurvivesAlone++;
      checkTrue(`${fileName}: publication entry traces back to real blocks ("${e.rawHeaderText}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: publication "date survives alone" count`, dateSurvivesAlone, 0);
  }
}

async function main() {
  await runFixture("f13-single-line-headers.docx", "docx");
  await runFixture("f13-single-line-headers.pdf", "pdf");
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
