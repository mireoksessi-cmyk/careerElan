/*
  Gate for the upload -> edit -> user-confirmed-version contract's two
  pure halves: reading a canonical resume back into the 1-8 editor, and
  turning the edited draft into the runtime that becomes V2.

  Both functions are pure, so this file builds a V1 structured model as a
  plain object and asserts on what comes back - no Supabase client, no
  version row, no network. What it therefore does NOT prove is the
  database transaction itself; that lives in the RPC and is argued from
  the SQL, not executed here. Stated plainly rather than implied.

  Every value below is synthetic.

  Run with `npx tsx lib/careerMemory/services/canonicalRuntimeToCareerMemory.test.ts`.
*/
import {
  buildUserConfirmedRuntime,
  canonicalRuntimeToCareerMemoryInput,
  careerMemoryColumnsFromDraft,
} from "./canonicalRuntimeToCareerMemory";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION, type CanonicalResumeRuntime } from "../runtime/types";
import type { ResumeStructuredModel, SourceTrace } from "@/lib/documentPreservation/resumeStructured/types";

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

const trace = (sectionId: string): SourceTrace => ({ sourceSectionId: sectionId, sourceBlockIds: [`${sectionId}-b0`], sourceElementIds: [] });
const value = (v: string, sectionId = "section-x") => ({ value: v, confidence: 0.9, extractionMethod: "pattern-rule" as const, source: trace(sectionId) });

/*
  An imported V1 carrying one of everything, including the four kinds the
  1-8 editor has no box for.
*/
const V1_RESUME = {
  schemaVersion: "1.0.0",
  source: { fileName: "sample-resume.pdf", fileType: "pdf" as const },
  identity: {
    fullName: value("Alex Rivera Santos"),
    headline: value("Operations Lead"),
    email: value("alex@example.test"),
    phone: value("555-0100"),
    location: value("Sample City, ST"),
    linkedin: value("linkedin.com/in/example"),
    otherContactLines: [],
  },
  professionalSummary: { text: "Operations lead focused on throughput.", source: trace("section-sum") },
  skillGroups: [
    { label: "Core", skills: ["Inventory control", "Vendor management"], source: trace("section-skills") },
    { label: "Tools", skills: ["Spreadsheets"], source: trace("section-skills") },
  ],
  professionalExperience: [
    {
      id: "exp-0", organization: value("Example Logistics"), role: value("Operations Lead"), location: value("Sample City, ST"),
      startDateText: value("2021"), endDateText: value("Present"),
      bullets: [{ text: "Ran the regional dispatch desk.", source: trace("section-exp") }],
      descriptionParagraphs: [], content: [], rawHeaderText: "", source: trace("section-exp"), isUncertain: false, reasonCodes: [], isVolunteer: false,
    },
    {
      id: "exp-1", organization: value("Example Freight"), role: value("Dispatcher"),
      startDateText: value("2018"), endDateText: value("2021"),
      bullets: [], descriptionParagraphs: [value("Coordinated regional routes.")],
      content: [], rawHeaderText: "", source: trace("section-exp"), isUncertain: false, reasonCodes: [], isVolunteer: false,
    },
  ],
  volunteerExperience: [
    {
      id: "vol-0", organization: value("Example Food Bank"), role: value("Coordinator"),
      startDateText: value("2020"), endDateText: value("2021"),
      bullets: [], descriptionParagraphs: [], content: [], rawHeaderText: "", source: trace("section-vol"), isUncertain: false, reasonCodes: [], isVolunteer: true,
    },
  ],
  education: [
    { id: "edu-0", institution: value("Example College"), credential: value("Diploma"), fieldOfStudy: value("Business Administration"), startDateText: value("2014"), endDateText: value("2018"), institutions: [], credentials: [], fieldsOfStudy: [], honors: [], details: [], content: [], rawHeaderText: "", source: trace("section-edu"), isUncertain: false, reasonCodes: [] },
    { id: "edu-1", institution: value("Example Institute"), credential: value("Certificate"), startDateText: value("2013"), institutions: [], credentials: [], fieldsOfStudy: [], honors: [], details: [], content: [], rawHeaderText: "", source: trace("section-edu"), isUncertain: false, reasonCodes: [] },
  ],
  credentials: [
    { id: "cred-0", name: value("Lean Six Sigma Green Belt"), issuer: value("Example Institute"), issueDateText: value("2019"), names: [], issuers: [], details: [], content: [], rawHeaderText: "", source: trace("section-cred"), isUncertain: false, reasonCodes: [] },
  ],
  projects: [
    { id: "proj-0", name: value("Depot Rebalancing"), role: value("Lead"), dateRangeText: value("2022"), technologies: [], bullets: [], descriptionParagraphs: [value("Rebalanced stock across four depots.")], content: [], rawHeaderText: "", source: trace("section-proj"), isUncertain: false, reasonCodes: [] },
  ],
  awards: [{ id: "award-0", name: value("Operational Excellence Award"), issuer: value("Example Council"), dateText: value("2022"), details: [], content: [], rawHeaderText: "", source: trace("section-awards"), isUncertain: false, reasonCodes: [] }],
  publications: [{ id: "pub-0", title: value("Regional Distribution Patterns"), authors: [], publisherOrVenue: value("Example Journal"), dateText: value("2021"), details: [], content: [], rawHeaderText: "", source: trace("section-pubs"), isUncertain: false, reasonCodes: [] }],
  languages: [
    { name: "English", proficiency: "Native or Bilingual", source: trace("section-lang") },
    { name: "Spanish", proficiency: "Professional Working", source: trace("section-lang") },
  ],
  customSections: [
    /* The raw Languages section the parser read - the draft's Languages
       field speaks for this one, so it must NOT survive alongside it. */
    { id: "custom-lang", originalHeading: "Languages", displayHeading: "Languages", paragraphs: [], bullets: [], content: [], sourceOrder: 10, source: trace("section-lang") },
    /* An unrelated section the editor cannot represent - must survive. */
    { id: "custom-affil", originalHeading: "Professional Affiliations", displayHeading: "Professional Affiliations", paragraphs: [], bullets: [], content: [], sourceOrder: 20, source: trace("section-affil") },
  ],
  metricGrids: [
    { id: "grid-0", entries: [{ value: value("$412M+", "section-kpi"), label: value("ORDER BACKLOG", "section-kpi") }], source: trace("section-kpi") },
  ],
  slotAvailability: {} as ResumeStructuredModel["slotAvailability"],
  validation: { passed: true, missingSectionIds: [], missingBlockIds: [], duplicateBlockIds: [], inventedFactValues: [], volunteerMixedIntoProfessional: [], missingCustomSections: [], sourceSectionCount: 0, representedSectionCount: 0, sourceBlockCount: 0, representedBlockCount: 0, warnings: [] },
} as unknown as ResumeStructuredModel;

