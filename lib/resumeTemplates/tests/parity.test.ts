/*
  Phase 6F - Parity engine test category (spec section 19, item 18/22 -
  "textFragments.ts/validateOutput.ts in isolation, hand-constructed
  NormalizedResume + extracted-text strings"). Run with:
    npx tsx lib/resumeTemplates/tests/parity.test.ts
*/
import { expectedFragmentsForResume } from "../parity/textFragments";
import { buildValidationReport, checkSectionOrderPreserved, findMissingFragments, normalizeForMatch } from "../parity/validateOutput";
import type { NormalizedResume } from "../shared/contentAdapters";

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

function minimalResume(overrides: Partial<NormalizedResume> = {}): NormalizedResume {
  return {
    schemaVersion: "test-1",
    identity: { fullName: "Alex Rivera", headline: "Operations Lead", email: "alex@example.com", phone: "555-0100", location: "Toronto, ON", linkedin: "", portfolio: "", otherContactLines: [] },
    summary: "Experienced operations lead with a background in logistics.",
    skillGroups: [],
    professionalExperience: [],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    customSections: [],
    metricGrids: [],
    ...overrides,
  };
}

function main() {
  /* --- textFragments.ts: expectedFragmentsForResume --- */
  const minimal = minimalResume();
  const minimalFragments = expectedFragmentsForResume(minimal);
  checkTrue("expectedFragmentsForResume: includes fullName", minimalFragments.includes("Alex Rivera"));
  checkTrue("expectedFragmentsForResume: includes email", minimalFragments.includes("alex@example.com"));
  checkTrue("expectedFragmentsForResume: includes summary", minimalFragments.includes("Experienced operations lead with a background in logistics."));
  checkTrue("expectedFragmentsForResume: excludes empty linkedin (blank fields never become fragments)", !minimalFragments.includes(""));

  const withExperience = minimalResume({
    professionalExperience: [
      {
        id: "exp-1",
        organization: "Northwind Logistics",
        role: "Operations Manager",
        location: "Toronto, ON",
        dateRangeText: "2019 - Present",
        items: [
          { id: "b1", kind: "bullet", text: "Reduced shipping delays by 30%.", depth: 0, children: [] },
          { id: "b2", kind: "subheading", text: "Fleet Modernization", depth: 0, children: [{ id: "b2a", kind: "bullet", text: "Migrated 40 vehicles to telematics tracking.", depth: 1, children: [] }] },
        ],
        hasHierarchy: true,
        isVolunteer: false,
        rawHeaderText: "Operations Manager - Northwind Logistics - 2019 - Present",
      },
    ],
  });
  const expFragments = expectedFragmentsForResume(withExperience);
  checkTrue("expectedFragmentsForResume: includes organization", expFragments.includes("Northwind Logistics"));
  checkTrue("expectedFragmentsForResume: includes top-level bullet text", expFragments.includes("Reduced shipping delays by 30%."));
  checkTrue("expectedFragmentsForResume: includes a nested child's text (flattenContentItems recurses)", expFragments.includes("Migrated 40 vehicles to telematics tracking."));
  checkTrue("expectedFragmentsForResume: includes the subheading label itself, not just its children", expFragments.includes("Fleet Modernization"));

  const withEducation = minimalResume({
    education: [
      { id: "edu-1", institution: "", credential: "", fieldOfStudy: "", location: "", institutions: ["Central College"], credentials: ["Bachelor of Arts"], fieldsOfStudy: ["History", "Political Science"], dateRangeText: "2010 - 2014", gpa: "", honors: ["Dean's List"], details: [], rawHeaderText: "" },
    ],
  });
  const eduFragments = expectedFragmentsForResume(withEducation);
  check("expectedFragmentsForResume: multi-value institutions[] contributes 1 fragment", eduFragments.filter((f) => f === "Central College").length, 1);
  checkTrue("expectedFragmentsForResume: both fieldsOfStudy entries present as separate fragments", eduFragments.includes("History") && eduFragments.includes("Political Science"));
  checkTrue("expectedFragmentsForResume: honors entries present", eduFragments.includes("Dean's List"));
  checkTrue("expectedFragmentsForResume: empty gpa never becomes a fragment", !eduFragments.includes(""));

  const withGrid = minimalResume({ metricGrids: [{ id: "g1", columns: 2, entries: [{ id: "m1", value: "12+", label: "Years Experience" }, { id: "m2", value: "3", label: "Teams Led" }] }] });
  const gridFragments = expectedFragmentsForResume(withGrid);
  checkTrue("expectedFragmentsForResume: metric grid value present", gridFragments.includes("12+"));
  checkTrue("expectedFragmentsForResume: metric grid label present", gridFragments.includes("Years Experience"));

  /* --- validateOutput.ts: normalizeForMatch --- */
  check("normalizeForMatch: collapses internal whitespace and lowercases", normalizeForMatch("  Foo   BAR\nBaz  "), "foo bar baz");

  /* --- validateOutput.ts: findMissingFragments --- */
  const noneMissing = findMissingFragments(["Alex Rivera", "Toronto, ON"], "Header: Alex Rivera lives in Toronto, ON and works in logistics.");
  check("findMissingFragments: both fragments present -> empty array", noneMissing, []);

  const someMissing = findMissingFragments(["Alex Rivera", "A Fragment That Is Not There"], "Header: Alex Rivera works in logistics.");
  check("findMissingFragments: reports exactly the one truly-absent fragment", someMissing, ["A Fragment That Is Not There"]);

  const blankFragmentIgnored = findMissingFragments(["", "  ", "Alex Rivera"], "Alex Rivera");
  check("findMissingFragments: blank/whitespace-only fragments are never reported missing", blankFragmentIgnored, []);

  const whitespaceFallback = findMissingFragments(["한국어 (초급)"], "한국어(초급)");
  check("findMissingFragments: whitespace-stripped fallback absorbs a dropped space at a CJK/Latin boundary", whitespaceFallback, []);

  const genuinelyMissing = findMissingFragments(["Completely Different Words Entirely"], "Alex Rivera works in logistics.");
  check("findMissingFragments: a fragment with genuinely different words still fails (fallback doesn't mask real loss)", genuinelyMissing, ["Completely Different Words Entirely"]);

  /* --- validateOutput.ts: checkSectionOrderPreserved --- */
  checkTrue("checkSectionOrderPreserved: headings appearing in the same order -> true", checkSectionOrderPreserved(["Summary", "Experience", "Education"], "Summary here. Experience here. Education here."));
  check("checkSectionOrderPreserved: headings appearing out of order -> false", checkSectionOrderPreserved(["Experience", "Summary"], "Summary here. Experience here."), false);
  checkTrue("checkSectionOrderPreserved: empty heading list trivially passes", checkSectionOrderPreserved([], "anything at all"));
  check("checkSectionOrderPreserved: a heading absent entirely -> false", checkSectionOrderPreserved(["Summary", "Nonexistent Section"], "Summary here."), false);

  /* --- validateOutput.ts: buildValidationReport --- */
  const passingReport = buildValidationReport({
    expectedFragments: ["Alex Rivera", "Summary", "Experience"],
    extractedText: "Alex Rivera. Summary: text. Experience: text.",
    sectionHeadingsInOrder: ["Summary", "Experience"],
    identityFragments: ["Alex Rivera"],
    structuralPassed: true,
    structuralIssues: [],
  });
  checkTrue("buildValidationReport: all-satisfied case -> passed=true", passingReport.passed);
  check("buildValidationReport: all-satisfied case -> missingTextCount=0", passingReport.missingTextCount, 0);
  check("buildValidationReport: inventedTextCount is always 0 by construction (spec-documented asymmetry)", passingReport.inventedTextCount, 0);
  checkTrue("buildValidationReport: all-satisfied case -> sectionOrderPreserved=true", passingReport.sectionOrderPreserved);
  checkTrue("buildValidationReport: all-satisfied case -> protectedFactsUnchanged=true", passingReport.protectedFactsUnchanged);
  check("buildValidationReport: all-satisfied case -> issues is empty", passingReport.issues, []);

  const missingTextReport = buildValidationReport({
    expectedFragments: ["Alex Rivera", "A Fragment Never Rendered"],
    extractedText: "Alex Rivera.",
    sectionHeadingsInOrder: [],
    identityFragments: ["Alex Rivera"],
    structuralPassed: true,
    structuralIssues: [],
  });
  check("buildValidationReport: one missing fragment -> passed=false", missingTextReport.passed, false);
  check("buildValidationReport: one missing fragment -> missingTextCount=1", missingTextReport.missingTextCount, 1);
  checkTrue("buildValidationReport: missing-text issue is present with code 'missing-text'", missingTextReport.issues.some((i) => i.code === "missing-text"));

  const orderViolationReport = buildValidationReport({
    expectedFragments: [],
    extractedText: "Experience here. Summary here.",
    sectionHeadingsInOrder: ["Summary", "Experience"],
    identityFragments: [],
    structuralPassed: true,
    structuralIssues: [],
  });
  check("buildValidationReport: section order violated -> passed=false", orderViolationReport.passed, false);
  checkTrue("buildValidationReport: section-order-violation issue is present", orderViolationReport.issues.some((i) => i.code === "section-order-violation"));

  const protectedFactsReport = buildValidationReport({
    expectedFragments: [],
    extractedText: "Someone Else entirely.",
    sectionHeadingsInOrder: [],
    identityFragments: ["Alex Rivera"],
    structuralPassed: true,
    structuralIssues: [],
  });
  check("buildValidationReport: identity fragment missing -> passed=false", protectedFactsReport.passed, false);
  checkTrue("buildValidationReport: protected-facts-missing issue is present", protectedFactsReport.issues.some((i) => i.code === "protected-facts-missing"));

  const structuralFailureReport = buildValidationReport({
    expectedFragments: ["Alex Rivera"],
    extractedText: "Alex Rivera.",
    sectionHeadingsInOrder: [],
    identityFragments: ["Alex Rivera"],
    structuralPassed: false,
    structuralIssues: [{ code: "structural-check", message: "example structural failure" }],
  });
  check("buildValidationReport: structuralPassed=false alone fails the whole report even with all text present", structuralFailureReport.passed, false);
  checkTrue("buildValidationReport: structural issue is carried through into issues[]", structuralFailureReport.issues.some((i) => i.code === "structural-check"));

  /* --- validateOutput.ts: independentOrderedSequences (page-split two-column templates) --- */
  const interleavedButValidText = "Main-Heading-A page1 content. Sidebar-Heading-A page1 content. Main-Heading-B page2 content. Sidebar-Heading-B page2 content.";
  const singleStreamWouldFail = checkSectionOrderPreserved(["Main-Heading-A", "Main-Heading-B", "Sidebar-Heading-A", "Sidebar-Heading-B"], interleavedButValidText);
  check("checkSectionOrderPreserved: a single flat main-then-sidebar assertion incorrectly fails on legitimately-interleaved paginated text (motivates independentOrderedSequences)", singleStreamWouldFail, false);

  const independentReport = buildValidationReport({
    expectedFragments: [],
    extractedText: interleavedButValidText,
    sectionHeadingsInOrder: ["Main-Heading-A", "Main-Heading-B", "Sidebar-Heading-A", "Sidebar-Heading-B"],
    identityFragments: [],
    structuralPassed: true,
    structuralIssues: [],
    independentOrderedSequences: [
      ["Main-Heading-A", "Main-Heading-B"],
      ["Sidebar-Heading-A", "Sidebar-Heading-B"],
    ],
  });
  checkTrue("buildValidationReport: independentOrderedSequences passes when each stream's OWN order is preserved, despite cross-stream interleaving", independentReport.sectionOrderPreserved);
  checkTrue("buildValidationReport: independentOrderedSequences -> overall passed=true", independentReport.passed);

  const independentReportBroken = buildValidationReport({
    expectedFragments: [],
    extractedText: "Main-Heading-B before. Main-Heading-A after.",
    sectionHeadingsInOrder: ["Main-Heading-A", "Main-Heading-B"],
    identityFragments: [],
    structuralPassed: true,
    structuralIssues: [],
    independentOrderedSequences: [["Main-Heading-A", "Main-Heading-B"]],
  });
  check("buildValidationReport: independentOrderedSequences still catches a genuine within-stream order violation", independentReportBroken.sectionOrderPreserved, false);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
