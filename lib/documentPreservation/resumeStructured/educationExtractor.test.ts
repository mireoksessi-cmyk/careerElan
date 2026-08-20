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

/*
  ====================================================================
  Phase 2B - marker-only details (Bug A) and bulleted education entry
  boundaries (Bug B). Neutral fixture data only; no production rule
  depends on any name, school or phrase used below.
  ====================================================================
*/

function detailTexts(entry: { details: { value: string }[] } | undefined): string[] {
  return (entry?.details ?? []).map((d) => d.value);
}

// ---- Bug A: a decorative marker on its own is never a detail ----
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("•"),
  ]);
  check("A1 bare marker-only block emits no detail", detailTexts(entries[0]), []);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("   •   "),
  ]);
  check("A2 whitespace-wrapped marker emits no detail", detailTexts(entries[0]), []);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("▪"),
    block("‣"),
  ]);
  check("A3 other decorative marker-only glyphs emit no detail", detailTexts(entries[0]), []);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• Relevant coursework in control systems", "bullet"),
  ]);
  check("A4 marker + real text keeps the text", detailTexts(entries[0]), ["Relevant coursework in control systems"]);
}

counter = 0;
{
  // A5 - a marker + real education-entry content must survive Bug A's
  // filter entirely (Bug B then decides whether it becomes an entry).
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
  ]);
  checkTrue("A5 marker + real education content is not deleted", JSON.stringify(entries).includes("Central Technical Institute"));
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("C++ and MATLAB"),
    block("Note: figures are presented in local currency"),
  ]);
  check("A6 non-marker punctuation-bearing content is not filtered", detailTexts(entries[0]), [
    "C++ and MATLAB",
    "Note: figures are presented in local currency",
  ]);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("•"),
    block("• Thesis on thermal management", "bullet"),
  ]);
  checkTrue("A7 no glyph-only detail survives anywhere", detailTexts(entries[0]).every((d) => d.trim().length > 0 && d.trim() !== "•"));
}

// ---- Bug B positive: a bulleted line with its OWN strong evidence ----
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
  ]);
  check("B1 bulleted date + institution starts its own entry", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• 2019 - 2021 M.S. in Computer Science", "bullet"),
  ]);
  check("B2 bulleted date + credential starts its own entry", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
    block("• 2021 - 2023 Riverside Polytechnic", "bullet"),
  ]);
  check("B3 two qualifying bulleted lines produce two further entries", entries.length, 3);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• 2014 - 2018 Northbridge University, B.S. in Mechanical Engineering", "bullet"),
    block("• 2019 - 2021 Northbridge University, M.S. in Computer Science", "bullet"),
  ]);
  check("B4 same institution, two qualifying date ranges, two entries", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
  ]);
  check("B5 ordinary non-bullet education header is unchanged", entries.length, 1);
  check("B5 ordinary header still resolves its institution", entries[0].institution?.value, "Northbridge University");
}

// ---- Bug B negative: ordinary detail bullets stay details ----
const NEGATIVE_BULLETS: { label: string; text: string }[] = [
  { label: "B6 date only", text: "• 2019 - 2021" },
  { label: "B7 credential keyword only", text: "• Bachelor level coursework" },
  { label: "B8 institution-like token only", text: "• University exchange programme" },
  { label: "B9 dean's list with a year", text: "• Dean's List 2020" },
  { label: "B10 coursework", text: "• Relevant Coursework: Algorithms" },
  { label: "B11 thesis", text: "• Thesis: Battery Thermal Management" },
  { label: "B12 gpa", text: "• GPA: 3.9" },
  { label: "B13 honors", text: "• Graduated with Honours" },
  { label: "B14 scholarship with a year", text: "• Awarded a scholarship in 2020" },
  { label: "B15 note line", text: "• Note: values converted for presentation" },
  {
    label: "B16 long prose containing dates and keywords",
    text: "• Between 2019 and 2021 completed an extended research placement at the university institute covering control systems, thermal modelling and validation",
  },
  { label: "B17 generic detail", text: "• Member of the student engineering society" },
];

for (const negative of NEGATIVE_BULLETS) {
  counter = 0;
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block(negative.text, "bullet"),
  ]);
  check(`${negative.label} stays a detail, not a new entry`, entries.length, 1);
}

// ---- Regression: a qualifying entry still carries ordinary details ----
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
    block("• Member of the student engineering society", "bullet"),
  ]);
  check("R4 detail bullet below a qualifying entry stays its detail", entries.length, 2);
  check("R4 that detail is attached to the second entry", detailTexts(entries[1]), ["Member of the student engineering society"]);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• 2014 - 2018 Northbridge University, B.S. in Mechanical Engineering", "bullet"),
  ]);
  check("R6 a qualifying bulleted entry still traces to its source block", entries[0]?.source.sourceBlockIds, ["block-p0-b0"]);
}

/*
  ====================================================================
  Phase 2B-final - a marker-only block must carry zero semantic content
  ANYWHERE in Education, not only in details[]. The header path is the
  catching one: "•" satisfies looksLikeHeaderLine, so isNewEntryStart's
  next-line date lookahead could promote it and collectHeaderWindow
  could absorb it into an entry header.
  ====================================================================
*/

function allEducationText(entries: { rawHeaderText: string; details: { value: string }[] }[]): string {
  return entries.map((e) => `${e.rawHeaderText}|${e.details.map((d) => d.value).join("|")}`).join("||");
}

// F1 - CATCHING: marker immediately before an ordinary dated non-bullet entry.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("•"),
    block("Northbridge University, School of Engineering - 2014 - 2018"),
  ]);
  check("F1 marker before dated header creates no extra entry", entries.length, 1);
  check("F1 marker is absent from rawHeaderText", entries[0].rawHeaderText.includes("•"), false);
  check("F1 marker is absent from details", allEducationText(entries).includes("•"), false);
  check("F1 the real entry still resolves its date", entries[0].dateRangeText?.value, "2014 - 2018");
  checkTrue("F1 the real entry still resolves an institution", (entries[0].institution?.value ?? "").length > 0);
}

