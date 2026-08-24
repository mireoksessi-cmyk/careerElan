/*
  TASK 8 gate test - Assembly Validator + orchestrator integration. Run
  with `npx tsx lib/documentPreservation/professionalAtsAssembly/assemblyValidator.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "./buildProfessionalAtsAssembly";
import type { ResumeStructuredModel, SourceTrace, StructuredTextValue } from "../resumeStructured/types";

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

const src: SourceTrace = { sourceSectionId: "s1", sourceBlockIds: ["b1"], sourceElementIds: ["e1"] };
function tv(value: string): StructuredTextValue {
  return { value, confidence: 1, extractionMethod: "pattern-rule", source: src };
}

function emptyModel(): ResumeStructuredModel {
  return {
    schemaVersion: "1.0.0",
    source: { fileName: "synthetic.docx", fileType: "docx" },
    identity: undefined,
    professionalSummary: undefined,
    skillGroups: [],
    professionalExperience: [],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    languages: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: false, professional_summary: false, core_skills: false, professional_experience: false,
      volunteer_experience: false, education: false, certifications_licenses: false, projects: false,
      awards: false, publications: false, additional_information: false,
    },
    validation: {
      passed: true, sourceSectionCount: 0, representedSectionCount: 0, missingSectionIds: [],
      sourceBlockCount: 0, representedBlockCount: 0, missingBlockIds: [], duplicateBlockIds: [],
      inventedFactValues: [], volunteerMixedIntoProfessional: [], missingCustomSections: [], warnings: [],
    },
  };
}

// ==================== Synthetic: structured Languages keep payload identity ====================
/*
  A Languages section reaches Phase 2 with its lines UNPAIRED, while
  languageExtractor has already paired the same lines into
  model.languages. buildProfessionalAtsAssembly hands those pairs to the
  block BESIDE the payload instead of folding them into a replacement
  section, because this validator traces provenance by object identity
  (check E) - a spread copy, however faithful its id and heading, is not
  the model's object and is correctly reported as invented. These
  assertions pin that identity down so the cheaper-looking shortcut
  cannot come back.
*/
{
  const langTrace: SourceTrace = { sourceSectionId: "s-lang", sourceBlockIds: ["b-lh", "b-l1", "b-l2", "b-l3", "b-l4"], sourceElementIds: ["e-lang"] };
  const lineTrace = (blockId: string): SourceTrace => ({ sourceSectionId: "s-lang", sourceBlockIds: [blockId], sourceElementIds: ["e-lang"] });
  const lineValue = (value: string, blockId: string): StructuredTextValue => ({ value, confidence: 1, extractionMethod: "pattern-rule", source: lineTrace(blockId) });

  const model = emptyModel();
  model.customSections = [
    {
      id: "cs-lang",
      originalHeading: "Idiomas",
      displayHeading: "Idiomas",
      paragraphs: [lineValue("Alpha", "b-l1"), lineValue("Beta", "b-l2"), lineValue("Fluent", "b-l3"), lineValue("Fluent", "b-l4")],
      bullets: [],
      content: [
        { id: "cs-lang-c1", kind: "paragraph", text: "Alpha", source: lineTrace("b-l1") },
        { id: "cs-lang-c2", kind: "paragraph", text: "Beta", source: lineTrace("b-l2") },
        { id: "cs-lang-c3", kind: "paragraph", text: "Fluent", source: lineTrace("b-l3") },
        { id: "cs-lang-c4", kind: "paragraph", text: "Fluent", source: lineTrace("b-l4") },
      ],
      sourceOrder: 0,
      source: langTrace,
    },
  ];
  model.languages = [
    { name: "Alpha", proficiency: "Fluent", source: { sourceSectionId: "s-lang", sourceBlockIds: ["b-l1", "b-l3"], sourceElementIds: ["e-lang"] } },
    { name: "Beta", proficiency: "Fluent", source: { sourceSectionId: "s-lang", sourceBlockIds: ["b-l2", "b-l4"], sourceElementIds: ["e-lang"] } },
  ];

  const assembly = buildProfessionalAtsAssembly(model);
  const additional = assembly.sections.find((s) => s.key === "additional_information");
  const block = additional?.blocks[0];

  check("languages: exactly one block for the Languages source section (never one paired plus one raw)", additional?.blocks.length, 1);
  check("languages: block kind is still custom-section (no new assembly kind)", block?.kind, "custom-section");
  checkTrue("languages: block payload is REFERENCE-IDENTICAL to model.customSections[0]", block?.payload === model.customSections[0]);
  check("languages: sourceEntryId is still the source section id", block?.sourceEntryId, model.customSections[0].id);
  check("languages: the block carries both structured entries", block?.languageEntries?.length, 2);
  checkTrue("languages: carried entries are the model.languages objects themselves, not copies", (block?.languageEntries ?? []).every((e) => model.languages.includes(e)));
  check("languages: no invented-payload warning", assembly.validation.warnings.filter((w) => w.includes("not traced to a real Phase 2 object")), []);
  checkTrue("languages: assembly validation passes with structured languages present", assembly.validation.passed);
  check("languages: the source section is still represented exactly once (no lost or duplicated entry)", [assembly.validation.missingEntryIds, assembly.validation.duplicateEntryIds], [[], []]);
}

