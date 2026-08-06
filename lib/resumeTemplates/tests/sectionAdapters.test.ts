/*
  Phase 6F - Section Policy/Visibility test category (spec section 19,
  item 6). Run with:
    npx tsx lib/resumeTemplates/tests/sectionAdapters.test.ts
*/
import { computeSectionVisibility, sectionHasContent, visibleSectionKeys, type SectionKey } from "../shared/sectionAdapters";
import { normalizeResume } from "../shared/contentAdapters";
import { buildFixtureResume } from "../../careerMemory/persistence/testFixtures";

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
  const normalized = normalizeResume(buildFixtureResume());

  checkTrue("sectionHasContent: identity is true for a populated fixture", sectionHasContent(normalized, "identity"));
  checkTrue("sectionHasContent: summary is true", sectionHasContent(normalized, "summary"));
  checkTrue("sectionHasContent: metricHighlights is true", sectionHasContent(normalized, "metricHighlights"));
  checkTrue("sectionHasContent: skills is true", sectionHasContent(normalized, "skills"));
  checkTrue("sectionHasContent: experience is true", sectionHasContent(normalized, "experience"));
  checkTrue("sectionHasContent: volunteer is true", sectionHasContent(normalized, "volunteer"));
  checkTrue("sectionHasContent: education is true", sectionHasContent(normalized, "education"));
  checkTrue("sectionHasContent: credentials is true", sectionHasContent(normalized, "credentials"));
  checkTrue("sectionHasContent: projects is true", sectionHasContent(normalized, "projects"));
  checkTrue("sectionHasContent: awards is true", sectionHasContent(normalized, "awards"));
  checkTrue("sectionHasContent: publications is true", sectionHasContent(normalized, "publications"));
  checkTrue("sectionHasContent: custom is true", sectionHasContent(normalized, "custom"));
  checkTrue("sectionHasContent: additional (alias of custom) is true", sectionHasContent(normalized, "additional"));

  const empty = normalizeResume({ ...buildFixtureResume(), awards: [], publications: [], projects: [] });
  check("sectionHasContent: awards is false when array is empty", sectionHasContent(empty, "awards"), false);
  check("sectionHasContent: publications is false when array is empty", sectionHasContent(empty, "publications"), false);
  check("sectionHasContent: projects is false when array is empty", sectionHasContent(empty, "projects"), false);

  const order: SectionKey[] = ["identity", "summary", "experience", "awards", "education"];
  const decisions = computeSectionVisibility(order, normalized);
  check("computeSectionVisibility: returns one decision per input key", decisions.length, order.length);
  checkTrue("computeSectionVisibility: identity decision has reason 'has-content'", decisions[0].reason === "has-content");

  const emptyOrderResult = computeSectionVisibility(["awards"], empty);
  check("computeSectionVisibility: empty awards -> reason 'empty'", emptyOrderResult[0].reason, "empty");
  check("computeSectionVisibility: empty awards -> visible false (no override)", emptyOrderResult[0].visible, false);

  const overridden = computeSectionVisibility(["awards"], empty, { awards: true });
  check("computeSectionVisibility: override forces visible=true even when empty", overridden[0].visible, true);
  check("computeSectionVisibility: override does not change the underlying 'empty' reason", overridden[0].reason, "empty");

  const forcedHidden = computeSectionVisibility(["experience"], normalized, { experience: false });
  check("computeSectionVisibility: override can force-hide a non-empty section", forcedHidden[0].visible, false);

  const visible = visibleSectionKeys(order, normalized);
  check("visibleSectionKeys: all 5 sections visible for the populated fixture", visible.length, 5);

  const visibleWithEmpty = visibleSectionKeys(["identity", "awards"], empty);
  check("visibleSectionKeys: filters out the empty section", visibleWithEmpty, ["identity"]);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