// F2 - marker immediately before a strong bulleted EducationEntry.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("•"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
  ]);
  check("F2 marker before a bulleted entry creates no extra entry", entries.length, 1);
  /*
    Precise orphan check. A blanket "no bullet character anywhere" would
    be wrong here: rawHeaderText is verbatim by contract, so the
    surviving entry legitimately keeps its OWN leading marker. What must
    not happen is the orphan being absorbed as an extra header line -
    "•\n• 2019 - 2021 Central Technical Institute". Asserting the exact
    header text catches that and nothing else.
  */
  check("F2 orphan marker was not absorbed into the entry header", entries[0].rawHeaderText, "• 2019 - 2021 Central Technical Institute");
}

// F3 - marker in an ordinary body/detail position.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("•"),
  ]);
  check("F3 marker in body position produces no detail", entries[0].details.length, 0);
}

// F4 - marker inside the header window, the extraDetails-producing path.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("•"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
  ]);
  check("F4 marker between header lines creates no extra entry", entries.length, 1);
  check("F4 marker never reaches rawHeaderText or extraDetails", allEducationText(entries).includes("•"), false);
  checkTrue("F4 the header still resolves a credential", (entries[0].credential?.value ?? "").length > 0);
}

// F5 - consecutive marker-only blocks before a valid entry.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("•"),
    block("▪"),
    block("Northbridge University, School of Engineering - 2014 - 2018"),
  ]);
  check("F5 consecutive markers create no entries", entries.length, 1);
  check("F5 no marker survives anywhere", /[•▪]/.test(allEducationText(entries)), false);
}

// F6 - marker between two valid entries.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University, School of Engineering - 2014 - 2018"),
    block("•"),
    block("Riverside Polytechnic, School of Computing - 2019 - 2021"),
  ]);
  check("F6 marker between entries leaves exactly two entries", entries.length, 2);
  check("F6 no marker survives between entries", allEducationText(entries).includes("•"), false);
}

// F7 - marker + REAL content is never dropped by the whole-line rule.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• Relevant Coursework", "bullet"),
    block("• Thesis: thermal management", "bullet"),
  ]);
  check("F7 marker + real content survives as details", entries[0].details.map((d) => d.value), [
    "Relevant Coursework",
    "Thesis: thermal management",
  ]);
}

/*
  ====================================================================
  Phase 2B-C1 - a record's own continuation line (location and/or date,
  with no institution or credential evidence of its own) must not start
  a second EducationEntry. C1 proves SEGMENTATION only: field-level
  resolution of "Credential (Institution)" and "Expected in" is out of
  scope here.
  ====================================================================
*/

// C1-PRIMARY - the audited two-line shape must yield exactly ONE entry.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Credential (Example Polytechnic) Expected in", "bullet"),
    block("– Toronto, ON · 04/2027"),
  ]);
  check("C1 primary: bullet-led record + continuation line is ONE entry", entries.length, 1);
}

// C1-1 - non-bullet header + location/date continuation.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example Polytechnic"),
    block("Diploma in Applied Design"),
    block("Toronto, ON · 04/2027"),
  ]);
  check("C1-1 header + location/date continuation is one entry", entries.length, 1);
}

// C1-2 - date-only continuation.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example Polytechnic"),
    block("Diploma in Applied Design"),
    block("04/2027"),
  ]);
  check("C1-2 date-only continuation does not split the entry", entries.length, 1);
}

// C1-3 - location-only continuation (no date evidence at all).
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example Polytechnic - 2019 - 2021"),
    block("Toronto, ON"),
  ]);
  check("C1-3 location-only continuation creates no fake entry", entries.length, 1);
}

// C1-4 - bullet-led header + non-bullet continuation, MM/YYYY range.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Credential (Example Polytechnic)", "bullet"),
    block("– Vancouver, BC · 09/2024 - 04/2027"),
  ]);
  check("C1-4 bullet-led header + dated continuation is one entry", entries.length, 1);
}

// C1-5 - month-name continuation, using only the existing date grammar.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example Polytechnic"),
    block("Diploma in Applied Design"),
    block("Toronto, ON · May 2027"),
  ]);
  check("C1-5 month-name continuation does not split the entry", entries.length, 1);
}

// ---- True-new-entry negative controls: real records must still split ----
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University - 2014 - 2018"),
    block("Riverside University - 2019 - 2021"),
  ]);
  check("C1-6 a following institution + date is still a new entry", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University - 2014 - 2018"),
    block("M.S. in Computer Science - 2019 - 2021"),
  ]);
  check("C1-7 a following credential + date is still a new entry", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University - 2014 - 2018"),
    block("• 2019 - 2021 Central Technical Institute", "bullet"),
  ]);
  check("C1-8 a following strong bulleted record is still a new entry", entries.length, 2);
}

counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University, School of Engineering - 2014 - 2018"),
    block("Toronto, ON · 2018"),
    block("Riverside Polytechnic, School of Computing - 2019 - 2021"),
  ]);
  check("C1-9 continuation absorbed, next real record still splits", entries.length, 2);
}

// ---- Detail regression controls: unchanged production rules ----
const C1_DETAIL_LINES: { label: string; text: string }[] = [
  { label: "C1-10 dean's list with a year", text: "• Dean's List 2020" },
  { label: "C1-11 gpa", text: "• GPA: 3.9" },
  { label: "C1-12 honours", text: "• Graduated with Honours" },
  { label: "C1-13 coursework", text: "• Relevant Coursework: Algorithms" },
  { label: "C1-14 thesis", text: "• Thesis: Battery Thermal Management" },
  { label: "C1-15 note", text: "• Note: values converted for presentation" },
  { label: "C1-16 scholarship with a year", text: "• Awarded a scholarship in 2020" },
];

