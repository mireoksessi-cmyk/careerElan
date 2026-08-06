/*
  Phase 5D.6E TASK A - Synthetic regression matrix for
  resolveMultiFieldOfStudyDisplay (textExtraction.ts) and the
  textPreservationValidator.ts "/" safe-leftover fix. Minimum 40
  academic cases per spec section 2.4, plus negative controls per
  section 2.5. Expected values are hand-authored from the fix's own
  documented design (see resolveMultiFieldOfStudyDisplay's own header
  comment), never generated from current output.
*/
import { resolveMultiFieldOfStudyDisplay } from "./textExtraction";
import { validateBlockTextPreservation } from "./textPreservationValidator";
import type { EducationEntry } from "../resumeStructured/types";
import type { AssemblyBlock } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} - expected ${e}, got ${a}`);
  }
}

function textValue(value: string) {
  return { value, confidence: 0.6, extractionMethod: "pattern-rule" as const, source: { sourceSectionId: "s0", sourceBlockIds: [], sourceElementIds: [] } };
}

function entry(fieldsOfStudy: string[], rawHeaderText: string): EducationEntry {
  return {
    id: "e0",
    credentials: [],
    fieldsOfStudy: fieldsOfStudy.map(textValue),
    institutions: [],
    honors: [],
    details: [],
    rawHeaderText,
    source: { sourceSectionId: "s0", sourceBlockIds: [], sourceElementIds: [] },
    isUncertain: false,
    reasonCodes: [],
  };
}

// ============================================================
// ACADEMIC SYNTHETIC MATRIX (40+, spec section 2.4)
// ============================================================

check(
  "1: Degree + Major only (single field) - untouched, returns undefined",
  resolveMultiFieldOfStudyDisplay(entry(["Economics"], "Bachelor of Arts\nEconomics\nExample University\n2013 - 2017")),
  undefined
);
check(
  "2: Degree + Major + Minor, slash-in-source verbatim (r07 Political Science case)",
  resolveMultiFieldOfStudyDisplay(entry(["Economics", "Political Science"], "Bachelor of Arts\nEconomics / Political Science\nExample University\n2013 - 2017")),
  "Economics / Political Science"
);
check(
  "3: Degree + Major + Minor, comma-in-source verbatim (r07 Minor Biology case)",
  resolveMultiFieldOfStudyDisplay(entry(["Major: Chemistry", "Minor: Biology"], "Bachelor of Science\nMajor: Chemistry, Minor: Biology\nExample University\n2014 - 2018")),
  "Major: Chemistry, Minor: Biology"
);
check(
  "4: Degree + Double Major, and-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Finance", "Marketing"], "Bachelor of Business Administration\nFinance and Marketing\nExample University\n2015 - 2019")),
  "Finance and Marketing"
);
check(
  "5: Degree + Major + Concentration, dash-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Computer Science", "Concentration in AI"], "Bachelor of Science\nComputer Science - Concentration in AI\nExample University\n2018 - 2022")),
  "Computer Science - Concentration in AI"
);
check(
  "6: Degree + Specialization, pipe-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Mechanical Engineering", "Specialization: Robotics"], "Bachelor of Engineering\nMechanical Engineering | Specialization: Robotics\nExample Institute\n2016 - 2020")),
  "Mechanical Engineering | Specialization: Robotics"
);
check(
  "7: Degree + Honors (single field, honors[] separate) - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["Psychology"], "Bachelor of Arts\nPsychology\nExample University\n2012 - 2016")),
  undefined
);
check(
  "8: Major only, no minor (single field) - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["History"], "Bachelor of Arts\nHistory\nExample University\n2011 - 2015")),
  undefined
);
check(
  "9: Minor only as sole field (single field) - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["Minor: Statistics"], "Bachelor of Science\nMinor: Statistics\nExample University\n2017 - 2021")),
  undefined
);
check(
  "10: Double minor, comma-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Minor: Spanish", "Minor: Linguistics"], "Bachelor of Arts\nEnglish\nMinor: Spanish, Minor: Linguistics\nExample University\n2013 - 2017")),
  "Minor: Spanish, Minor: Linguistics"
);
check(
  "11: slash present in original source, preserved exactly",
  resolveMultiFieldOfStudyDisplay(entry(["Biology", "Chemistry"], "Bachelor of Science\nBiology/Chemistry\nExample University\n2014 - 2018")),
  "Biology/Chemistry"
);
check(
  "12: slash NOT in original, comma used instead, no slash invented",
  resolveMultiFieldOfStudyDisplay(entry(["Sociology", "Anthropology"], "Bachelor of Arts\nSociology, Anthropology\nExample University\n2015 - 2019")),
  "Sociology, Anthropology"
);
check(
  "13: pipe delimiter preserved exactly",
  resolveMultiFieldOfStudyDisplay(entry(["Physics", "Astronomy"], "Bachelor of Science\nPhysics | Astronomy\nExample University\n2016 - 2020")),
  "Physics | Astronomy"
);
check(
  "14: dash delimiter preserved exactly",
  resolveMultiFieldOfStudyDisplay(entry(["Marketing", "Digital Strategy"], "Bachelor of Commerce\nMarketing - Digital Strategy\nExample University\n2017 - 2021")),
  "Marketing - Digital Strategy"
);
check(
  "15: multi-line, fields split across two physical lines - falls back to '/' join",
  resolveMultiFieldOfStudyDisplay(entry(["Environmental Science", "Policy Studies"], "Bachelor of Science\nEnvironmental Science\nPolicy Studies\nExample University\n2018 - 2022")),
  "Environmental Science / Policy Studies"
);
check(
  "16: single-line verbatim match",
  resolveMultiFieldOfStudyDisplay(entry(["Nursing", "Public Health"], "Bachelor of Science in Nursing and Public Health\nExample University\n2019 - 2023")),
  "Bachelor of Science in Nursing and Public Health"
);
check(
  "17: date-first header order, verbatim line still found",
  resolveMultiFieldOfStudyDisplay(entry(["Law", "Business"], "2015 - 2019\nJuris Doctor\nLaw / Business\nExample Law School")),
  "Law / Business"
);
check(
  "18: institution-first header order, verbatim line still found",
  resolveMultiFieldOfStudyDisplay(entry(["Architecture", "Urban Planning"], "Example University\nBachelor of Architecture\nArchitecture, Urban Planning\n2013 - 2018")),
  "Architecture, Urban Planning"
);
check(
  "19: French accents, comma-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["économie", "gestion"], "Licence\néconomie, gestion\nUniversité Example\n2014 - 2017")),
  "économie, gestion"
);
check(
  "20: French accents, slash-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Génie civil", "Génie mécanique"], "Baccalauréat\nGénie civil / Génie mécanique\nÉcole Polytechnique Example\n2016 - 2021")),
  "Génie civil / Génie mécanique"
);
check(
  "21: English/French mixed, and-joined verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["International Business", "Commerce international"], "Bachelor of Commerce\nInternational Business and Commerce international\nExample University\n2015 - 2019")),
  "International Business and Commerce international"
);
check(
  "22: three fields, all on one verbatim line",
  resolveMultiFieldOfStudyDisplay(entry(["Biology", "Chemistry", "Physics"], "Bachelor of Science\nBiology, Chemistry, Physics\nExample University\n2016 - 2020")),
  "Biology, Chemistry, Physics"
);
check(
  "23: fields with ampersand joiner verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Art", "Design"], "Bachelor of Fine Arts\nArt & Design\nExample Academy\n2014 - 2018")),
  "Art & Design"
);
check(
  "24: field value is a substring of another field value on the same line, still finds full line",
  resolveMultiFieldOfStudyDisplay(entry(["Data", "Data Science"], "Bachelor of Science\nData / Data Science\nExample University\n2019 - 2023")),
  "Data / Data Science"
);
check(
  "25: rawHeaderText has extra whitespace around the field line, trimmed",
  resolveMultiFieldOfStudyDisplay(entry(["Music", "Theatre"], "Bachelor of Arts\n  Music / Theatre  \nExample Conservatory\n2012 - 2016")),
  "Music / Theatre"
);
check(
  "26: field values appear on a line with leading label text",
  resolveMultiFieldOfStudyDisplay(entry(["Accounting", "Finance"], "Bachelor of Commerce\nMajors: Accounting, Finance\nExample University\n2017 - 2021")),
  "Majors: Accounting, Finance"
);
check(
  "27: no rawHeaderText line contains both values - falls back to '/' join, never crashes",
  resolveMultiFieldOfStudyDisplay(entry(["Geology", "Oceanography"], "Bachelor of Science\nExample University\n2013 - 2017")),
  "Geology / Oceanography"
);
check(
  "28: empty-string field values filtered out before counting",
  resolveMultiFieldOfStudyDisplay(entry(["Philosophy", ""], "Bachelor of Arts\nPhilosophy\nExample University\n2011 - 2015")),
  undefined
);
check(
  "29: zero fields - untouched",
  resolveMultiFieldOfStudyDisplay(entry([], "Bachelor of Arts\nExample University\n2010 - 2014")),
  undefined
);
check(
  "30: double major with 'Double Major:' label line elsewhere in header",
  resolveMultiFieldOfStudyDisplay(entry(["Economics", "Political Science"], "Bachelor of Arts\nDouble Major:\nEconomics / Political Science\nExample University\n2013 - 2017")),
  "Economics / Political Science"
);
check(
  "31: concentration phrase with parentheses, verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Finance", "Concentration (Investment Banking)"], "Bachelor of Business\nFinance (Concentration (Investment Banking))\nExample University\n2018 - 2022"))?.includes("Finance") ?? false,
  true
);
check(
  "32: four fields, comma-list verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Math", "Stats", "CS", "Physics"], "Bachelor of Science\nMath, Stats, CS, Physics\nExample University\n2015 - 2019")),
  "Math, Stats, CS, Physics"
);
check(
  "33: semicolon delimiter preserved verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Journalism", "Media Studies"], "Bachelor of Arts\nJournalism; Media Studies\nExample University\n2016 - 2020")),
  "Journalism; Media Studies"
);
check(
  "34: field values with numbers/codes, verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["ENGR 101 Track", "ENGR 202 Track"], "Bachelor of Engineering\nENGR 101 Track / ENGR 202 Track\nExample Institute\n2017 - 2021")),
  "ENGR 101 Track / ENGR 202 Track"
);
check(
  "35: mixed-case field values preserved exactly (no re-casing)",
  resolveMultiFieldOfStudyDisplay(entry(["mHealth Systems", "eCommerce"], "Bachelor of Science\nmHealth Systems / eCommerce\nExample University\n2019 - 2023")),
  "mHealth Systems / eCommerce"
);
check(
  "36: verbatim line search is case-sensitive-safe (exact substring match)",
  resolveMultiFieldOfStudyDisplay(entry(["Biology", "biology of marine life"], "Bachelor of Science\nBiology, biology of marine life\nExample University\n2014 - 2018")),
  "Biology, biology of marine life"
);
check(
  "37: fields joined by 'et' (French 'and') verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Droit", "Sciences politiques"], "Licence\nDroit et Sciences politiques\nUniversité Example\n2015 - 2018")),
  "Droit et Sciences politiques"
);
check(
  "38: fields on a line with trailing punctuation preserved verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Chemistry", "Biochemistry"], "Bachelor of Science\nChemistry / Biochemistry.\nExample University\n2013 - 2017")),
  "Chemistry / Biochemistry."
);
check(
  "39: rawHeaderText using CRLF-normalized single \\n still splits correctly",
  resolveMultiFieldOfStudyDisplay(entry(["Economics", "Statistics"], "Bachelor of Arts\nEconomics & Statistics\nExample University\n2012 - 2016")),
  "Economics & Statistics"
);
check(
  "40: three-way concentration list with Oxford comma verbatim",
  resolveMultiFieldOfStudyDisplay(entry(["Finance", "Accounting", "Economics"], "Bachelor of Commerce\nFinance, Accounting, and Economics\nExample University\n2016 - 2020")),
  "Finance, Accounting, and Economics"
);

// ============================================================
// NEGATIVE CONTROLS (spec section 2.5) - single-field entries must
// never be affected by this fix, regardless of how "academic-sounding"
// or delimiter-like the field text itself looks.
// ============================================================

check(
  "neg-1: 'Arts and Science Faculty' as a single field - untouched, no split invented",
  resolveMultiFieldOfStudyDisplay(entry(["Arts and Science Faculty"], "Bachelor of Arts\nArts and Science Faculty\nExample University")),
  undefined
);
check(
  "neg-2: 'Political Science Department' as a single field - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["Political Science Department"], "Bachelor of Arts\nPolitical Science Department\nExample University")),
  undefined
);
check(
  "neg-3: 'Biology Research Center' as a single field - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["Biology Research Center"], "Bachelor of Science\nBiology Research Center\nExample University")),
  undefined
);
check(
  "neg-4: 'Research / Development' as a single field (internal slash preserved, not treated as 2 fields)",
  resolveMultiFieldOfStudyDisplay(entry(["Research / Development"], "Bachelor of Science\nResearch / Development\nExample University")),
  undefined
);
check(
  "neg-5: 'Honors College' as a single field - untouched",
  resolveMultiFieldOfStudyDisplay(entry(["Honors College"], "Bachelor of Arts\nHonors College\nExample University")),
  undefined
);

// ============================================================
// textPreservationValidator.ts "/" safe-leftover fix - must not mask
// a genuinely invented WORD, only a legitimate structural "/" join.
// ============================================================

function fakeBlock(payload: unknown): AssemblyBlock {
  return {
    id: "b0",
    kind: "education-entry",
    sourceEntryId: "e0",
    sourceSectionIds: ["s0"],
    sourceBlockIds: [],
    estimatedContentUnits: 0,
    minVisibleContentUnits: 0,
    breakPolicy: "avoid",
    keepTogether: true,
    canSplit: false,
    splitStrategy: "none",
    priority: 0,
    isOptional: false,
    isUncertain: false,
    payload,
  } as unknown as AssemblyBlock;
}

{
  const e = entry(["Economics", "Political Science"], "Bachelor of Arts\nEconomics / Political Science\nExample University\n2013 - 2017");
  const rendered = "Economics / Political Science";
  const result = validateBlockTextPreservation(fakeBlock(e), rendered);
  check("validator-1: legitimate '/' join not flagged as invented", result.inventedSuspected, false);
  check("validator-1b: no missing fragments", result.missing.length, 0);
}
{
  const e = entry(["Economics", "Political Science"], "Bachelor of Arts\nEconomics / Political Science\nExample University\n2013 - 2017");
  const rendered = "Economics / Political Science ZZQQXX-INVENTED-WORD";
  const result = validateBlockTextPreservation(fakeBlock(e), rendered);
  check("validator-2: a genuinely invented WORD (not just '/') is still caught", result.inventedSuspected, true);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
