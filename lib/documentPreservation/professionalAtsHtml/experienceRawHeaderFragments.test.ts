/*
  Regression coverage for the raw-header-fidelity renderer/validator
  contract drift found via forensic audit of application
  fb7a96fa-a501-4138-9334-1eecdac91a37: commit 52f1fb8 ("Fix canonical
  raw header fidelity") taught renderers.tsx's ExperienceLikeView to
  fall back to rendering entry.rawHeaderText verbatim when role AND
  organization are both empty (and to suppress the separate
  location/date line entirely in that same branch), but
  extractExperienceEntryFragments() (textExtraction.ts) - the
  validator's own "expected text" ground truth for experience-entry/
  volunteer-entry blocks - was never given the matching fallback, so
  the validator flagged that same, correctly-rendered fallback text as
  invented, failing HTML validation and throwing TemplateRenderingError
  for any professional-ats resume containing a raw-header-only
  Experience or Volunteer entry - including ones that also have
  content bullets (the fallback decision is based on header-field
  emptiness alone, never on whether the entry's total fragment list is
  empty).

  Mirrors academicFieldPreservation.test.ts's own harness/fakeBlock
  convention exactly - pure unit-level fragment extraction and
  validator checks, no Playwright, no PDF/DOCX fixtures, no OpenAI.
  Run with `npx tsx lib/documentPreservation/professionalAtsHtml/experienceRawHeaderFragments.test.ts`.
*/
import { extractPayloadFragments } from "./textExtraction";
import { validateBlockTextPreservation } from "./textPreservationValidator";
import type { ExperienceEntry, EntryContentBlock } from "../resumeStructured/types";
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
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

function textValue(value: string) {
  return { value, confidence: 0.6, extractionMethod: "pattern-rule" as const, source: { sourceSectionId: "s0", sourceBlockIds: [], sourceElementIds: [] } };
}

function bullet(text: string, id: string): EntryContentBlock {
  return { id, kind: "bullet", text, source: { sourceSectionId: "s0", sourceBlockIds: [], sourceElementIds: [] } };
}