for (const detail of C1_DETAIL_LINES) {
  counter = 0;
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block(detail.text, "bullet"),
  ]);
  check(`${detail.label} remains a detail, not an entry`, entries.length, 1);
}

/*
  ====================================================================
  Phase 2B-C2-S - meaningful Education header text must never end up
  represented ONLY in rawHeaderText, because the renderer's fallback is
  switched off as soon as the entry has any other content. Storage is
  not preservation; these tests assert the details channel.
  ====================================================================
*/

function detailValues(entry: { details: { value: string }[] } | undefined): string[] {
  return (entry?.details ?? []).map((d) => d.value);
}

// S1 - PRIMARY: the live post-C1 shape. rawHeaderText alone is NOT enough.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("– Example City, ST · 04/2027"),
  ]);
  check("S1 still exactly one entry (C1 unchanged)", entries.length, 1);
  check("S1 unresolved header survives in details, ahead of the continuation", detailValues(entries[0]), [
    "Generic Program (Example Polytechnic) Expected in",
    "– Example City, ST · 04/2027",
  ]);
  checkTrue(
    "S1 rawHeaderText is still the verbatim source line",
    entries[0].rawHeaderText === "• Generic Program (Example Polytechnic) Expected in"
  );
}

// S2 - storage is not preservation: the header must be in a RENDERED
//      channel, not only on the object.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Unrecognised Program Phrase"),
    block("– Example City, ST · 04/2027"),
  ]);
  /*
    Corrected: this fixture's first line is NOT a bullet, so both lines
    enter the header window and the multi-line branch force-assigns the
    phrase to a structured field. It is therefore already visible, and
    requiring it in details[] was wrong. Kept as the control proving a
    normal non-excluded line stays structurally represented and is not
    pushed into details merely because C2-S exists.
  */
  checkTrue(
    "S2 non-excluded header line is structurally represented, not lost",
    (entries[0].institution?.value ?? "") === "Unrecognised Program Phrase"
  );
  check("S2 it is not additionally duplicated into details", detailValues(entries[0]).includes("Unrecognised Program Phrase"), false);
}

// S3 - NO-DUPLICATION: a successfully structured header is never copied
//      into details.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example University - M.S. in Engineering - 2020 - 2022"),
    /* Corrected fixture: a plain paragraph of this shape is header-like,
       so collectHeaderWindow absorbed it and no body block existed. A
       bullet terminates the window, which is what this case needs. */
    block("• Relevant coursework in control systems", "bullet"),
  ]);
  check("S3 structured header is not duplicated into details", detailValues(entries[0]), [
    "Relevant coursework in control systems",
  ]);
  checkTrue("S3 the header still resolves an institution", (entries[0].institution?.value ?? "").length > 0);
}

// S4 - a multi-line header (the resolver-remainder path) is untouched by
//      C2-S: no header line is preserved twice.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example University"),
    block("M.S. in Engineering - 2020 - 2022"),
    block("Relevant coursework in control systems"),
  ]);
  const values = detailValues(entries[0]);
  check("S4 multi-line header emits no duplicated remainder", values.filter((v) => v === "Example University").length, 0);
  checkTrue("S4 body detail is still present exactly once", values.filter((v) => v === "Relevant coursework in control systems").length === 1);
}

// S5 - NO-RISK case: with no body block the fallback still applies, so
//      C2-S must NOT move the header into details.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block("Electrical Engineering Technology Diploma")]);
  check("S5 unstructured single header with no body keeps details empty", detailValues(entries[0]), []);
  checkTrue(
    "S5 the header is still preserved verbatim for the renderer fallback",
    entries[0].rawHeaderText === "Electrical Engineering Technology Diploma"
  );
}

// S6 - body-detail regression: ordinary details keep their content,
//      order and count.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University"),
    block("B.S. in Mechanical Engineering - 2014 - 2018"),
    block("• Relevant Coursework: Algorithms", "bullet"),
    block("• Thesis: thermal management", "bullet"),
    block("• Note: values converted for presentation", "bullet"),
  ]);
  check("S6 ordinary body details are unchanged", detailValues(entries[0]), [
    "Relevant Coursework: Algorithms",
    "Thesis: thermal management",
    "Note: values converted for presentation",
  ]);
}

// S7 - C1 metadata continuation is NOT newly structured (C2 forbidden).
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic)", "bullet"),
    block("– Example City, ST · 04/2027"),
  ]);
  check("S7 continuation did not become a structured location", entries[0].location, undefined);
  check("S7 continuation date is now structured (C2)", entries[0].dateRangeText?.value, "04/2027");
  checkTrue("S7 continuation is still a detail", detailValues(entries[0]).includes("– Example City, ST · 04/2027"));
}

// S8 - true multi-entry segmentation is unaffected.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Northbridge University - 2014 - 2018"),
    block("Riverside University - 2019 - 2021"),
  ]);
  check("S8 two real records still produce two entries", entries.length, 2);
}

// S9 - multi-line gap: a PURE LABEL line is excluded from field
//      assignment, so it must survive through details exactly once.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    /* "Joint Program:" was mis-authored: cleanHeaderFragment strips the
       trailing colon (DANGLING_SEPARATOR_RE), so the preserved remainder
       is "Joint Program" and an assertion on the colon form matched
       nothing. "Double Degree" is in the same PROGRAM_LABEL_RE
       alternation, is 2 words, and carries no leading/trailing separator
       character, so fixture and preserved text are identical. */
    block("Double Degree"),
    block("Example University - 2019 - 2021"),
  ]);
  check("S9 pure-label line survives exactly once in details", detailValues(entries[0]).filter((v) => v === "Double Degree").length, 1);
  check("S9 pure-label line is not assigned as an institution", entries[0].institution?.value === "Double Degree", false);
  checkTrue("S9 the real institution still resolves", (entries[0].institution?.value ?? "").length > 0);
  checkTrue("S9 rawHeaderText still holds both source lines verbatim", entries[0].rawHeaderText.includes("Double Degree"));
}

