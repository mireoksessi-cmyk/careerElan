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

  /* ---------------- professionalSummary: added / removed / changed ---------------- */
  {
    const withoutSummary = { ...base, professionalSummary: undefined };
    const added = compareResumeVersions("a", "b", withoutSummary, base);
    check("compare: professionalSummary going from absent to present is 'added'", added.rows.find((r) => r.section === "professionalSummary")?.change, "added");

    const removed = compareResumeVersions("a", "b", base, withoutSummary);
    check("compare: professionalSummary going from present to absent is 'removed'", removed.rows.find((r) => r.section === "professionalSummary")?.change, "removed");

    const edited = { ...base, professionalSummary: { ...base.professionalSummary!, text: "A rewritten summary." } };
    const changed = compareResumeVersions("a", "b", base, edited);
    const summaryDiff = changed.rows.find((r) => r.section === "professionalSummary")!;
    check("compare: professionalSummary text edit is 'changed'", summaryDiff.change, "changed");
    check("compare: professionalSummary 'before' carries the original text", summaryDiff.before, base.professionalSummary!.text);
    check("compare: professionalSummary 'after' carries the new text", summaryDiff.after, "A rewritten summary.");
  }

  /* ---------------- skillGroups: changed when a skill is added ---------------- */
  {
    const withExtraSkill = { ...base, skillGroups: [...base.skillGroups.map((g) => ({ ...g })), { skills: ["Power BI"], source: base.skillGroups[0].source }] };
    const diff = compareResumeVersions("a", "b", base, withExtraSkill);
    check("compare: adding a skill group changes the skillGroups row", diff.rows.find((r) => r.section === "skillGroups")?.change, "changed");
  }

  /* ---------------- credentials: added / removed ---------------- */
  {
    const withoutCredential = { ...base, credentials: base.credentials.slice(1) };
    const diff = compareResumeVersions("a", "b", base, withoutCredential);
    const credRows2 = diff.rows.filter((r) => r.section === "credentials");
    checkTrue("compare: removing a credential produces a 'removed' row", credRows2.some((r) => r.change === "removed"));
    check("compare: removedCount reflects the dropped credential", diff.removedCount, 1);
  }

  /* ---------------- projects: added ---------------- */
  {
    const extraProject = { ...base.projects[0], id: "proj-new-one", name: { ...base.projects[0].name!, value: "New Side Project" } };
    const withExtraProject = { ...base, projects: [...base.projects, extraProject] };
    const diff = compareResumeVersions("a", "b", base, withExtraProject);
    checkTrue("compare: adding a project produces an 'added' row with the right label", diff.rows.some((r) => r.section === "projects" && r.change === "added" && r.label === "New Side Project"));
  }

  /* ---------------- volunteerExperience: removed entirely ---------------- */
  {
    const withoutVolunteer = { ...base, volunteerExperience: [] };
    const diff = compareResumeVersions("a", "b", base, withoutVolunteer);
    checkTrue("compare: removing all volunteer entries produces 'removed' rows for each", diff.rows.filter((r) => r.section === "volunteerExperience").every((r) => r.change === "removed"));
  }

  /* ---------------- entry label falls back to rawHeaderText when no organization ---------------- */
  {
    const noOrgEntry = { ...base.professionalExperience[0], id: "exp-no-org", organization: undefined, rawHeaderText: "Freelance Consultant (2021-2022)" };
    const withNoOrgEntry = { ...base, professionalExperience: [...base.professionalExperience, noOrgEntry] };
    const diff = compareResumeVersions("a", "b", base, withNoOrgEntry);
    checkTrue("compare: an entry with no organization value falls back to rawHeaderText as its label", diff.rows.some((r) => r.label === "Freelance Consultant (2021-2022)"));
  }

  /* ---------------- education: fieldOfStudy-only edit is 'changed' (regression guard for the contentFingerprint fix) ---------------- */
  {
    const mcgill = base.education[0];
    const editedField = { ...base, education: base.education.map((e) => (e.id === mcgill.id ? { ...e, fieldOfStudy: { ...e.fieldOfStudy!, value: "Data Science" } } : e)) };
    const diff = compareResumeVersions("a", "b", base, editedField);
    check("compare: editing ONLY fieldOfStudy (no rawHeaderText/content change) is still 'changed'", diff.rows.find((r) => r.section === "education" && r.label === "McGill University")?.change, "changed");
  }

  /* ---------------- credentials: issuer-only edit is 'changed' ---------------- */
  {
    const cred = base.credentials[0];
    const editedIssuer = { ...base, credentials: base.credentials.map((c) => (c.id === cred.id ? { ...c, issuer: { ...c.issuer!, value: "A Different Issuer" } } : c)) };
    const diff = compareResumeVersions("a", "b", base, editedIssuer);
    checkTrue("compare: editing ONLY the issuer field on a credential is still 'changed'", diff.rows.filter((r) => r.section === "credentials").some((r) => r.change === "changed"));
  }

  /* ---------------- projects: technologies-only edit is 'changed' ---------------- */
  {
    const proj = base.projects[0];
    const editedTech = { ...base, projects: base.projects.map((p) => (p.id === proj.id ? { ...p, technologies: [...p.technologies, { value: "Kubernetes", confidence: 0.9, extractionMethod: "explicit-label" as const, source: p.source }] } : p)) };
    const diff = compareResumeVersions("a", "b", base, editedTech);
    checkTrue("compare: adding a technology to a project's technologies[] is 'changed'", diff.rows.filter((r) => r.section === "projects").some((r) => r.change === "changed"));
  }

  /* ---------------- experience: location-only edit is 'changed' ---------------- */
  {
    const acme = base.professionalExperience[0];
    const editedLocation = { ...base, professionalExperience: base.professionalExperience.map((e) => (e.id === acme.id ? { ...e, location: { ...e.location!, value: "Toronto, ON" } } : e)) };
    const diff = compareResumeVersions("a", "b", base, editedLocation);
    check("compare: editing ONLY location is 'changed'", diff.rows.find((r) => r.section === "professionalExperience" && r.label === "Acme Manufacturing")?.change, "changed");
  }

  /* ---------------- identity: headline change is independent of full name ---------------- */
  {
    const editedHeadline = { ...base, identity: { ...base.identity!, headline: { ...base.identity!.headline!, value: "VP of Supply Chain" } } };
    const diff = compareResumeVersions("a", "b", base, editedHeadline);
    check("compare: editing headline is 'changed'", diff.rows.find((r) => r.label === "Headline")?.change, "changed");
    check("compare: full name row stays unchanged when only headline is edited", diff.rows.find((r) => r.label === "Full name")?.change, "unchanged");
  }

  /* ---------------- skillGroups: removing all skill groups is 'changed' (not 'removed' - skillGroups is a single summary row) ---------------- */
  {
    const noSkills = { ...base, skillGroups: [] };
    const diff = compareResumeVersions("a", "b", base, noSkills);
    check("compare: removing all skill groups shows the skillGroups row as 'changed'", diff.rows.find((r) => r.section === "skillGroups")?.change, "changed");
  }

  /* ---------------- multiple simultaneous section changes are all captured together in one diff ---------------- */
  {
    const acme = base.professionalExperience[0];
    const multiChange = {
      ...base,
      identity: { ...base.identity!, fullName: { ...base.identity!.fullName!, value: "Jordan A. Lee" } },
      professionalExperience: base.professionalExperience.map((e) => (e.id === acme.id ? { ...e, role: { ...e.role!, value: "Head of Operations" } } : e)),
      credentials: base.credentials.slice(1),
    };
    const diff = compareResumeVersions("a", "b", base, multiChange);
    check("compare: identity full name change detected alongside other section changes", diff.rows.find((r) => r.label === "Full name")?.change, "changed");
    checkTrue("compare: professionalExperience change detected alongside other section changes", diff.rows.some((r) => r.section === "professionalExperience" && r.change === "changed"));
    check("compare: credentials removal detected alongside other section changes", diff.removedCount, 1);
  }

  /* ---------------- VersionDiffRow.section values are always one of the documented literals ---------------- */
  {
    const validSections = new Set(["identity", "professionalSummary", "skillGroups", "professionalExperience", "volunteerExperience", "education", "projects", "credentials"]);
    const diff = compareResumeVersions("a", "b", base, incoming);
    checkTrue("shape: every row's section is one of the documented VersionDiffRow.section literals", diff.rows.every((r) => validSections.has(r.section)));
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
