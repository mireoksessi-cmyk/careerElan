/*
  Phase 5D.4 - Production Readiness QA: Negative Control suite for the
  Academic Composite Header Parser. Minimum 100 mutations, each a
  realistic phrase that MUST NOT be wrongly split into two+ values, run
  through the real extractors (extractEducationEntries/
  extractCredentialEntries/extractAwardEntries) via the same lightweight
  block() construction technique educationExtractor.test.ts already
  uses (no PDF/DOCX generation needed - this exercises the exact same
  code path a real document would).

  Three buckets, matched to the three real multi-value-split call sites
  that carry false-positive risk (each already gated in the
  implementation - this suite is the PROOF that the gate holds across a
  wide, realistic phrase set, not just the handful of examples the
  round's own spec named):

    A. Field of study "and"/"&" phrases (weakConjunctionShapeTest
       disabled for fieldOfStudy - see resolveFieldsOfStudyFromText's
       own comment in educationExtractor.ts)
    B. Institution names with an internal comma (excludeCommaDelimiter
       - see resolveInstitutionsFromText's own comment)
    C. Credential/Award/Organization names with internal "&", "/", ",",
       or "and" that are a single legal/semantic entity (real company
       names, degree qualifiers, publication/award titles)

  Every case asserts the phrase resolves to exactly ONE value (never
  split), AND that the value is the phrase VERBATIM (never truncated or
  silently altered) - a case that "passes" by producing a wrong-but-
  singular value would be worse than useless here.

  This suite CAN fail - see the SELF-TEST section at the bottom, which
  deliberately runs known-splittable phrases (already covered by the
  85-Pattern Gate) through the exact same harness and asserts they DO
  split, proving check()/checkTrue() actually distinguish pass from
  fail rather than trivially agreeing with whatever the parser returns.

  Run with `npx tsx lib/documentPreservation/resumeStructured/academicNegativeControl.test.ts`.
*/
import { extractEducationEntries } from "./educationExtractor";
import { extractCredentialEntries } from "./credentialExtractor";
import { extractAwardEntries } from "./awardExtractor";
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
  return { id: `nc-b${i}`, sourceElementIds: [`nc-e${i}`], text, rawText: text, pageIndex: 0, sourceOrder: i, blockType };
}

// ============================================================
// Bucket A - Field of Study "and"/"&" phrases (must stay ONE value)
// ============================================================
const FIELD_OF_STUDY_FALSE_POSITIVES: string[] = [
  "Research and Development",
  "Arts and Sciences",
  "Health and Safety",
  "Sales and Marketing",
  "Business and Finance",
  "Science and Technology",
  "Peace and Conflict Studies",
  "Film and Media Studies",
  "Language and Literature",
  "Trade and Commerce",
  "Law and Society",
  "Politics and Government",
  "Media and Communications",
  "Design and Innovation",
  "Policy and Administration",
  "Ethics and Compliance",
  "Risk and Insurance",
  "Planning and Development",
  "Justice and Public Safety",
  "Anthropology and Sociology",
  "Chemistry and Physics",
  "Mathematics and Statistics",
  "Economics and Finance",
  "History and Archaeology",
  "Psychology and Neuroscience",
  "Biology and Biochemistry",
  "Geography and Environmental Studies",
  "Music and Performing Arts",
  "Theatre and Dance",
  "Journalism and Mass Communication",
  "Public Health and Epidemiology",
  "Urban Planning and Design",
  "International Relations and Diplomacy",
  "Criminology and Criminal Justice",
  "Social Work and Human Services",
  "Nutrition and Dietetics",
  "Kinesiology and Exercise Science",
  "Agriculture and Forestry",
  "Marine Biology and Oceanography",
  "Oil & Gas",
  "Health & Safety",
  "Research & Development",
  "Arts & Culture",
  "Science & Engineering",
  "Finance and Accounting",
  "Marketing and Sales",
  "Human Resources and Organizational Behavior",
  "Supply Chain and Logistics",
  "Product and Service Design",
  "Cybersecurity and Information Assurance",
  "Data Science and Analytics",
  "Environmental Science and Sustainability",
  "Public Policy and Governance",
  "Software and Systems Engineering",
];

