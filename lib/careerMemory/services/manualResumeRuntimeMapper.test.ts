/*
  Mapper-parity gate for the direct-authored Career Memory -> Canonical
  Runtime bridge. Run with
  `npx tsx lib/careerMemory/services/manualResumeRuntimeMapper.test.ts`.

  buildManualCanonicalRuntime is a pure function: this file constructs its
  input as a plain object and asserts on the returned runtime, so there is
  no Supabase client, no scenario, and no career_resume_versions row
  anywhere below - which is itself the property the versionless bridge
  depends on, asserted explicitly in D.
*/
import { buildManualCanonicalRuntime, MANUAL_ENTRY_SOURCE_SECTION_ID, type ManualCareerMemoryInput } from "./manualResumeRuntimeMapper";

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

/* One populated input reused across A/B/E so the assertions describe the
   same resume rather than drifting fixtures. */
const POPULATED: ManualCareerMemoryInput = {
  firstName: "Alex",
  lastName: "Rivera",
  email: "alex.rivera@example.com",
  phone: "+1 555 0100",
  location: "Toronto, ON",
  linkedin: "linkedin.com/in/example",
  headline: "Operations Lead",
  summary: "Operations lead focused on throughput and cost recovery.",
  skills: ["Inventory control", "Vendor management"],
  experience: [{ company: "Example Logistics", jobTitle: "Operations Lead", location: "Toronto, ON", startDate: "2021", isCurrent: true, description: "Ran the regional dispatch desk." }],
  volunteerExperience: [{ organization: "Example Food Bank", role: "Coordinator", startDate: "2020", endDate: "2021" }],
  education: [{ school: "Example College", program: "Business Administration", startDate: "2016", endDate: "2020" }],
  certifications: [{ name: "Lean Six Sigma Green Belt", issuer: "Example Institute", date: "2022" }],
  projects: [{ name: "Depot Rebalancing", role: "Lead", dates: "2023", description: "Rebalanced stock across four depots." }],
  languages: [
    { language: "English", level: "Native or Bilingual" },
    { language: "Français", level: "Professional Working" },
  ],
};