// ==================== Synthetic: partial provenance coverage falls back to the raw section ====================
/*
  Fail-safe direction. If the structured entries do not account for every
  sourceBlockId behind the section's own lines, the unmatched line has
  nowhere to go in a paired rendering - so the pairs are declined
  entirely and the raw section renders untouched. Losing a line is worse
  than showing an unpaired one, and the test asserts the conservative
  choice rather than the convenient one.
*/
{
  const lineTrace = (blockId: string): SourceTrace => ({ sourceSectionId: "s-lang2", sourceBlockIds: [blockId], sourceElementIds: ["e-lang2"] });
  const lineValue = (value: string, blockId: string): StructuredTextValue => ({ value, confidence: 1, extractionMethod: "pattern-rule", source: lineTrace(blockId) });

  const model = emptyModel();
  model.customSections = [
    {
      id: "cs-lang2",
      originalHeading: "Idiomas",
      displayHeading: "Idiomas",
      paragraphs: [lineValue("Alpha", "b-m1"), lineValue("Fluent", "b-m2"), lineValue("Certified interpreter since 2019", "b-m3")],
      bullets: [],
      content: [
        { id: "cs-lang2-c1", kind: "paragraph", text: "Alpha", source: lineTrace("b-m1") },
        { id: "cs-lang2-c2", kind: "paragraph", text: "Fluent", source: lineTrace("b-m2") },
        { id: "cs-lang2-c3", kind: "paragraph", text: "Certified interpreter since 2019", source: lineTrace("b-m3") },
      ],
      sourceOrder: 0,
      source: { sourceSectionId: "s-lang2", sourceBlockIds: ["b-m1", "b-m2", "b-m3"], sourceElementIds: ["e-lang2"] },
    },
  ];
  model.languages = [{ name: "Alpha", proficiency: "Fluent", source: { sourceSectionId: "s-lang2", sourceBlockIds: ["b-m1", "b-m2"], sourceElementIds: ["e-lang2"] } }];

  const assembly = buildProfessionalAtsAssembly(model);
  const block = assembly.sections.find((s) => s.key === "additional_information")?.blocks[0];

  check("partial coverage: b-m3 is unaccounted for, so no structured entries are carried", block?.languageEntries, undefined);
  checkTrue("partial coverage: payload is still the model's own section", block?.payload === model.customSections[0]);
  checkTrue("partial coverage: assembly validation still passes", assembly.validation.passed);
}

