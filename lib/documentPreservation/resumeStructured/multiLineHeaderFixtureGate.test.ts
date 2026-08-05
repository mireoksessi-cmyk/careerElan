/*
  Phase 5D.3C gate test - Generic Multi-Line Academic Header Recovery
  Hardening. Runs fixtures/resumes/lossless-synthetic/f14-multi-line-headers.{pdf,docx}
  (62 anonymized Education/Certification/Award/Publication multi-line
  header patterns, covering all 12 required Header Shapes A-L plus the
  round's required variety dimensions: 2-6 line windows, Date-first/
  Date-last, Location/Degree/Authority-middle, Expected Graduation,
  Present/Current, Issue/Expiry, Academic Year, Roman numeral, Bracket,
  Pipe, Slash, Dash, Multi-campus, Double Degree, Joint Program,
  Multiple Locations, Academic Honors, Dual Dates) through the real
  extraction pipeline and asserts the round's own acceptance bar:
  "date survives alone" (structured fields all empty except the date,
  AND no fallback text preserved anywhere) must be ZERO, and every
  entry's rawHeaderText/source must be non-empty (100% preservation
  even where field-level structuring is uncertain). Run with
  `npx tsx lib/documentPreservation/resumeStructured/multiLineHeaderFixtureGate.test.ts`.
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

  // --- Education (29 multi-line windows: Shapes A-F, L, plus 2-6 line
  // variety, Present/Current, Academic Year, Roman numeral, Bracket,
  // Pipe, Slash/Double Degree, Dash, Multi-campus, Joint Program,
  // Multiple Locations, Academic Honors) ---
  const eduSection = doc.sections.find((s) => s.normalizedType === "education");
  checkTrue(`${fileName}: has an education section`, eduSection !== undefined);
  if (eduSection) {
    const entries = extractEducationEntries(eduSection.id, eduSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 29 education entries detected`, entries.length, 29);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateRangeText !== undefined;
      const hasAnyOtherField = e.institution !== undefined || e.credential !== undefined || e.fieldOfStudy !== undefined || e.location !== undefined || e.details.length > 0;
      if (hasDate && !hasAnyOtherField) dateSurvivesAlone++;
      checkTrue(`${fileName}: education entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
      checkTrue(`${fileName}: education entry rawHeaderText preserved ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.rawHeaderText.length > 0);
    }
    check(`${fileName}: education "date survives alone" count`, dateSurvivesAlone, 0);

    // Spot-checks across required shapes/variety (index order matches
    // generatePhase5D3CSyntheticFixtures.mts's EDUCATION_LINES).
    check(`${fileName}: Shape A (Institution/Location/Date) resolves institution`, entries[0].institution?.value, "Fairhaven University");
    check(`${fileName}: Shape A resolves location`, entries[0].location?.value, "Denton, TX");
    check(`${fileName}: Shape B (Date/Institution/Location) resolves institution`, entries[1].institution?.value, "Wrenfield College");
    check(`${fileName}: Shape C (Degree/Institution/Date) resolves degree`, entries[2].credential?.value, "Bachelor of Arts");
    /* Phase 5D.3D - resolveCredentialsFromText now recovers the embedded
       "Degree in Major" pattern (splitDegreeInMajor) from a single
       unsplit credential line, matching this round's generalized
       Double Degree/Major field-of-study extraction (see
       educationExtractor.test.ts's own "credential-first" case for the
       same intentional behavior change). */
    check(`${fileName}: Shape D (Institution/Degree/Location/Date) resolves degree`, entries[3].credential?.value, "Diploma");
    check(`${fileName}: Shape D resolves fieldOfStudy from embedded "in Major" pattern`, entries[3].fieldOfStudy?.value, "Graphic Design");
    check(`${fileName}: Shape E (Degree/Major/Institution/Date) resolves major`, entries[4].fieldOfStudy?.value, "Environmental Studies");
    check(`${fileName}: Shape F (Degree/Major/Institution/Location/Date) resolves institution`, entries[5].institution?.value, "Silverpine University");
    check(`${fileName}: Shape L (Expected Graduation/Degree/Institution/Campus) resolves institution`, entries[6].institution?.value, "Thistledown University");
    check(`${fileName}: 6-line window (MAX_HEADER_WINDOW boundary) resolves institution`, entries[8].institution?.value, "Grovemont University");
    check(`${fileName}: Present keyword resolves date`, entries[12].dateRangeText?.value, "2022 - Present");
    check(`${fileName}: Current keyword resolves date`, entries[13].dateRangeText?.value, "2023 - Current");
    check(`${fileName}: Bracket-qualified degree preserves closing paren`, entries[27].credential?.value, "Bachelor of Engineering (Co-op)");
    // Phase 5D.3D - Generic Academic Composite Parsing generalizes this
    // exact case further: instead of staying glued as one combined
    // string (the 5D.3C interim behavior), each degree now resolves
    // into its own credentials[] entry.
    check(`${fileName}: Double Degree (comma-joined) splits into 2 credentials[]`, entries[21].credentials.map((c) => c.value), ["Bachelor of Arts", "Bachelor of Science"]);
    checkTrue(`${fileName}: Double Degree has no spurious fieldOfStudy`, entries[21].fieldOfStudy === undefined);
    check(`${fileName}: Multiple Locations resolves as location, not degree/major`, entries[23].location?.value, "Toronto, ON and Vancouver, BC");
    checkTrue(`${fileName}: Multiple Locations has no spurious credential/fieldOfStudy`, entries[23].credential === undefined && entries[23].fieldOfStudy === undefined);
    check(`${fileName}: Degree-middle window resolves all 4 fields`, entries[11].institution?.value, "Pinegrove University");
    check(`${fileName}: trailing Date/Institution window is isolated, not merged with a preceding entry`, entries[28].institution?.value, "Hartwell Institute");
  }

  // --- Certifications (16 multi-line windows: Shapes I, J, K, plus
  // Present, Bracket, Pipe, Slash-date, Academic-year-validity, Dual
  // Dates with/without Issue/Expiry qualifier words, Roman numeral,
  // Multiple Locations) ---
  const credSection = doc.sections.find((s) => s.normalizedType === "certifications" || s.normalizedType === "licenses");
  checkTrue(`${fileName}: has a certifications section`, credSection !== undefined);
  if (credSection) {
    const entries = extractCredentialEntries(credSection.id, credSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 16 credential entries detected`, entries.length, 16);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.issueDateText !== undefined;
      if (hasDate && e.name === undefined && e.issuer === undefined && e.details.length === 0) dateSurvivesAlone++;
      checkTrue(`${fileName}: credential entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: credential "date survives alone" count`, dateSurvivesAlone, 0);

    check(`${fileName}: Shape I (Cert/Authority/Issue/Expiry, bare dual date) resolves issuer`, entries[0].issuer?.value, "Financial Planning Standards Board");
    check(`${fileName}: Shape I resolves expiryDateText`, entries[0].expiryDateText?.value, "2023");
    check(`${fileName}: Shape K (License/Authority/LicenseNumber/IssueDate) resolves credentialId`, entries[2].credentialId?.value, "RN-884213");
    check(`${fileName}: Present keyword resolves issueDateText`, entries[5].issueDateText?.value, "2020 - Present");
    check(`${fileName}: Bracket-qualified name preserves closing paren`, entries[6].name?.value, "Certified Six Sigma Black Belt (Advanced)");
    check(`${fileName}: Dual date with Issue/Expiry qualifier words resolves expiryDateText`, entries[10].expiryDateText?.value, "2024");
    check(`${fileName}: Multiple Locations (Vancouver, BC and Remote) resolves as location`, entries[15].location?.value, "Vancouver, BC and Remote");
  }

  // --- Awards (8 multi-line windows: Shape G, plus Date-first,
  // Bracket, Pipe, Roman numeral, Present) ---
  const awardSection = doc.sections.find((s) => s.normalizedType === "awards");
  checkTrue(`${fileName}: has an awards section`, awardSection !== undefined);
  if (awardSection) {
    const entries = extractAwardEntries(awardSection.id, awardSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 8 award entries detected`, entries.length, 8);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateText !== undefined;
      if (hasDate && e.name === undefined) dateSurvivesAlone++;
      checkTrue(`${fileName}: award entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: award "date survives alone" count`, dateSurvivesAlone, 0);

    // Regression anchor for the chronological-adjacent-date fix - a
    // Date-first entry ("2020" award) immediately followed by a SEPARATE
    // Date-first entry ("2019" award) must NOT merge into one.
    check(`${fileName}: Shape G resolves name`, entries[0].name?.value, "Excellence in Customer Service Award");
    check(`${fileName}: chronologically-earlier adjacent date starts its own entry, not merged`, entries[1].name?.value, "Outstanding Community Service Award");
    check(`${fileName}: entry after the wrongly-mergeable pair is untouched`, entries[2].name?.value, "Rising Star Award");
    check(`${fileName}: Bracket-qualified award preserves closing paren`, entries[3].name?.value, "Innovation Award (Gold Tier)");
  }

  // --- Publications (7 multi-line windows: Shape H, plus Bracket,
  // Pipe, Multiple Locations, Academic-year-style range) ---
  const pubSection = doc.sections.find((s) => s.normalizedType === "publications");
  checkTrue(`${fileName}: has a publications section`, pubSection !== undefined);
  if (pubSection) {
    const entries = extractPublicationEntries(pubSection.id, pubSection.blocks.filter((b) => b.blockType !== "heading"));
    check(`${fileName}: 7 publication entries detected`, entries.length, 7);
    let dateSurvivesAlone = 0;
    for (const e of entries) {
      const hasDate = e.dateText !== undefined;
      const hasAnyOtherField = e.title !== undefined || e.details.length > 0;
      if (hasDate && !hasAnyOtherField) dateSurvivesAlone++;
      checkTrue(`${fileName}: publication entry traces back to real blocks ("${e.rawHeaderText.replace(/\n/g, " / ")}")`, e.source.sourceBlockIds.length > 0);
    }
    check(`${fileName}: publication "date survives alone" count`, dateSurvivesAlone, 0);

    check(`${fileName}: Shape H (Publication/Conference/Location/Date) resolves title`, entries[0].title?.value, "Emerging Patterns in Urban Water Management");
    check(`${fileName}: Shape H resolves venue+location joined`, entries[0].publisherOrVenue?.value, "International Conference on Sustainable Infrastructure, Halifax, NS");
    // Regression anchor for the "present"/"current" word-boundary fix -
    // "Presented in ..." must never be misread as containing the date
    // keyword "Present".
    check(`${fileName}: "Presented in ..." is not misread as a Present-keyword date`, entries[5].dateText?.value, "2020");
    checkTrue(`${fileName}: "Presented in ..." venue text survives intact (not truncated to "ed in ...")`, entries[5].publisherOrVenue?.value.startsWith("Presented") ?? false);
  }
}

async function main() {
  await runFixture("f14-multi-line-headers.docx", "docx");
  await runFixture("f14-multi-line-headers.pdf", "pdf");
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