function experienceEntry(overrides: Partial<ExperienceEntry>): ExperienceEntry {
  return {
    id: "e0",
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: "",
    source: { sourceSectionId: "s0", sourceBlockIds: [], sourceElementIds: [] },
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function fakeBlock(kind: "experience-entry" | "volunteer-entry", payload: unknown): AssemblyBlock {
  return {
    id: "b0",
    kind,
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

// ============================================================
// CASE A - structured Experience header: existing behavior unchanged,
// rawHeaderText fallback NOT additionally included when role/org exist.
// ============================================================

check(
  "A1: role + organization populated, rawHeaderText also present - fallback not added",
  extractPayloadFragments("experience-entry", experienceEntry({
    role: textValue("Software Engineer"),
    organization: textValue("Example Corp"),
    rawHeaderText: "Software Engineer\nExample Corp\nJan 2020 - Present",
  })),
  ["Example Corp", "Software Engineer"]
);
check(
  "A2: role + organization populated, rawHeaderText absent - identical output to A1",
  extractPayloadFragments("experience-entry", experienceEntry({
    role: textValue("Software Engineer"),
    organization: textValue("Example Corp"),
    rawHeaderText: "",
  })),
  ["Example Corp", "Software Engineer"]
);
check(
  "A3: only organization populated (role empty) - structured fragment preserved, no fallback added",
  extractPayloadFragments("experience-entry", experienceEntry({
    organization: textValue("Example Corp"),
    rawHeaderText: "Example Corp\nJan 2020 - Present",
  })),
  ["Example Corp"]
);
check(
  "A4: structured header WITH location + dateRangeText - both still expected (renderer's own (role||org) && (location||dateRange) guard is true here)",
  extractPayloadFragments("experience-entry", experienceEntry({
    role: textValue("Software Engineer"),
    organization: textValue("Example Corp"),
    location: textValue("Toronto, ON"),
    dateRangeText: textValue("Jan 2020 - Present"),
    rawHeaderText: "Software Engineer\nExample Corp\nToronto, ON\nJan 2020 - Present",
  })),
  ["Example Corp", "Software Engineer", "Toronto, ON", "Jan 2020 - Present"]
);

// ============================================================
// CASE B - raw-header-only Experience: role, organization, location,
// dateRangeText, and content all empty; rawHeaderText non-empty.
// ============================================================

check(
  "B1: fully raw-header-only entry - rawHeaderText included via fallback helper",
  extractPayloadFragments("experience-entry", experienceEntry({
    rawHeaderText: "Live-in Caregiver, Private Home - Jan 2022 to Present",
  })),
  ["Live-in Caregiver, Private Home - Jan 2022 to Present"]
);
check(
  "B2: raw-header-only entry with multi-line rawHeaderText - each non-empty line is its own fragment",
  extractPayloadFragments("experience-entry", experienceEntry({
    rawHeaderText: "Private Home Caregiver\nToronto, ON\n2019 - 2021",
  })),
  ["Private Home Caregiver", "Toronto, ON", "2019 - 2021"]
);

// ============================================================
// CASE C - fully empty header: no synthetic fragment added.
// ============================================================

check(
  "C1: role, organization, and rawHeaderText all empty - no fragment added",
  extractPayloadFragments("experience-entry", experienceEntry({})),
  []
);
check(
  "C2: rawHeaderText is whitespace-only - treated as empty, no fragment added",
  extractPayloadFragments("experience-entry", experienceEntry({ rawHeaderText: "   \n  " })),
  []
);

// ============================================================
// CASE D - Volunteer: proves the shared extractExperienceEntryFragments
// dispatch (via extractPayloadFragments("volunteer-entry", ...)) covers
// Volunteer entries identically, with no separate Volunteer-only logic.
// ============================================================

check(
  "D1: raw-header-only Volunteer entry - rawHeaderText included via the same fallback",
  extractPayloadFragments("volunteer-entry", experienceEntry({
    rawHeaderText: "Community Food Bank Volunteer, Weekends",
  })),
  ["Community Food Bank Volunteer, Weekends"]
);
check(
  "D2: structured Volunteer entry - unaffected, matches Case A behavior",
  extractPayloadFragments("volunteer-entry", experienceEntry({
    role: textValue("Volunteer Coordinator"),
    organization: textValue("Community Food Bank"),
    rawHeaderText: "Volunteer Coordinator\nCommunity Food Bank",
  })),
  ["Community Food Bank", "Volunteer Coordinator"]
);

// ============================================================
// CASE E - rawHeaderText + bullets/content, role/org empty. Matches
// application fb7a96fa's own entries 1-5 (raw-header-only header, but
// WITH content bullets) - the exact shape the earlier "fragments.length
// === 0" fix still left broken, since bullets alone made the total
// array non-empty and suppressed the rawHeaderText fallback.
// ============================================================

check(
  "E1: rawHeaderText + one bullet, role/org empty - rawHeaderText included exactly once alongside the bullet",
  extractPayloadFragments("experience-entry", experienceEntry({
    rawHeaderText: "Maintenance Technician - ABC Manufacturing",
    content: [bullet("Performed maintenance checks on production equipment.", "c0")],
  })),
  ["Maintenance Technician - ABC Manufacturing", "Performed maintenance checks on production equipment."]
);
check(
  "E2: rawHeaderText + multiple bullets, role/org empty - rawHeaderText appears exactly once, all bullets included",
  extractPayloadFragments("experience-entry", experienceEntry({
    rawHeaderText: "Maintenance Technician - ABC Manufacturing",
    content: [
      bullet("Performed maintenance checks on production equipment.", "c0"),
      bullet("Inspected safety systems weekly.", "c1"),
    ],
  })),
  [
    "Maintenance Technician - ABC Manufacturing",
    "Performed maintenance checks on production equipment.",
    "Inspected safety systems weekly.",
  ]
);
{
  const fragments = extractPayloadFragments("experience-entry", experienceEntry({
    rawHeaderText: "Maintenance Technician - ABC Manufacturing",
    content: [bullet("Performed maintenance checks on production equipment.", "c0")],
  })) as string[];
  const occurrences = fragments.filter((f) => f === "Maintenance Technician - ABC Manufacturing").length;
  check("E3: rawHeaderText fragment appears exactly once (no duplication)", occurrences, 1);
}
check(
  "E4: Volunteer with rawHeaderText + bullets - same coverage as Experience (Case D x Case E)",
  extractPayloadFragments("volunteer-entry", experienceEntry({
    rawHeaderText: "Community Food Bank Volunteer, Weekends",
    content: [bullet("Sorted and packed donated food items.", "c0")],
  })),
  ["Community Food Bank Volunteer, Weekends", "Sorted and packed donated food items."]
);

// ============================================================
// CASE F - rawHeaderText + location/dateRangeText populated, role/org
// EMPTY. The renderer's own "(role || org) && (location || dateRange)"
// guard is false in this branch, so it never renders a separate
// location/date line - only entry.rawHeaderText. The validator must
// NOT expect location/dateRangeText as their own fragments here, or
// it will flag its own over-expectation as "missing text" the moment
// the renderer (correctly) omits a line it was never going to draw.
// ============================================================

check(
  "F1: rawHeaderText + location + dateRangeText, role/org empty - location/dateRangeText NOT expected as separate fragments (renderer suppresses that line entirely in fallback mode)",
  extractPayloadFragments("experience-entry", experienceEntry({
    location: textValue("Toronto, ON"),
    dateRangeText: textValue("2019 - 2021"),
    rawHeaderText: "Private Home Caregiver, Toronto, ON, 2019 - 2021",
  })),
  ["Private Home Caregiver, Toronto, ON, 2019 - 2021"]
);

// ============================================================
// Validator-level proof: the exact renderer output for a raw-header-
// only entry - including one WITH bullets, and one with location/date
// present but suppressed - must no longer be flagged as invented text
// (or missing text) now that expectedBlockFragments() mirrors the
// renderer's header-branch contract exactly.
// ============================================================

{
  const entry = experienceEntry({ rawHeaderText: "Live-in Caregiver, Private Home - Jan 2022 to Present" });
  const rendered = "Live-in Caregiver, Private Home - Jan 2022 to Present";
  const result = validateBlockTextPreservation(fakeBlock("experience-entry", entry), rendered);
  check("validator-1: renderer's rawHeaderText fallback no longer flagged as invented", result.inventedSuspected, false);
  check("validator-1b: no missing fragments", result.missing.length, 0);
}
{
  const entry = experienceEntry({ rawHeaderText: "Live-in Caregiver, Private Home - Jan 2022 to Present" });
  const rendered = "Live-in Caregiver, Private Home - Jan 2022 to Present ZZQQXX-INVENTED-WORD";
  const result = validateBlockTextPreservation(fakeBlock("experience-entry", entry), rendered);
  checkTrue("validator-2: a genuinely invented WORD beyond the rawHeaderText fallback is still caught", result.inventedSuspected);
}
{
  const entry = experienceEntry({ rawHeaderText: "Community Food Bank Volunteer, Weekends" });
  const rendered = "Community Food Bank Volunteer, Weekends";
  const result = validateBlockTextPreservation(fakeBlock("volunteer-entry", entry), rendered);
  check("validator-3: Volunteer raw-header-only fallback no longer flagged as invented", result.inventedSuspected, false);
}
{
  // Matches application fb7a96fa's entries 1-5: rawHeaderText header +
  // real bullets, rendered exactly as ExperienceLikeView draws it
  // (header line, then each bullet).
  const entry = experienceEntry({
    rawHeaderText: "Maintenance Technician - ABC Manufacturing",
    content: [
      bullet("Performed maintenance checks on production equipment.", "c0"),
      bullet("Inspected safety systems weekly.", "c1"),
    ],
  });
  const rendered = "Maintenance Technician - ABC Manufacturing Performed maintenance checks on production equipment. Inspected safety systems weekly.";
  const result = validateBlockTextPreservation(fakeBlock("experience-entry", entry), rendered);
  check("validator-4: rawHeaderText + bullets rendered together no longer flagged as invented (fb7a96fa entries 1-5 shape)", result.inventedSuspected, false);
  check("validator-4b: no missing fragments", result.missing.length, 0);
}
{
  // Matches Case F: renderer omits the location/date line entirely in
  // fallback mode, so the rendered text never contains it separately.
  const entry = experienceEntry({
    location: textValue("Toronto, ON"),
    dateRangeText: textValue("2019 - 2021"),
    rawHeaderText: "Private Home Caregiver, Toronto, ON, 2019 - 2021",
  });
  const rendered = "Private Home Caregiver, Toronto, ON, 2019 - 2021";
  const result = validateBlockTextPreservation(fakeBlock("experience-entry", entry), rendered);
  check("validator-5: rawHeaderText-only render (location/date suppressed by renderer) has no missing fragments", result.missing.length, 0);
  check("validator-5b: not flagged as invented", result.inventedSuspected, false);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
