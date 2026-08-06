/*
  Phase 6F - Content Adapter test category (spec section 19, items
  6/17/18/20/21/22/23/25/26). Uses the existing, hand-authored
  lib/careerMemory/persistence/testFixtures.ts buildFixtureResume() and
  this round's own Jordan Ellis fixture for cross-checking. Run with:
    npx tsx lib/resumeTemplates/tests/contentAdapters.test.ts
*/
import { normalizeContentItems, normalizeResume, textValue, textValues } from "../shared/contentAdapters";
import { buildFixtureResume } from "../../careerMemory/persistence/testFixtures";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";

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

function main() {
  check("textValue: undefined -> empty string", textValue(undefined), "");
  check("textValue: null -> empty string", textValue(null), "");
  check("textValue: populated -> its value", textValue({ value: "x", confidence: 1, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } }), "x");
  check("textValues: undefined -> empty array", textValues(undefined), []);
  check("textValues: filters out empty-value entries", textValues([{ value: "", confidence: 1, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } }, { value: "a", confidence: 1, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } }]), ["a"]);

  const fixture = buildFixtureResume();
  const normalized = normalizeResume(fixture);

  check("normalizeResume: identity.fullName matches source", normalized.identity.fullName, fixture.identity?.fullName?.value);
  check("normalizeResume: identity.email matches source", normalized.identity.email, fixture.identity?.email?.value);
  check("normalizeResume: identity.otherContactLines length matches source", normalized.identity.otherContactLines.length, fixture.identity?.otherContactLines.length);
  check("normalizeResume: summary matches source text", normalized.summary, fixture.professionalSummary?.text);
  check("normalizeResume: skillGroups length matches", normalized.skillGroups.length, fixture.skillGroups.length);
  check("normalizeResume: first skillGroup skills match", normalized.skillGroups[0].skills, fixture.skillGroups[0].skills);
  check("normalizeResume: professionalExperience length matches", normalized.professionalExperience.length, fixture.professionalExperience.length);
  check("normalizeResume: volunteerExperience length matches", normalized.volunteerExperience.length, fixture.volunteerExperience.length);
  check("normalizeResume: education length matches", normalized.education.length, fixture.education.length);
  check("normalizeResume: credentials length matches", normalized.credentials.length, fixture.credentials.length);
  check("normalizeResume: projects length matches", normalized.projects.length, fixture.projects.length);
  check("normalizeResume: awards length matches", normalized.awards.length, fixture.awards.length);
  check("normalizeResume: publications length matches", normalized.publications.length, fixture.publications.length);
  check("normalizeResume: customSections length matches", normalized.customSections.length, fixture.customSections.length);
  check("normalizeResume: metricGrids length matches", normalized.metricGrids.length, fixture.metricGrids.length);

  const firstExp = normalized.professionalExperience[0];
  const sourceFirstExp = fixture.professionalExperience[0];
  check("experience[0]: organization matches", firstExp.organization, sourceFirstExp.organization?.value);
  check("experience[0]: role matches", firstExp.role, sourceFirstExp.role?.value);
  check("experience[0]: dateRangeText matches", firstExp.dateRangeText, sourceFirstExp.dateRangeText?.value);
  check("experience[0]: hasHierarchy matches hasHierarchicalStructure", firstExp.hasHierarchy, sourceFirstExp.hasHierarchicalStructure);
  checkTrue("experience[0] (fixture's hierarchical entry): hasHierarchy is true", firstExp.hasHierarchy);
  checkTrue("experience[0]: items is non-empty", firstExp.items.length > 0);

  const secondExp = normalized.professionalExperience[1];
  const sourceSecondExp = fixture.professionalExperience[1];
  check("experience[1] (flat entry): hasHierarchy is false", secondExp.hasHierarchy, false);
  check("experience[1]: items length matches flat content[] length", secondExp.items.length, sourceSecondExp.content.length);
  checkTrue("experience[1]: every item has depth 0 (flat fallback)", secondExp.items.every((i) => i.depth === 0));

  const edu = normalized.education[0];
  const sourceEdu = fixture.education[0];
  check("education[0]: institutions matches", edu.institutions, textValues(sourceEdu.institutions));
  check("education[0]: credentials (multi) matches", edu.credentials, textValues(sourceEdu.credentials));
  checkTrue("education[0] (fixture's double-credential entry): credentials has 2 items", edu.credentials.length === 2);

  const cred = normalized.credentials[0];
  check("credentials[0]: kind matches", cred.kind, fixture.credentials[0].kind);

  const grid = normalized.metricGrids[0];
  check("metricGrids[0]: columns matches", grid.columns, fixture.metricGrids[0].columns);
  check("metricGrids[0]: entries length matches", grid.entries.length, fixture.metricGrids[0].entries.length);
  check("metricGrids[0]: first entry value matches", grid.entries[0].value, fixture.metricGrids[0].entries[0].value.value);
  check("metricGrids[0]: first entry label matches", grid.entries[0].label, fixture.metricGrids[0].entries[0].label.value);

  const custom = normalized.customSections[0];
  check("customSections[0]: heading prefers displayHeading", custom.heading, fixture.customSections[0].displayHeading);

  /* --- normalizeContentItems: hierarchical vs flat fallback, isolated --- */
  const flatBlocks = fixture.professionalExperience[1].content;
  const flatNormalized = normalizeContentItems(flatBlocks, [], false);
  check("normalizeContentItems: flat path produces same length as content[]", flatNormalized.length, flatBlocks.length);
  checkTrue("normalizeContentItems: flat path never invents children", flatNormalized.every((i) => i.children.length === 0));

  const hierBlocks = fixture.professionalExperience[0].hierarchicalContent;
  const hierNormalized = normalizeContentItems([], hierBlocks, true);
  check("normalizeContentItems: hierarchical path produces same top-level length as hierarchicalContent", hierNormalized.length, hierBlocks.length);
  checkTrue("normalizeContentItems: hierarchical path preserves at least one child under the first node", hierNormalized[0].children.length > 0);

  const emptyHierFallback = normalizeContentItems(flatBlocks, [], true);
  check("normalizeContentItems: hasHierarchicalStructure=true but hierarchicalContent=[] falls back to flat content[] (documented safe default)", emptyHierFallback.length, flatBlocks.length);

  /* --- Jordan Ellis fixture: cross-check every spec-13 checklist item is actually present after normalization --- */
  const jordan = normalizeResume(buildJordanEllisResume());
  checkTrue("Jordan Ellis: identity.fullName is 'Jordan Ellis'", jordan.identity.fullName === "Jordan Ellis");
  checkTrue("Jordan Ellis: has 3 professionalExperience entries", jordan.professionalExperience.length === 3);
  checkTrue("Jordan Ellis: first experience entry is hierarchical", jordan.professionalExperience[0].hasHierarchy);
  checkTrue("Jordan Ellis: has 1 volunteerExperience entry", jordan.volunteerExperience.length === 1);
  checkTrue("Jordan Ellis: education has a double-major shape (2 fieldsOfStudy, 1 credential)", jordan.education[0].fieldsOfStudy.length === 2 && jordan.education[0].credentials.length === 1);
  checkTrue("Jordan Ellis: has exactly 2 credentials", jordan.credentials.length === 2);
  checkTrue("Jordan Ellis: has exactly 1 project", jordan.projects.length === 1);
  checkTrue("Jordan Ellis: has exactly 1 award", jordan.awards.length === 1);
  checkTrue("Jordan Ellis: has exactly 1 publication", jordan.publications.length === 1);
  checkTrue("Jordan Ellis: has 2+ skillGroups", jordan.skillGroups.length >= 2);
  checkTrue("Jordan Ellis: has a language-proficiency custom section", jordan.customSections.some((s) => /language/i.test(s.heading)));
  checkTrue("Jordan Ellis: has a second, non-language custom section", jordan.customSections.some((s) => !/language/i.test(s.heading)));
  checkTrue("Jordan Ellis: metric grid has exactly 4 entries", jordan.metricGrids[0].entries.length === 4);
  checkTrue("Jordan Ellis: contains accented French text somewhere in summary", /Qu[ée]bec/i.test(jordan.summary));
  checkTrue("Jordan Ellis: contains Korean text in the language custom section", jordan.customSections.some((s) => /[가-힣]/.test(JSON.stringify(s.items))));
  checkTrue("Jordan Ellis: mixed bullet/paragraph content present in exp-meridian-director", jordan.professionalExperience[1].items.some((i) => i.kind === "paragraph") && jordan.professionalExperience[1].items.some((i) => i.kind === "bullet"));
  checkTrue("Jordan Ellis: contains a long URL somewhere in the custom sections", jordan.customSections.some((s) => JSON.stringify(s.items).includes("https://")));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