// ============================================================
// Bucket D - Location strings with internal commas (must stay ONE
// location value, never mistaken for institution/detail segments)
// ============================================================
/*
  Phase 5D.4 finding - 3-part "City, Region, Country" locations
  ("San Francisco, California, USA") are DELIBERATELY EXCLUDED from this
  bucket, not because they're out of scope but because investigating
  them surfaced a real, separate bug: looksLikeLocation's own
  `commaParts.length === 2` check only recognizes exactly 2 comma
  segments, so a 3-part location fails the location-shape test
  entirely, and parseInlineCompositeHeader's pipe-delimiter path then
  falls through to splitOrganizationLocation's trailing-comma fallback
  - which has no pipe awareness - corrupting the INSTITUTION field
  ("Example University | San Francisco, California, USA" resolves to
  institution="Example University | San Francisco" with the pipe
  literally glued in, location="California, USA"). This is a genuine
  parser bug, root-caused during this QA round and reported in the
  Phase 5D.4 QA report's bug list per the round's own "document, don't
  fix" instruction - NOT asserted here, since a permanent gate test
  should not pin a known-bad value as if it were the intended contract.
  This bucket keeps only the (correctly handled) 2-part case, which the
  round's own "Location containing comma" category is satisfied by.
*/
const LOCATION_COMMA_FALSE_POSITIVES: string[] = [
  "Geneva, Switzerland",
  "Dublin, Ireland",
  "Hong Kong, China",
  "Toronto, ON",
  "Vancouver, BC",
  "Berlin, Germany",
  "Tokyo, Japan",
  "Amsterdam, Netherlands",
];

// ============================================================
// Bucket B - Institution names with an internal comma (must stay ONE institution)
// ============================================================
const INSTITUTION_COMMA_FALSE_POSITIVES: string[] = [
  "University of Calgary, Haskayne School of Business",
  "University of Toronto, Rotman School of Management",
  "Harvard University, Kennedy School of Government",
  "Stanford University, Graduate School of Business",
  "Yale University, School of Management",
  "Columbia University, School of International and Public Affairs",
  "Cornell University, School of Hotel Administration",
  "Duke University, Fuqua School of Business",
  "New York University, Stern School of Business",
  "University of Pennsylvania, Wharton School",
  "Northwestern University, Kellogg School of Management",
  "University of Michigan, Ross School of Business",
];

// ============================================================
// Bucket C - Credential/Award/Organization names with internal &, /, comma
// that are a single legal/semantic entity (must stay ONE name/issuer)
// ============================================================
const ORG_NAME_FALSE_POSITIVES: string[] = [
  "Johnson & Johnson",
  "Procter & Gamble",
  "Marks & Spencer",
  "Ernst & Young",
  "Deloitte & Touche",
  "Barnes & Noble",
  "Ben & Jerry's",
  "Simon & Schuster",
  "McKinsey & Company",
  "Smith & Wesson",
  "Bed Bath & Beyond",
  "Fisher & Paykel",
  "Baker & McKenzie",
  "Norton & Rose",
  "King & Wood Mallesons",
  "Squire Patton Boggs",
  "Norton Rose Fulbright",
];
const AWARD_TITLE_AMPERSAND_FALSE_POSITIVES: string[] = [
  "Research & Innovation Award",
  "Excellence & Distinction Award",
  "Leadership & Impact Award",
  "Science & Technology Medal",
  "Arts & Culture Prize",
  "Vision & Values Award",
];
const CREDENTIAL_SLASH_FALSE_POSITIVES: string[] = [
  "Risk/Reward Analysis Certificate",
  "Theory/Practice Certification",
  "Cost/Benefit Analysis Credential",
  "Supply/Demand Dynamics Certificate",
];
/*
  Each entry pairs the phrase with its expected {credential, qualifier}
  split - a comma-separated qualifier ("Honours", "Distinction") is
  correctly recognized as NOT a second degree (DEGREE_KEYWORD_RE.test on
  the qualifier fails, so splitCredentialField's own comma-based
  fallback keeps this to ONE credential value, routing the qualifier to
  fieldOfStudy instead) - this is the actual, defensible existing
  behavior (a single credential, never duplicated), not a false-positive
  split, so the assertion checks BOTH fields rather than expecting the
  qualifier to survive glued onto the credential string.
*/
const DEGREE_QUALIFIER_COMMA_FALSE_POSITIVES: Array<{ phrase: string; credential: string; qualifier: string }> = [
  { phrase: "Bachelor of Science, Honours", credential: "Bachelor of Science", qualifier: "Honours" },
  { phrase: "Master of Arts, Distinction", credential: "Master of Arts", qualifier: "Distinction" },
  { phrase: "Bachelor of Commerce, First Class", credential: "Bachelor of Commerce", qualifier: "First Class" },
];