// S10 - multi-line gap: a QUALIFIER-ONLY remainder ("Expected
//       Graduation", left after its date is structured) is likewise
//       excluded, so it must survive through details exactly once.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example University"),
    block("Expected Graduation 2026"),
  ]);
  check("S10 qualifier-only remainder survives exactly once in details", detailValues(entries[0]).filter((v) => v === "Expected Graduation").length, 1);
  checkTrue("S10 its date is still structured", (entries[0].dateRangeText?.value ?? "").includes("2026"));
  check("S10 qualifier-only text is not assigned as a credential", entries[0].credential?.value === "Expected Graduation", false);
}

// --- Phase 2B-H1 - bulleted single-header field-resolution input ---
// Actual-source shape: a date-FIRST record whose only marker is the
// source's own inline bullet glyph. The glyph is presentation, so it
// must never land in a structured field, while rawHeaderText must keep
// it verbatim.
const H1_MARKER = "•";

function h1StructuredFieldValues(entry: {
  institution?: { value: string };
  institutions: { value: string }[];
  credential?: { value: string };
  credentials: { value: string }[];
  fieldOfStudy?: { value: string };
  fieldsOfStudy: { value: string }[];
  location?: { value: string };
}): string[] {
  return [
    entry.institution?.value,
    ...entry.institutions.map((v) => v.value),
    entry.credential?.value,
    ...entry.credentials.map((v) => v.value),
    entry.fieldOfStudy?.value,
    ...entry.fieldsOfStudy.map((v) => v.value),
    entry.location?.value,
  ].filter((v): v is string => v !== undefined);
}

// H1-1 - bulleted date-first high school (no degree keyword at all).
counter = 0;
{
  const raw = `${H1_MARKER} 1986-1989 Example High School`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H1 high school: exactly one entry", entries.length, 1);
  check("H1 high school: dateRangeText correct", entries[0].dateRangeText?.value, "1986-1989");
  check("H1 high school: institution is not the bullet marker", entries[0].institution?.value === H1_MARKER, false);
  check("H1 high school: institutions[] does not contain the bullet marker", entries[0].institutions.some((v) => v.value === H1_MARKER), false);
  check("H1 high school: credential is not the bullet marker", entries[0].credential?.value === H1_MARKER, false);
  check("H1 high school: fieldOfStudy is not the bullet marker", entries[0].fieldOfStudy?.value === H1_MARKER, false);
  check("H1 high school: location is not the bullet marker", entries[0].location?.value === H1_MARKER, false);
  check("H1 high school: no structured field equals the bullet marker", h1StructuredFieldValues(entries[0]).includes(H1_MARKER), false);
  check("H1 high school: rawHeaderText remains verbatim with its marker", entries[0].rawHeaderText, raw);
  check("H1 high school: the school name resolves as institution", entries[0].institution?.value, "Example High School");
}

// H1-2 - bulleted date-first university with a degree.
counter = 0;
{
  const raw = `${H1_MARKER} 1990-1994 Example University - B.S. in Engineering`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H1 university: exactly one entry", entries.length, 1);
  check("H1 university: dateRangeText correct", entries[0].dateRangeText?.value, "1990-1994");
  check("H1 university: institution is not the bullet marker", entries[0].institution?.value === H1_MARKER, false);
  check("H1 university: institutions[] does not contain the bullet marker", entries[0].institutions.some((v) => v.value === H1_MARKER), false);
  check("H1 university: credential is not the bullet marker", entries[0].credential?.value === H1_MARKER, false);
  check("H1 university: fieldOfStudy is not the bullet marker", entries[0].fieldOfStudy?.value === H1_MARKER, false);
  check("H1 university: location is not the bullet marker", entries[0].location?.value === H1_MARKER, false);
  check("H1 university: no structured field equals the bullet marker", h1StructuredFieldValues(entries[0]).includes(H1_MARKER), false);
  check("H1 university: rawHeaderText remains verbatim with its marker", entries[0].rawHeaderText, raw);
  checkTrue("H1 university: the semantic remainder is not lost", h1StructuredFieldValues(entries[0]).concat(detailValues(entries[0])).join(" | ").includes("Example University"));
}

// H1-3 - bulleted date-first institute with a parenthetical tail.
counter = 0;
{
  const raw = `${H1_MARKER} 1994-1996 Example Institute - M.S. in Automation Engineering (Machine Vision)`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H1 institute: exactly one entry", entries.length, 1);
  check("H1 institute: dateRangeText correct", entries[0].dateRangeText?.value, "1994-1996");
  check("H1 institute: no structured field equals the bullet marker", h1StructuredFieldValues(entries[0]).includes(H1_MARKER), false);
  check("H1 institute: rawHeaderText remains verbatim with its marker", entries[0].rawHeaderText, raw);
  checkTrue("H1 institute: the semantic remainder is not lost", h1StructuredFieldValues(entries[0]).concat(detailValues(entries[0])).join(" | ").includes("Example Institute"));
}

// H1-4 - presentation sensitivity: the SAME line without a bullet must
//        parse exactly as it did before this change.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block("1986-1989 Example High School")]);
  check("H1 non-bullet regression: exactly one entry", entries.length, 1);
  check("H1 non-bullet regression: dateRangeText unchanged", entries[0].dateRangeText?.value, "1986-1989");
  check("H1 non-bullet regression: institution unchanged", entries[0].institution?.value, "Example High School");
  check("H1 non-bullet regression: rawHeaderText verbatim", entries[0].rawHeaderText, "1986-1989 Example High School");
}

