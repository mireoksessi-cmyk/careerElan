/*
  Phase 6E - "Version Compare" test category. Run with
  `npx tsx lib/canonicalCareerUi/versionCompare.test.ts`.
*/
import { compareResumeVersions } from "./versionCompare";
import { buildBaseResume, buildIncomingVariant } from "./testSupport/resumeVariants";

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
  const base = buildBaseResume();
  const incoming = buildIncomingVariant();
  const summary = compareResumeVersions("v-base", "v-incoming", base, incoming);

  check("compare: fromVersionId is preserved", summary.fromVersionId, "v-base");
  check("compare: toVersionId is preserved", summary.toVersionId, "v-incoming");

  const expRows = summary.rows.filter((r) => r.section === "professionalExperience");
  checkTrue("compare: professionalExperience has exactly 4 rows (acme/beta/gamma/acme-conflict)", expRows.length === 4);
  /* "Acme Manufacturing" appears on 2 rows (exp-acme-ops itself, changed; and the
     new exp-acme-ops-conflict entry, added) - both share the label because they
     share the organization, which is exactly the shape a real conflict looks
     like. Assert by count-per-change-kind rather than a label->row map, which
     would silently collide the two. */
  const acmeRows = expRows.filter((r) => r.label === "Acme Manufacturing");
  check("compare: 'Acme Manufacturing' appears on exactly 2 rows (the edited entry + the new conflicting one)", acmeRows.length, 2);
  checkTrue("compare: one 'Acme Manufacturing' row is 'changed' (exp-acme-ops's edited bullet)", acmeRows.some((r) => r.change === "changed"));
  checkTrue("compare: one 'Acme Manufacturing' row is 'added' (the new exp-acme-ops-conflict entry)", acmeRows.some((r) => r.change === "added"));
  checkTrue("compare: exp-beta-analyst (Beta Logistics) is 'removed'", expRows.some((r) => r.label === "Beta Logistics" && r.change === "removed"));
  checkTrue("compare: exp-gamma-new (Gamma Freight) is 'added'", expRows.some((r) => r.label === "Gamma Freight" && r.change === "added"));

  const volRows = summary.rows.filter((r) => r.section === "volunteerExperience");
  checkTrue("compare: volunteer entry (Montréal Food Bank) is unchanged", volRows.every((r) => r.change === "unchanged"));

  const eduRows = summary.rows.filter((r) => r.section === "education");
  const mcgillRows = eduRows.filter((r) => r.label === "McGill University");
  check("compare: 'McGill University' appears on exactly 2 rows (the untouched entry + the new conflicting one)", mcgillRows.length, 2);
  checkTrue("compare: one 'McGill University' row is 'unchanged' (edu-mcgill itself)", mcgillRows.some((r) => r.change === "unchanged"));
  checkTrue("compare: one 'McGill University' row is 'added' (the new edu-mcgill-conflict entry)", mcgillRows.some((r) => r.change === "added"));

  const projRows = summary.rows.filter((r) => r.section === "projects");
  checkTrue("compare: projects entry (proj-erp) is unchanged", projRows.every((r) => r.change === "unchanged"));

  const credRows = summary.rows.filter((r) => r.section === "credentials");
  checkTrue("compare: credentials entries are unchanged", credRows.every((r) => r.change === "unchanged"));

  check("compare: addedCount matches (gamma + acme-conflict + mcgill-conflict)", summary.addedCount, 3);
  check("compare: removedCount matches (beta)", summary.removedCount, 1);
  check("compare: changedCount matches (acme bullet edit)", summary.changedCount, 1);

  const identityRow = summary.rows.find((r) => r.section === "identity" && r.label === "Full name");
  check("compare: identity full name unchanged (not mutated by the variant)", identityRow?.change, "unchanged");

  const summaryRow = summary.rows.find((r) => r.section === "professionalSummary");
  check("compare: professional summary unchanged", summaryRow?.change, "unchanged");

  const skillsRow = summary.rows.find((r) => r.section === "skillGroups");
  check("compare: skill groups unchanged", skillsRow?.change, "unchanged");

  const identical = compareResumeVersions("v1", "v1", base, base);
  check("compare: comparing a resume against itself has 0 added", identical.addedCount, 0);
  check("compare: comparing a resume against itself has 0 removed", identical.removedCount, 0);
  check("compare: comparing a resume against itself has 0 changed", identical.changedCount, 0);
  checkTrue("compare: comparing a resume against itself - every row is unchanged", identical.rows.every((r) => r.change === "unchanged"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