// ==================== Synthetic: ALL 11 sections populated simultaneously (fixture gap #1) ====================
{
  const model = emptyModel();
  model.identity = { fullName: tv("Jane Doe"), otherContactLines: [] };
  model.professionalSummary = { text: "Experienced generalist.", source: src };
  model.skillGroups = [{ skills: ["Excel"], source: src }];
  model.professionalExperience = [{ id: "exp-0", organization: tv("Acme"), bullets: [], descriptionParagraphs: [], content: [], hierarchicalContent: [], hasHierarchicalStructure: false, rawHeaderText: "", source: src, isVolunteer: false, isUncertain: false, reasonCodes: [] }];
  model.volunteerExperience = [{ id: "vol-0", organization: tv("Food Bank"), bullets: [], descriptionParagraphs: [], content: [], hierarchicalContent: [], hasHierarchicalStructure: false, rawHeaderText: "", source: src, isVolunteer: true, isUncertain: false, reasonCodes: [] }];
  model.education = [{ id: "edu-0", institution: tv("MIT"), credentials: [], fieldsOfStudy: [], institutions: [tv("MIT")], honors: [], details: [], rawHeaderText: "", source: src, isUncertain: false, reasonCodes: [] }];
  model.credentials = [{ id: "cred-0", name: tv("PMP"), names: [tv("PMP")], issuers: [], details: [], kind: "certification", rawHeaderText: "", source: src, isUncertain: false, reasonCodes: [] }];
  model.projects = [{ id: "proj-0", name: tv("Tracker"), technologies: [], bullets: [], descriptionParagraphs: [], content: [], rawHeaderText: "", source: src, isUncertain: false, reasonCodes: [] }];
  model.awards = [{ id: "award-0", name: tv("Top Performer"), names: [tv("Top Performer")], details: [], content: [], rawHeaderText: "", source: src, isUncertain: false, reasonCodes: [] }];
  model.publications = [{ id: "pub-0", title: tv("A Study"), titles: [tv("A Study")], authors: [], details: [], content: [], rawHeaderText: "", source: src, isUncertain: false, reasonCodes: [] }];
  model.customSections = [{ id: "cs-0", originalHeading: "Volunteer Board Work", displayHeading: "Volunteer Board Work", paragraphs: [tv("Board member.")], bullets: [], content: [], sourceOrder: 0, source: src }];

  const doc = buildProfessionalAtsAssembly(model);
  check("all-sections: every one of the 11 sections is visible", doc.visibleSectionKeys.length, 11);
  check("all-sections: visible order is the full fixed order", doc.visibleSectionKeys, [
    "identity", "professional_summary", "core_skills", "professional_experience", "volunteer_experience",
    "education", "certifications_licenses", "projects", "awards", "publications", "additional_information",
  ]);
  // metric_highlights is the one fixed-order section this fixture never
  // populates (no MetricGrid data) - it alone stays hidden even when
  // every other section has content, same reasoning Phase 5D.2B applies
  // everywhere else: a section with zero real entries is never forced
  // visible.
  check("all-sections: metric_highlights is the only hidden section", doc.hiddenSectionKeys, ["metric_highlights"]);
  checkTrue("all-sections: validator passed", doc.validation.passed);
  check("all-sections: zero missing entries", doc.validation.missingEntryIds.length, 0);
  check("all-sections: zero duplicate entries", doc.validation.duplicateEntryIds.length, 0);
}

// ==================== Synthetic: whitespace-only summary (fixture gap #12) ====================
{
  const model = emptyModel();
  model.identity = { fullName: tv("Jane Doe"), otherContactLines: [] };
  model.professionalSummary = { text: "   \n\n   ", source: src };
  const doc = buildProfessionalAtsAssembly(model);
  checkTrue("whitespace-summary: professional_summary hidden", !doc.visibleSectionKeys.includes("professional_summary"));
  check("whitespace-summary: reason is whitespace-only", doc.sections.find((s) => s.key === "professional_summary")?.visibilityReason, "whitespace-only");
  checkTrue("whitespace-summary: no page budget consumed (0 blocks)", doc.sections.find((s) => s.key === "professional_summary")?.blocks.length === 0);
  checkTrue("whitespace-summary: validator passed", doc.validation.passed);
}