// H1-5 - a bullet-like glyph INSIDE the text is semantic, never a
//        presentation marker, so it must survive untouched.
counter = 0;
{
  const raw = `${H1_MARKER} 2001-2005 Example College ${H1_MARKER} Honours Program`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H1 inner glyph: rawHeaderText verbatim", entries[0].rawHeaderText, raw);
  check("H1 inner glyph: no structured field equals the bullet marker", h1StructuredFieldValues(entries[0]).includes(H1_MARKER), false);
  checkTrue("H1 inner glyph: the non-leading glyph is not globally stripped", h1StructuredFieldValues(entries[0]).concat(detailValues(entries[0])).join(" | ").includes(`${H1_MARKER} Honours Program`));
}

// --- Phase 2B-H2-A - institution + descriptive suffix comma shape ---
// "Institution, descriptive suffix" is the OPPOSITE of the positional
// "Credential, [Field,] Institution" contract the comma branch was
// written for. The school must resolve as the institution, and the
// suffix - which carries no structured category of its own - must be
// preserved as a detail, never as a location/credential/field/second
// institution/honour.
const H2A_SUFFIX = "11th graduating class";

// H2A-1 - PRIMARY: the source-proven shape, on a bulleted date-first line.
counter = 0;
{
  const raw = `• 1986-1989 Example High School, ${H2A_SUFFIX}`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H2A primary: exactly one entry", entries.length, 1);
  check("H2A primary: the school resolves as institution", entries[0].institution?.value, "Example High School");
  check("H2A primary: institutions[0] is the school", entries[0].institutions[0]?.value, "Example High School");
  check("H2A primary: institutions[] holds exactly the school", entries[0].institutions.map((v) => v.value), ["Example High School"]);
  check("H2A primary: no credential is invented", entries[0].credential, undefined);
  check("H2A primary: credentials[] stays empty", entries[0].credentials.length, 0);
  check("H2A primary: no fieldOfStudy is invented", entries[0].fieldOfStudy, undefined);
  check("H2A primary: fieldsOfStudy[] stays empty", entries[0].fieldsOfStudy.length, 0);
  check("H2A primary: no location is invented", entries[0].location, undefined);
  check("H2A primary: honors stays empty", entries[0].honors.length, 0);
  check("H2A primary: the date is unchanged", entries[0].dateRangeText?.value, "1986-1989");
  check("H2A primary: rawHeaderText remains verbatim", entries[0].rawHeaderText, raw);
}

// H2A-2 - the suffix lands in details EXACTLY once, and nowhere else.
counter = 0;
{
  const raw = `• 1986-1989 Example High School, ${H2A_SUFFIX}`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H2A destination: suffix appears in details exactly once", detailValues(entries[0]).filter((v) => v === H2A_SUFFIX).length, 1);
  check("H2A destination: suffix is not the institution", entries[0].institution?.value === H2A_SUFFIX, false);
  check("H2A destination: suffix is not in institutions[]", entries[0].institutions.some((v) => v.value === H2A_SUFFIX), false);
  check("H2A destination: suffix is not the credential", entries[0].credential?.value === H2A_SUFFIX, false);
  check("H2A destination: suffix is not in credentials[]", entries[0].credentials.some((v) => v.value === H2A_SUFFIX), false);
  check("H2A destination: suffix is not the fieldOfStudy", entries[0].fieldOfStudy?.value === H2A_SUFFIX, false);
  check("H2A destination: suffix is not in fieldsOfStudy[]", entries[0].fieldsOfStudy.some((v) => v.value === H2A_SUFFIX), false);
  check("H2A destination: suffix is not the location", entries[0].location?.value === H2A_SUFFIX, false);
  check("H2A destination: suffix is not an honour", entries[0].honors.some((v) => v.value === H2A_SUFFIX), false);
}

// H2A-3 - the preserved suffix keeps the same source provenance every
//         other structured value carries.
counter = 0;
{
  const sourceBlock = block(`• 1986-1989 Example High School, ${H2A_SUFFIX}`, "bullet");
  const entries = extractEducationEntries("s1", [sourceBlock]);
  const suffixDetail = entries[0].details.find((d) => d.value === H2A_SUFFIX);
  checkTrue("H2A provenance: the suffix detail exists", suffixDetail !== undefined);
  check("H2A provenance: section id is traced", suffixDetail?.source.sourceSectionId, "s1");
  check("H2A provenance: source block id is traced", suffixDetail?.source.sourceBlockIds, [sourceBlock.id]);
  check("H2A provenance: source element ids are traced", suffixDetail?.source.sourceElementIds, sourceBlock.sourceElementIds);
  checkTrue("H2A provenance: it is a real StructuredTextValue, not a bare string", typeof suffixDetail?.confidence === "number" && typeof suffixDetail?.extractionMethod === "string");
}

// H2A-4 - SAFETY: a two-segment CREDENTIAL-first line must keep the
//         existing positional contract, not be re-read as
//         institution + suffix.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block("Bachelor of Science, Example University (2015 - 2019)")]);
  check("H2A safety: credential-first two-segment keeps its credential", entries[0].credential?.value, "Bachelor of Science");
  check("H2A safety: credential-first two-segment keeps its institution", entries[0].institution?.value, "Example University");
  check("H2A safety: its institution is not demoted to a detail", detailValues(entries[0]).includes("Example University"), false);
}