const V1: CanonicalResumeRuntime = {
  resume: V1_RESUME,
  metadata: { schemaVersion: "1.0.0", serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION },
  version: { id: "version-1", reason: "import", createdAt: "2024-01-01T00:00:00.000Z" },
  sourceDocuments: [{ id: "doc-1", fileName: "sample-resume.pdf", fileType: "pdf", contentHash: "abc", addedAt: "2024-01-01T00:00:00.000Z" }],
  serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION,
  overlayState: { history: [] },
};

function main() {
  /* ---------- A: prefill ---------- */
  const draft = canonicalRuntimeToCareerMemoryInput(V1);

  check("A name splits into given/surname on the last token", [draft.firstName, draft.lastName], ["Alex Rivera", "Santos"]);
  check("A headline preserved", draft.headline, "Operations Lead");
  check("A email preserved", draft.email, "alex@example.test");
  check("A phone preserved", draft.phone, "555-0100");
  check("A location preserved", draft.location, "Sample City, ST");
  check("A linkedin preserved", draft.linkedin, "linkedin.com/in/example");
  check("A summary preserved", draft.summary, "Operations lead focused on throughput.");
  check("A skill groups flatten in order", draft.skills, ["Inventory control", "Vendor management", "Spreadsheets"]);

  check("A both experience entries map, in order", draft.experience?.map((e) => e.company), ["Example Logistics", "Example Freight"]);
  check("A experience role/date map", [draft.experience?.[0].jobTitle, draft.experience?.[0].startDate, draft.experience?.[0].endDate], ["Operations Lead", "2021", "Present"]);
  check("A bullets become the description box", draft.experience?.[0].description, "Ran the regional dispatch desk.");
  check("A paragraphs become the description box", draft.experience?.[1].description, "Coordinated regional routes.");
  check("A volunteer maps separately", draft.volunteerExperience?.map((e) => e.organization), ["Example Food Bank"]);
  check("A both education entries map, in order", draft.education?.map((e) => e.school), ["Example College", "Example Institute"]);
  check("A education prefers fieldOfStudy for the program box", draft.education?.[0].program, "Business Administration");
  check("A education falls back to credential when no field of study", draft.education?.[1].program, "Certificate");
  check("A certifications map", draft.certifications, [{ name: "Lean Six Sigma Green Belt", issuer: "Example Institute", date: "2019" }]);
  check("A projects map", draft.projects, [{ name: "Depot Rebalancing", role: "Lead", dates: "2022", description: "Rebalanced stock across four depots." }]);
  check("A languages map with proficiency, in order", draft.languages, [{ language: "English", level: "Native or Bilingual" }, { language: "Spanish", level: "Professional Working" }]);

  /* ---------- B: nothing invented ---------- */
  const goalKeys = ["targetRoles", "targetIndustry", "targetLocation", "salaryExpectation", "careerGoalSummary"];
  check("B no Career Goals field is invented from resume text", goalKeys.filter((k) => k in (draft as Record<string, unknown>)), []);
  checkTrue("B awards are not smuggled into any editor field", !JSON.stringify(draft).includes("Operational Excellence Award"));
  checkTrue("B publications are not smuggled into any editor field", !JSON.stringify(draft).includes("Regional Distribution Patterns"));
  checkTrue("B custom sections are not smuggled into any editor field", !JSON.stringify(draft).includes("Professional Affiliations"));
  checkTrue("B metric grids are not smuggled into any editor field", !JSON.stringify(draft).includes("$412M+"));

  const sparse = canonicalRuntimeToCareerMemoryInput({ ...V1, resume: { ...V1_RESUME, identity: { fullName: value("Solo"), otherContactLines: [] }, professionalSummary: undefined } as unknown as ResumeStructuredModel });
  check("B a single-token name stays in the given-name box", [sparse.firstName, sparse.lastName], ["Solo", undefined]);
  check("B absent optional fields come back undefined, not empty strings", [sparse.email, sparse.summary], [undefined, undefined]);

  /* ---------- C: edit + build V2 ---------- */
  const edited = {
    ...draft,
    headline: "Director of Operations",
    experience: (draft.experience ?? []).map((e, i) => (i === 0 ? { ...e, company: "Example Logistics Group" } : e)),
    languages: [{ language: "English", level: "Native or Bilingual" }, { language: "Spanish", level: "Full Professional" }],
  };
  const v2 = buildUserConfirmedRuntime(edited, V1);

  check("C edited headline reaches V2", v2.resume.identity?.headline?.value, "Director of Operations");
  check("C edited employer reaches V2", v2.resume.professionalExperience[0]?.organization?.value, "Example Logistics Group");
  check("C untouched employer is unchanged", v2.resume.professionalExperience[1]?.organization?.value, "Example Freight");
  check("C edited language level reaches V2", v2.resume.languages.map((l) => [l.name, l.proficiency]), [["English", "Native or Bilingual"], ["Spanish", "Full Professional"]]);
  check("C education survives the round trip", v2.resume.education.map((e) => e.institution?.value), ["Example College", "Example Institute"]);
  check("C volunteer stays volunteer", v2.resume.volunteerExperience.map((e) => e.organization?.value), ["Example Food Bank"]);

  /* ---------- D: carry-through of what the editor cannot reach ---------- */
  check("D awards carried unchanged", v2.resume.awards, V1_RESUME.awards);
  check("D publications carried unchanged", v2.resume.publications, V1_RESUME.publications);
  check("D metric grids carried unchanged, never flattened", v2.resume.metricGrids, V1_RESUME.metricGrids);
  checkTrue("D the unrelated custom section survives", v2.resume.customSections.some((s) => s.originalHeading === "Professional Affiliations"));
  check(
    "D the parser's own Languages section is replaced, not duplicated, by the edited field",
    v2.resume.customSections.filter((s) => s.id === "custom-lang"),
    []
  );
  check("D exactly one Languages-bearing custom section remains", v2.resume.customSections.filter((s) => (s.originalHeading ?? "").toLowerCase() === "languages").length, 1);

  /* ---------- E: version + provenance semantics ---------- */
  check("E V2 records V1 as its parent", v2.version.parentVersionId, "version-1");
  check("E V2 is marked as a user edit, not an import", v2.version.reason, "user_edit");
  check("E V2 claims no source document, so it cannot be mistaken for an upload", v2.sourceDocuments, []);
  check("E the original file envelope is preserved on the model", v2.resume.source, V1_RESUME.source);
  check("E V1 is not mutated by building V2", V1.version.id, "version-1");
  check("E V1 still owns its source document", V1.sourceDocuments.map((d) => d.id), ["doc-1"]);
  check("E V1 awards untouched", V1_RESUME.awards.length, 1);

  /* ---------- F: career_memory column payload ---------- */
  const columns = careerMemoryColumnsFromDraft(edited, { targetIndustry: "Logistics", targetRoles: ["Director"] });
  check("F languages are written to career_memory", columns.languages, edited.languages);
  check("F volunteer experience is written to career_memory", (columns.volunteer_experience as unknown[]).length, 1);
  check("F the user's own Career Goals are carried, not derived", [columns.target_industry, columns.target_roles], ["Logistics", ["Director"]]);
  check(
    "F no template or style column is written by a content save",
    ["resume_template", "cover_template", "theme", "font", "text_size", "tone", "selected_resume_type", "selected_resume_id"].filter((k) => k in columns),
    []
  );

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