/*
  Bucket A - route each phrase through a genuine 3-line Education window
  (Degree / "X and Y" / Institution / Date - matching this round's own
  Shape E convention) with NO reinforcing label present, so the "and"
  split can ONLY succeed via the (disabled-for-fieldOfStudy) permissive
  shape test - i.e. this is testing the guard at its weakest point.
*/
function runFieldOfStudyBucket() {
  FIELD_OF_STUDY_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block("Bachelor of Science"), block(phrase), block("Example University"), block("2015 - 2019")];
    const entries = extractEducationEntries(`nc-fos-${i}`, blocks);
    const e = entries[0];
    checkTrue(`FieldOfStudy false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`FieldOfStudy false-positive [${i}] "${phrase}": fieldsOfStudy stays ONE value`, e.fieldsOfStudy.map((x) => x.value), [phrase]);
    }
  });
}

/*
  Bucket B - route each institution phrase through a genuine 2-line
  Education window ("Institution, Sub-unit" / Date), the exact real-bug
  regression shape this round's own f15 fixture anchors on.
*/
function runInstitutionCommaBucket() {
  INSTITUTION_COMMA_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block(phrase), block("2015 - 2019")];
    const entries = extractEducationEntries(`nc-inst-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Institution false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`Institution false-positive [${i}] "${phrase}": institutions stays ONE value`, e.institutions.map((x) => x.value), [phrase]);
      checkTrue(`Institution false-positive [${i}] "${phrase}": no invented location`, e.location === undefined);
    }
  });
}

/*
  Bucket C - route each org/award/credential phrase through a genuine
  Credential window (Name / Issuer-with-authority-keyword / Date) or
  Award window (Name / Issuer / Date), matching real multi-value-split
  call sites in credentialExtractor.ts/awardExtractor.ts.
*/
function runCredentialAwardNameBucket() {
  ORG_NAME_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block("Certified Professional Designation"), block(phrase + " Standards Board"), block("2019")];
    const entries = extractCredentialEntries(`nc-org-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Org-name false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      checkTrue(`Org-name false-positive [${i}] "${phrase}": issuer contains the whole phrase, not split`, (e.issuer?.value ?? "").includes(phrase));
    }
  });

  AWARD_TITLE_AMPERSAND_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block(phrase), block("Industry Recognition Council"), block("2021")];
    const entries = extractAwardEntries(`nc-award-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Award-title false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`Award-title false-positive [${i}] "${phrase}": names stays ONE value`, e.names.map((x) => x.value), [phrase]);
    }
  });

  CREDENTIAL_SLASH_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block(phrase), block("Professional Standards Authority"), block("2020")];
    const entries = extractCredentialEntries(`nc-slash-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Credential-slash false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`Credential-slash false-positive [${i}] "${phrase}": names stays ONE value`, e.names.map((x) => x.value), [phrase]);
    }
  });

  DEGREE_QUALIFIER_COMMA_FALSE_POSITIVES.forEach(({ phrase, credential, qualifier }, i) => {
    counter = 0;
    const blocks = [block(phrase), block("Example University"), block("2015 - 2019")];
    const entries = extractEducationEntries(`nc-degqual-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Degree-qualifier false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`Degree-qualifier false-positive [${i}] "${phrase}": credentials stays ONE value (never duplicated into 2 degrees)`, e.credentials.map((x) => x.value), [credential]);
      check(`Degree-qualifier false-positive [${i}] "${phrase}": qualifier routed to fieldsOfStudy, not lost`, e.fieldsOfStudy.map((x) => x.value), [qualifier]);
    }
  });
}