// H2A-5 - SAFETY: a trailing segment that IS a degree stays a degree,
//         so an institution-first degree line is untouched.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block("• 2014 - 2018 Example University, B.S. in Mechanical Engineering", "bullet")]);
  check("H2A safety: institution-first degree line is not treated as a suffix shape", entries[0].reasonCodes.includes("single-line-header-institution-descriptive-suffix"), false);
  check("H2A safety: its degree text is not demoted to a detail", detailValues(entries[0]).includes("B.S. in Mechanical Engineering"), false);
}

// --- Phase 2B-H2-B - Institution <dash> Credential in Field ---
// The school comes FIRST and its degree follows a spaced dash. The
// composite must decompose into institution + credential + field, and
// must NOT fire when the right side lacks real degree evidence or the
// left side is itself a degree.
const H2B_DASH = "—";
const H2B_ROUTE = "single-line-header-institution-credential-composite";

// H2B-1 - PRIMARY: B.S. composite.
counter = 0;
{
  const raw = `• 1990–1994 Example Institute ${H2B_DASH} B.S. in Precision Engineering`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H2B B.S.: exactly one entry", entries.length, 1);
  check("H2B B.S.: took the composite route", entries[0].reasonCodes.includes(H2B_ROUTE), true);
  check("H2B B.S.: institution is the school alone", entries[0].institution?.value, "Example Institute");
  check("H2B B.S.: institutions[] holds only the school", entries[0].institutions.map((v) => v.value), ["Example Institute"]);
  check("H2B B.S.: credential is the degree alone", entries[0].credential?.value, "B.S.");
  check("H2B B.S.: credentials[] holds only the degree", entries[0].credentials.map((v) => v.value), ["B.S."]);
  check("H2B B.S.: fieldOfStudy is the major", entries[0].fieldOfStudy?.value, "Precision Engineering");
  check("H2B B.S.: fieldsOfStudy[] holds only the major", entries[0].fieldsOfStudy.map((v) => v.value), ["Precision Engineering"]);
  check("H2B B.S.: no location is invented", entries[0].location, undefined);
  check("H2B B.S.: the date is unchanged", entries[0].dateRangeText?.value, "1990–1994");
  check("H2B B.S.: details stay empty", detailValues(entries[0]), []);
  check("H2B B.S.: rawHeaderText remains verbatim", entries[0].rawHeaderText, raw);
  check("H2B B.S.: the whole composite is never an institution", entries[0].institutions.some((v) => v.value.includes(H2B_DASH)), false);
  check("H2B B.S.: the institution is not glued into the credential", entries[0].credentials.some((v) => v.value.includes("Example Institute")), false);
}

// H2B-2 - PRIMARY: M.S. composite; the parenthetical stays inside the field.
counter = 0;
{
  const raw = `• 1994–1996 Example Institute ${H2B_DASH} M.S. in Automation and Design Engineering (Machine Vision)`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H2B M.S.: exactly one entry", entries.length, 1);
  check("H2B M.S.: took the composite route", entries[0].reasonCodes.includes(H2B_ROUTE), true);
  check("H2B M.S.: institution is the school alone", entries[0].institution?.value, "Example Institute");
  check("H2B M.S.: credential is the degree alone", entries[0].credential?.value, "M.S.");
  check("H2B M.S.: the parenthetical stays inside fieldOfStudy", entries[0].fieldOfStudy?.value, "Automation and Design Engineering (Machine Vision)");
  check("H2B M.S.: the date is unchanged", entries[0].dateRangeText?.value, "1994–1996");
  check("H2B M.S.: rawHeaderText remains verbatim", entries[0].rawHeaderText, raw);
}

// H2B-3 - ACRONYM: proves positive institution-keyword evidence is NOT
//         required on the left side.
counter = 0;
{
  const raw = `• 2018–2022 ABC ${H2B_DASH} B.S. in Engineering`;
  const entries = extractEducationEntries("s1", [block(raw, "bullet")]);
  check("H2B acronym: took the composite route without an institution keyword", entries[0].reasonCodes.includes(H2B_ROUTE), true);
  check("H2B acronym: institution is the acronym", entries[0].institution?.value, "ABC");
  check("H2B acronym: credential is the degree", entries[0].credential?.value, "B.S.");
  check("H2B acronym: fieldOfStudy is the major", entries[0].fieldOfStudy?.value, "Engineering");
  check("H2B acronym: rawHeaderText remains verbatim", entries[0].rawHeaderText, raw);
}

// H2B-4 - PROVENANCE: every value the composite produces traces to the
//         one source block it came from.
counter = 0;
{
  const sourceBlock = block(`• 1990–1994 Example Institute ${H2B_DASH} B.S. in Precision Engineering`, "bullet");
  const entries = extractEducationEntries("s1", [sourceBlock]);
  check("H2B provenance: institution section id", entries[0].institution?.source.sourceSectionId, "s1");
  check("H2B provenance: institution block id", entries[0].institution?.source.sourceBlockIds, [sourceBlock.id]);
  check("H2B provenance: institution element ids", entries[0].institution?.source.sourceElementIds, sourceBlock.sourceElementIds);
  check("H2B provenance: credential block id", entries[0].credential?.source.sourceBlockIds, [sourceBlock.id]);
  check("H2B provenance: fieldOfStudy block id", entries[0].fieldOfStudy?.source.sourceBlockIds, [sourceBlock.id]);
  checkTrue("H2B provenance: values are real StructuredTextValues", typeof entries[0].institution?.confidence === "number" && typeof entries[0].credential?.extractionMethod === "string");
}

// H2B-5 - NEGATIVE, decisive collision: Degree <dash> Degree in Field.
//         The right side satisfies every degree signal, so only the
//         left-not-degree condition can refuse it.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block(`B.S. ${H2B_DASH} M.S. in Engineering (2019 - 2021)`)]);
  check("H2B negative degree-degree: the composite route did NOT fire", entries[0].reasonCodes.includes(H2B_ROUTE), false);
  check("H2B negative degree-degree: a degree never becomes the institution", entries[0].institution?.value === "B.S.", false);
  check("H2B negative degree-degree: its date is still structured", entries[0].dateRangeText?.value, "2019 - 2021");
}