// ==================== Synthetic: empty model entirely ====================
{
  const doc = buildProfessionalAtsAssembly(emptyModel());
  check("empty model: zero visible sections", doc.visibleSectionKeys.length, 0);
  check("empty model: all 12 hidden", doc.hiddenSectionKeys.length, 12);
  checkTrue("empty model: validator passed (nothing to lose)", doc.validation.passed);
  checkTrue("empty model: no section carries blocks", doc.sections.every((s) => s.blocks.length === 0));
}

// ==================== Real-fixture integration ====================
async function realFixtureTests() {
  const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

  async function run(file: string, format: "pdf" | "docx") {
    const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
    const layoutResult = await analyzeDocument("resume", format, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
    const model = buildStructuredResume(document);
    const assembly = buildProfessionalAtsAssembly(model);
    return { model, assembly };
  }

  // bench-B: empty professional_experience (Phase 2 fallback to custom) + real volunteer content
  {
    const { assembly } = await run("bench/resume-B-junior-canva.pdf", "pdf");
    checkTrue("bench-B: assembly validator passed", assembly.validation.passed);
    checkTrue("bench-B: professional_experience hidden (Phase 2's empty-section fallback has no real content)", !assembly.visibleSectionKeys.includes("professional_experience"));
    checkTrue("bench-B: volunteer_experience visible on its own (no professional slot)", assembly.visibleSectionKeys.includes("volunteer_experience"));
  }

  // f5: custom-only document
  {
    const { assembly } = await run("lossless-synthetic/f5-no-heading-document.docx", "docx");
    checkTrue("f5: assembly validator passed", assembly.validation.passed);
  }

  // threepage: dense multi-section real fixture, professional+volunteer both visible, adjacency check
  {
    const { assembly } = await run("threepage-pdf-resume.pdf", "pdf");
    checkTrue("threepage: assembly validator passed", assembly.validation.passed);
    const profIdx = assembly.visibleSectionKeys.indexOf("professional_experience");
    const volIdx = assembly.visibleSectionKeys.indexOf("volunteer_experience");
    checkTrue("threepage: volunteer immediately follows professional in the real visible order", volIdx === profIdx + 1);
    check("threepage: zero missing entries", assembly.validation.missingEntryIds.length, 0);
    check("threepage: zero duplicate entries", assembly.validation.duplicateEntryIds.length, 0);
    check("threepage: destructive compaction flags always empty", assembly.validation.destructiveCompactionFlags.length, 0);
  }

  // --- Determinism: same model -> byte-identical assembly document (excluding nothing - full document) ---
  {
    const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "bench/resume-C-mid-ats.pdf"));
    const layoutResult = await analyzeDocument("resume", "pdf", buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: "bench/resume-C-mid-ats.pdf", fileType: "pdf" });
    const model = buildStructuredResume(document);
    const a1 = buildProfessionalAtsAssembly(model);
    const a2 = buildProfessionalAtsAssembly(model);
    check("determinism: repeat build yields identical visibleSectionKeys", a1.visibleSectionKeys, a2.visibleSectionKeys);
    check("determinism: repeat build yields identical validation report", a1.validation, a2.validation);
    check("determinism: repeat build yields identical block ids in order", a1.sections.flatMap((s) => s.blocks.map((b) => b.id)), a2.sections.flatMap((s) => s.blocks.map((b) => b.id)));
  }

  await closeSharedBrowser();
}

realFixtureTests()
  .then(() => {
    console.log(`\n--- ${pass} passed, ${fail} failed ---`);
    if (fail > 0) process.exit(1);
  })
  .catch((error) => {
    console.error("Test run crashed:", error);
    process.exit(1);
  });