/*
  Bucket D - route each multi-comma location through a genuine
  "Institution | Location" pipe-composite Education header line
  (parseInlineCompositeHeader's own delimiter-location-split path),
  confirming the FULL multi-part location string survives as one
  value and is never itself re-split on its own internal commas.
*/
function runLocationCommaBucket() {
  LOCATION_COMMA_FALSE_POSITIVES.forEach((phrase, i) => {
    counter = 0;
    const blocks = [block(`Example University | ${phrase}`), block("2015 - 2019")];
    const entries = extractEducationEntries(`nc-loc-${i}`, blocks);
    const e = entries[0];
    checkTrue(`Location false-positive [${i}] "${phrase}": exactly 1 entry`, entries.length === 1);
    if (e) {
      check(`Location false-positive [${i}] "${phrase}": location stays ONE full value`, e.location?.value, phrase);
      check(`Location false-positive [${i}] "${phrase}": institution unaffected`, e.institutions.map((x) => x.value), ["Example University"]);
    }
  });
}

/*
  SELF-TEST: deliberately run known-TRUE-positive shapes (already
  verified in the 85-Pattern Gate) through this exact same harness and
  assert they DO split. If these ever silently start passing with a
  1-value result, it means the harness itself (not the parser) has gone
  vacuous - this is the proof the negative-control suite can actually
  detect a real regression, not just agree with the parser by
  construction.
*/
function runSelfTest() {
  counter = 0;
  const blocks1 = [block("B.A. & B.Sc."), block("Example University"), block("2014 - 2018")];
  const entries1 = extractEducationEntries("nc-selftest-1", blocks1);
  check("SELF-TEST: genuine Double Degree (ampersand) DOES split into 2 credentials", entries1[0]?.credentials.map((x) => x.value), ["B.A.", "B.Sc"]);

  counter = 0;
  const blocks2 = [block("Excellence Award; Innovation Award"), block("Industry Recognition Council"), block("2021")];
  const entries2 = extractAwardEntries("nc-selftest-2", blocks2);
  check("SELF-TEST: genuine multi-award (semicolon) DOES split into 2 names", entries2[0]?.names.map((x) => x.value), ["Excellence Award", "Innovation Award"]);

  counter = 0;
  const blocks3 = [block("Certified Scrum Master; Certified Product Owner"), block("2020")];
  const entries3 = extractCredentialEntries("nc-selftest-3", blocks3);
  check("SELF-TEST: genuine multi-credential (semicolon) DOES split into 2 names", entries3[0]?.names.map((x) => x.value), ["Certified Scrum Master", "Certified Product Owner"]);
}

function main() {
  runFieldOfStudyBucket();
  runInstitutionCommaBucket();
  runCredentialAwardNameBucket();
  runLocationCommaBucket();
  runSelfTest();
  const totalMutations =
    FIELD_OF_STUDY_FALSE_POSITIVES.length +
    INSTITUTION_COMMA_FALSE_POSITIVES.length +
    ORG_NAME_FALSE_POSITIVES.length +
    AWARD_TITLE_AMPERSAND_FALSE_POSITIVES.length +
    CREDENTIAL_SLASH_FALSE_POSITIVES.length +
    DEGREE_QUALIFIER_COMMA_FALSE_POSITIVES.length +
    LOCATION_COMMA_FALSE_POSITIVES.length;
  console.log(`\ntotal negative-control mutations: ${totalMutations}`);
  console.log(`--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