// H2B-6 - NEGATIVE: Institution <dash> Department. The right side has no
//         degree evidence at all.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block(`Example University ${H2B_DASH} Department of Physics (2015 - 2019)`)]);
  check("H2B negative department: the composite route did NOT fire", entries[0].reasonCodes.includes(H2B_ROUTE), false);
  check("H2B negative department: a department never becomes a credential", entries[0].credential?.value === "Department of Physics", false);
  check("H2B negative department: a department never becomes a fieldOfStudy", entries[0].fieldOfStudy?.value === "Department of Physics", false);
}

// H2B-7 - NEGATIVE: Degree <dash> Field. Locks the corrected conclusion
//         that this shape is excluded by RIGHT-side evidence alone.
counter = 0;
{
  const entries = extractEducationEntries("s1", [block(`B.S. ${H2B_DASH} Precision Engineering (2015 - 2019)`)]);
  check("H2B negative degree-field: the composite route did NOT fire", entries[0].reasonCodes.includes(H2B_ROUTE), false);
  check("H2B negative degree-field: a bare major never becomes a credential", entries[0].credential?.value === "Precision Engineering", false);
}

// --- Phase 2B-C2 - continuation-metadata date consumption ---
// A header with no date of its own may take the date from the single
// continuation line C1 already attached to it - but only when what is
// left of that line after the date is nothing or a location. Prose that
// merely mentions a year is refused.
const C2_ROUTE = "single-line-header-continuation-date";

// C2-1 - PRIMARY: marker + location + date continuation.
counter = 0;
{
  const header = block("• Generic Program (Example Polytechnic) Expected in", "bullet");
  const cont = block("– Example City, ST · 04/2027");
  const entries = extractEducationEntries("s1", [header, cont]);
  check("C2 primary: still exactly one entry", entries.length, 1);
  check("C2 primary: took the continuation-date route", entries[0].reasonCodes.includes(C2_ROUTE), true);
  check("C2 primary: the continuation date is structured", entries[0].dateRangeText?.value, "04/2027");
  check("C2 primary: date provenance points at the continuation block", entries[0].dateRangeText?.source.sourceBlockIds, [cont.id]);
  check("C2 primary: date provenance element ids come from the continuation block", entries[0].dateRangeText?.source.sourceElementIds, cont.sourceElementIds);
  check("C2 primary: location stays undefined", entries[0].location, undefined);
  check("C2 primary: the unresolved header is still preserved", detailValues(entries[0]).includes("Generic Program (Example Polytechnic) Expected in"), true);
  check("C2 primary: the full continuation line is still preserved", detailValues(entries[0]).includes("– Example City, ST · 04/2027"), true);
  check("C2 primary: rawHeaderText holds the header line only", entries[0].rawHeaderText, "• Generic Program (Example Polytechnic) Expected in");
  check("C2 primary: C3 is untouched - no credential invented", entries[0].credential?.value, "Generic Program");
  check("C2 primary: C3 is untouched - no institution invented", entries[0].institution?.value, "Example Polytechnic");
  check("C2 primary: C3 is untouched - no fieldOfStudy invented", entries[0].fieldOfStudy, undefined);
}

// C2-2 - the presentation marker is not required.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("Example City, ST · 04/2027"),
  ]);
  check("C2 unmarked: the continuation date is structured", entries[0].dateRangeText?.value, "04/2027");
  check("C2 unmarked: location stays undefined", entries[0].location, undefined);
  check("C2 unmarked: the continuation line is still preserved", detailValues(entries[0]).includes("Example City, ST · 04/2027"), true);
}

// C2-3 - a date-only continuation leaves an empty remainder.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("04/2027"),
  ]);
  check("C2 date-only: the continuation date is structured", entries[0].dateRangeText?.value, "04/2027");
  check("C2 date-only: no location is invented", entries[0].location, undefined);
  check("C2 date-only: the continuation line is still preserved", detailValues(entries[0]).includes("04/2027"), true);
}

// C2-4 - marker + date only.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("– 04/2027"),
  ]);
  check("C2 marker+date: the continuation date is structured", entries[0].dateRangeText?.value, "04/2027");
  check("C2 marker+date: no location is invented", entries[0].location, undefined);
  check("C2 marker+date: the continuation line is still preserved", detailValues(entries[0]).includes("– 04/2027"), true);
}

// C2-5 - NEGATIVE: a header that already has its own date is never
//        supplemented or overridden by a body year.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("Example University - 2019 - 2021"),
    block("Note: values converted for presentation in 2026"),
  ]);
  check("C2 dated header: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 dated header: its own date is untouched", entries[0].dateRangeText?.value, "2019 - 2021");
}

// C2-6 - NEGATIVE: note-like prose containing a year, under an undated
//        header, must not supply a date.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("Note: values converted for presentation in 2026"),
  ]);
  check("C2 note prose: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 note prose: no date is structured", entries[0].dateRangeText, undefined);
}

// C2-7 - NEGATIVE: an honours line carrying a year.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("Dean's List 2023"),
  ]);
  check("C2 honour: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 honour: no date is structured", entries[0].dateRangeText, undefined);
}

// C2-8 - NEGATIVE: award prose carrying a year.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("Awarded a scholarship in 2020"),
  ]);
  check("C2 award prose: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 award prose: no date is structured", entries[0].dateRangeText, undefined);
}

// C2-9 - NEGATIVE: descriptive prose carrying a year.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("Exchange semester 2019"),
  ]);
  check("C2 exchange prose: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 exchange prose: no date is structured", entries[0].dateRangeText, undefined);
}