function main() {
  /* --- A: two typed languages survive into the runtime, paired --- */
  const populated = buildManualCanonicalRuntime(POPULATED);
  check(
    "A languages reach runtime.resume.languages as name/proficiency pairs",
    populated.resume.languages.map((l) => [l.name, l.proficiency]),
    [["English", "Native or Bilingual"], ["Français", "Professional Working"]]
  );
  checkTrue(
    "A every mapped language carries the manual-entry sentinel trace",
    populated.resume.languages.every((l) => l.source.sourceSectionId === MANUAL_ENTRY_SOURCE_SECTION_ID)
  );

  /* --- B: the fields that already mapped still map identically --- */
  check("B identity full name preserved", populated.resume.identity?.fullName?.value, "Alex Rivera");
  check("B identity email preserved", populated.resume.identity?.email?.value, "alex.rivera@example.com");
  check("B summary preserved", populated.resume.professionalSummary?.text, "Operations lead focused on throughput and cost recovery.");
  check("B skills preserved", populated.resume.skillGroups[0]?.skills, ["Inventory control", "Vendor management"]);
  check("B experience count preserved", populated.resume.professionalExperience.length, 1);
  check("B experience organization preserved", populated.resume.professionalExperience[0]?.organization?.value, "Example Logistics");
  check("B education count preserved", populated.resume.education.length, 1);
  /* Volunteer rows name their fields organization/role, not company/jobTitle,
     and a volunteer post described only by those two is ordinary - it must
     survive the emptiness gate and keep both values. */
  check("B volunteer entry with no description survives", populated.resume.volunteerExperience.length, 1);
  check(
    "B volunteer organization and role both preserved",
    [populated.resume.volunteerExperience[0]?.organization?.value, populated.resume.volunteerExperience[0]?.role?.value],
    ["Example Food Bank", "Coordinator"]
  );
  checkTrue("B volunteer entry is flagged as volunteer", populated.resume.volunteerExperience[0]?.isVolunteer === true);
  check("B credential count preserved", populated.resume.credentials.length, 1);
  check("B project count preserved", populated.resume.projects.length, 1);
  check("B schemaVersion preserved", populated.resume.schemaVersion, populated.metadata.schemaVersion);

  /* --- C: absent languages stay absent, and a blank row is not content ---
     A level with no language names nothing, so it must not become an entry. */
  const noLanguages = buildManualCanonicalRuntime({ ...POPULATED, languages: [] });
  check("C empty languages array yields no entries", noLanguages.resume.languages, []);
  check("C no Languages section is invented when there are no languages", noLanguages.resume.customSections, []);
  check("C the slot stays closed when no section exists", noLanguages.resume.slotAvailability.additional_information, false);
  const omitted = buildManualCanonicalRuntime({ ...POPULATED, languages: undefined });
  check("C omitted languages yields no entries", omitted.resume.languages, []);
  const blanks = buildManualCanonicalRuntime({ ...POPULATED, languages: [{ language: "   ", level: "Fluent" }, { language: "", level: "" }] });
  check("C blank-language rows are dropped, never synthesised", blanks.resume.languages, []);
  const bareName = buildManualCanonicalRuntime({ ...POPULATED, languages: [{ language: "Korean", level: "  " }] });
  check(
    "C a language with no level maps to an absent proficiency, not an empty string",
    bareName.resume.languages.map((l) => [l.name, l.proficiency]),
    [["Korean", undefined]]
  );

  /* --- A2: the same real Languages field is also carried as a custom section,
     because Professional ATS and Executive Minimal cannot reach
     model.languages on their own. Both views must describe one answer. --- */
  check("A2 a manual Languages source section exists when languages do", populated.resume.customSections.map((s) => s.originalHeading), ["Languages"]);
  check(
    "A2 the section's lines are the same pairs, in the same order",
    populated.resume.customSections[0]?.content.map((c) => c.text),
    ["English — Native or Bilingual", "Français — Professional Working"]
  );
  checkTrue(
    "A2 the section carries manual provenance, never a fabricated sourceBlockId",
    populated.resume.customSections[0]?.source.sourceSectionId === MANUAL_ENTRY_SOURCE_SECTION_ID &&
      populated.resume.customSections[0]?.source.sourceBlockIds.length === 0
  );
  checkTrue("A2 model.languages is kept alongside the section", populated.resume.languages.length === 2);
  check("A2 the additional_information slot opens only because that section exists", populated.resume.slotAvailability.additional_information, true);
  /* The empty sourceBlockIds above are load-bearing: every template's coverage
     rule requires each of a section's own blocks to be claimed exactly once, so
     an empty list can never qualify and the structured pairs stand down. That is
     what stops the two views rendering as two Languages blocks. */
  check("A2 no source block ids means no coverage, so no double rendering", populated.resume.customSections[0]?.paragraphs.every((p) => p.source.sourceBlockIds.length === 0), true);

  /* --- D: versionless and DB-free --- */
  checkTrue("D runtime is produced with no client, repository or version row", typeof populated.resume === "object" && populated.sourceDocuments.length === 0);
  check("D version id is the non-persisted manual placeholder", populated.version.id, "manual-entry-pending");

  /* --- E: nothing is invented for sections the user left empty --- */
  const bare = buildManualCanonicalRuntime({ firstName: "Alex", lastName: "Rivera", email: "alex.rivera@example.com" });
  check("E no synthetic projects", bare.resume.projects, []);
  check("E no synthetic summary", bare.resume.professionalSummary, undefined);
  check("E no synthetic skills", bare.resume.skillGroups, []);
  check("E no synthetic experience", bare.resume.professionalExperience, []);
  check("E no synthetic education", bare.resume.education, []);
  check("E no synthetic credentials", bare.resume.credentials, []);
  check("E no synthetic languages", bare.resume.languages, []);
  check("E no synthetic custom sections", bare.resume.customSections, []);
  check("E no synthetic additional_information slot", bare.resume.slotAvailability.additional_information, false);
  check("E empty slots are reported unavailable", [bare.resume.slotAvailability.projects, bare.resume.slotAvailability.professional_summary, bare.resume.slotAvailability.additional_information], [false, false, false]);

  /* --- F: target/career-objective fields have no canonical destination ---
     ResumeSlotKey has no objective/target slot and customSections has no
     live source column, so these stay unmapped by decision, not by
     oversight. Asserted so a future change to either has to come here
     first. */
  check("F the only custom section is the user's own Languages field", populated.resume.customSections.map((s) => s.id), ["manual-languages"]);
  checkTrue("F no target/objective text leaks into the summary", populated.resume.professionalSummary?.text.includes("target") === false);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
