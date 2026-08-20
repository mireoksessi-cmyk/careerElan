/*
  Phase 6I.6.42 - targeted regression coverage for the rawHeaderText
  content-loss fix (Experience header fallback + Education visibility
  fallback). In-memory fixtures only, no DB/network/OpenAI. Run with:
    npx tsx lib/resumeTemplates/tests/rawHeaderTextFidelity6I642.test.ts
*/
import {
  experienceHeaderFallbackText,
  educationHeaderFallbackText,
  type NormalizedExperienceEntry,
  type NormalizedEducationEntry,
} from "../shared/contentAdapters";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

function experienceEntry(overrides: Partial<NormalizedExperienceEntry>): NormalizedExperienceEntry {
  return {
    id: "e1",
    organization: "",
    role: "",
    location: "",
    dateRangeText: "",
    items: [],
    hasHierarchy: false,
    isVolunteer: false,
    rawHeaderText: "",
    ...overrides,
  };
}

function educationEntry(overrides: Partial<NormalizedEducationEntry>): NormalizedEducationEntry {
  return {
    id: "edu1",
    institution: "",
    credential: "",
    fieldOfStudy: "",
    location: "",
    institutions: [],
    credentials: [],
    fieldsOfStudy: [],
    dateRangeText: "",
    gpa: "",
    honors: [],
    details: [],
    rawHeaderText: "",
    ...overrides,
  };
}

function main() {
  // CASE A - Experience structured fields present: fallback must NOT fire.
  check(
    "CASE A: experienceHeaderFallbackText returns null when role+organization present",
    experienceHeaderFallbackText(experienceEntry({ role: "Maintenance Technician", organization: "ABC Manufacturing", dateRangeText: "2022-2026" })),
    null
  );

  // CASE B - Experience raw-only (the real Test 1 shape): fallback must fire
  // with the exact rawHeaderText, and callers must be able to detect it to
  // suppress the separately-rendered date (no duplication - verified here
  // by confirming the returned string equals rawHeaderText verbatim, not a
  // re-parsed/re-split value).
  const rawOnlyExperience = experienceEntry({
    role: "",
    organization: "",
    dateRangeText: "2022-2026",
    rawHeaderText: "Maintenance Technician - ABC Manufacturing (2022-2026)",
  });
  check(
    "CASE B: experienceHeaderFallbackText returns rawHeaderText verbatim when role+organization both empty",
    experienceHeaderFallbackText(rawOnlyExperience),
    "Maintenance Technician - ABC Manufacturing (2022-2026)"
  );
  check(
    "CASE B: fallback text contains the date exactly once (embedded in rawHeaderText, not duplicated by the helper)",
    (experienceHeaderFallbackText(rawOnlyExperience) ?? "").split("2022-2026").length - 1,
    1
  );

  // CASE E (Experience) - truly empty entry: fallback must NOT fire (nothing to show).
  check(
    "CASE E: experienceHeaderFallbackText returns null when rawHeaderText is also empty",
    experienceHeaderFallbackText(experienceEntry({})),
    null
  );

  // CASE C - Education structured fields present: fallback must NOT fire.
  check(
    "CASE C: educationHeaderFallbackText returns null when institution present",
    educationHeaderFallbackText(educationEntry({ institution: "Seneca Polytechnic", credential: "Diploma" })),
    null
  );

  // CASE D - Education raw-only (the real Test 1 shape): fallback must fire.
  const rawOnlyEducation = educationEntry({ rawHeaderText: "Electrical Engineering Technology Diploma" });
  check(
    "CASE D: educationHeaderFallbackText returns rawHeaderText verbatim when every structured field is empty",
    educationHeaderFallbackText(rawOnlyEducation),
    "Electrical Engineering Technology Diploma"
  );

  // CASE D variant - only institutions[] (array form) populated: still counts as structured, no fallback.
  check(
    "CASE D variant: educationHeaderFallbackText returns null when only institutions[] array is populated",
    educationHeaderFallbackText(educationEntry({ institutions: ["Seneca Polytechnic"], rawHeaderText: "Law Clerk (Seneca Polytechnic)" })),
    null
  );

  // CASE E (Education) - truly empty entry (Fix must not weaken filtering for genuinely empty entries).
  check(
    "CASE E: educationHeaderFallbackText returns null when rawHeaderText is also empty",
    educationHeaderFallbackText(educationEntry({})),
    null
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