// C2-10 - NEGATIVE: only the FIRST body block is eligible; a later
//         date-bearing line is never scanned.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic) Expected in", "bullet"),
    block("• Member of the student engineering society", "bullet"),
    block("– Example City, ST · 04/2027"),
  ]);
  check("C2 later body: the continuation route did NOT fire", entries[0].reasonCodes.includes(C2_ROUTE), false);
  check("C2 later body: no date is structured from a later block", entries[0].dateRangeText, undefined);
  check("C2 later body: the later line is still preserved", detailValues(entries[0]).includes("– Example City, ST · 04/2027"), true);
}

// --- Phase 2B-C3 - Credential / Program (Institution) ---
// A bracketed suffix only becomes the institution when it carries
// positive institution evidence of its own. Specializations, honours,
// statuses, places and plain descriptions are refused, as are reversed
// shapes and acronym-only brackets (deferred).
const C3_ROUTE = "single-line-header-credential-parenthetical-institution";
const C3_CONT = "– Example City, ST · 04/2027";

// C3-1 - PRIMARY: credential (institution) with a trailing qualifier.
counter = 0;
{
  const header = block("• Law Clerk (Seneca Polytechnic) Expected in", "bullet");
  const cont = block("– Toronto, ON · 04/2027");
  const entries = extractEducationEntries("s1", [header, cont]);
  check("C3 primary: still exactly one entry", entries.length, 1);
  check("C3 primary: took the parenthetical-institution route", entries[0].reasonCodes.includes(C3_ROUTE), true);
  check("C3 primary: the left side becomes the credential", entries[0].credential?.value, "Law Clerk");
  check("C3 primary: credentials[] holds only that credential", entries[0].credentials.map((v) => v.value), ["Law Clerk"]);
  check("C3 primary: the bracketed school becomes the institution", entries[0].institution?.value, "Seneca Polytechnic");
  check("C3 primary: institutions[] holds only that institution", entries[0].institutions.map((v) => v.value), ["Seneca Polytechnic"]);
  check("C3 primary: fieldOfStudy stays undefined", entries[0].fieldOfStudy, undefined);
  check("C3 primary: location stays undefined", entries[0].location, undefined);
  check("C3 primary: the C2 continuation date is unchanged", entries[0].dateRangeText?.value, "04/2027");
  check("C3 primary: the C2 date provenance is still the continuation block", entries[0].dateRangeText?.source.sourceBlockIds, [cont.id]);
  check("C3 primary: credential provenance is the header block", entries[0].credential?.source.sourceBlockIds, [header.id]);
  check("C3 primary: institution provenance is the header block", entries[0].institution?.source.sourceBlockIds, [header.id]);
  check("C3 primary: the preserved header line is unchanged", detailValues(entries[0]).includes("Law Clerk (Seneca Polytechnic) Expected in"), true);
  check("C3 primary: the preserved continuation line is unchanged", detailValues(entries[0]).includes("– Toronto, ON · 04/2027"), true);
  checkTrue("C3 primary: \"Expected in\" survives in the preserved detail", detailValues(entries[0]).some((v) => v.includes("Expected in")));
  check("C3 primary: rawHeaderText remains verbatim", entries[0].rawHeaderText, "• Law Clerk (Seneca Polytechnic) Expected in");
}

// C3-2 - no trailing qualifier.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Generic Program (Example Polytechnic)", "bullet"),
    block(C3_CONT),
  ]);
  check("C3 no-suffix: credential resolves", entries[0].credential?.value, "Generic Program");
  check("C3 no-suffix: institution resolves", entries[0].institution?.value, "Example Polytechnic");
  check("C3 no-suffix: fieldOfStudy stays undefined", entries[0].fieldOfStudy, undefined);
}

// C3-3 - a school/faculty name is institution-shaped under current evidence.
counter = 0;
{
  const entries = extractEducationEntries("s1", [
    block("• Law Clerk (School of Legal Studies)", "bullet"),
    block(C3_CONT),
  ]);
  check("C3 school name: credential resolves", entries[0].credential?.value, "Law Clerk");
  check("C3 school name: institution resolves", entries[0].institution?.value, "School of Legal Studies");
}

// C3-4..13 - NEGATIVES: a bracketed suffix without positive institution
//            evidence, or a reversed shape, is never classified.
counter = 0;
{
  const negatives: Array<[string, string]> = [
    ["specialization", "M.S. in Engineering (Machine Vision)"],
    ["AI specialization", "B.S. in Computer Science (Artificial Intelligence)"],
    ["honours", "Program (Honours)"],
    ["degree honours", "Bachelor of Science (Honours)"],
    ["expected date", "Degree (Expected 2027)"],
    ["location", "Program (Toronto, ON)"],
    ["modality", "Certificate (Online)"],
    ["descriptive", "Program (Accelerated)"],
    ["reversed institution-first", "Seneca Polytechnic (Law Clerk)"],
    ["institution + location", "University of Toronto (Toronto, ON)"],
    ["MIT acronym", "B.S. (MIT)"],
    ["KAIST acronym", "M.S. (KAIST)"],
    ["multiple groups", "Program (Example Polytechnic) (Honours)"],
  ];
  for (const [label, text] of negatives) {
    counter = 0;
    const entries = extractEducationEntries("s1", [block(text, "bullet"), block(C3_CONT)]);
    const inner = text.slice(text.indexOf("(") + 1, text.indexOf(")"));
    check(`C3 negative ${label}: the parenthetical route did NOT fire`, entries[0].reasonCodes.includes(C3_ROUTE), false);
    check(`C3 negative ${label}: the bracket text never becomes the institution`, entries[0].institution?.value === inner, false);
    check(`C3 negative ${label}: the bracket text never becomes the credential`, entries[0].credential?.value === inner, false);
  }
}

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
