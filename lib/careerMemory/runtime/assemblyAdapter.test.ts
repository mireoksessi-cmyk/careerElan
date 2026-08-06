/*
  Phase 6A.2 Implementation gate test - Assembly Adapter. Run with
  `npx tsx lib/careerMemory/runtime/assemblyAdapter.test.ts`.
  buildProfessionalAtsAssembly itself (Phase 3, unmodified) is exercised
  through the adapter only - this file never calls it directly, proving
  the adapter is a real, working bridge rather than a type-only stub.
*/
import { toProfessionalAtsAssemblyDocument } from "./assemblyAdapter";
import { applyOverlay } from "./overlayRuntime";
import { createCanonicalRuntime, createRuntimeVersion } from "./factory";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";

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

const src = { sourceSectionId: "s1", sourceBlockIds: ["b1"], sourceElementIds: ["e1"] };

function makeModel(): ResumeStructuredModel {
  return {
    schemaVersion: "1.0.0",
    source: { fileName: "synthetic.pdf", fileType: "pdf" },
    identity: { fullName: { value: "Jordan Lee", confidence: 1, extractionMethod: "pattern-rule", source: src }, otherContactLines: [] },
    professionalSummary: { text: "Operations coordinator.", source: src },
    skillGroups: [],
    professionalExperience: [
      {
        id: "entry-exp-0",
        organization: { value: "Acme Corp", confidence: 1, extractionMethod: "pattern-rule", source: src },
        role: { value: "Coordinator", confidence: 1, extractionMethod: "pattern-rule", source: src },
        location: undefined,
        startDateText: undefined,
        endDateText: undefined,
        dateRangeText: { value: "2019 - 2022", confidence: 1, extractionMethod: "pattern-rule", source: src },
        bullets: [{ id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting.", source: src }],
        descriptionParagraphs: [],
        content: [{ id: "entry-exp-0-content-0", kind: "bullet", text: "Managed weekly logistics reporting.", source: src }],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Coordinator\nAcme Corp - 2019 - 2022",
        source: src,
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: true,
      professional_summary: true,
      core_skills: false,
      professional_experience: true,
      volunteer_experience: false,
      education: false,
      certifications_licenses: false,
      projects: false,
      awards: false,
      publications: false,
      additional_information: false,
    },
    validation: {
      passed: true,
      sourceSectionCount: 0,
      representedSectionCount: 0,
      missingSectionIds: [],
      sourceBlockCount: 0,
      representedBlockCount: 0,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };
}

// ==================== toProfessionalAtsAssemblyDocument: default (canonical, not tailored) ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const assembly = toProfessionalAtsAssemblyDocument(runtime);

  check("adapter-default: schemaVersion set on the assembly document", assembly.schemaVersion, "1.0.0");
  check("adapter-default: templateId is the professional-ats-v1 constant", assembly.templateId, "professional-ats-v1");
  checkTrue("adapter-default: identity section is visible (real content present)", assembly.visibleSectionKeys.includes("identity"));
  checkTrue("adapter-default: professional_experience section is visible", assembly.visibleSectionKeys.includes("professional_experience"));
  const expBlock = assembly.sections.find((s) => s.key === "professional_experience")?.blocks[0];
  checkTrue("adapter-default: experience block payload IS the runtime's own entry object (real bridge, not a stub)", (expBlock?.payload as any) === runtime.resume.professionalExperience[0]);
}

// ==================== toProfessionalAtsAssemblyDocument: useTailored=false explicit ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const applied = applyOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Tailored wording for a specific job." }] }] });

  const canonicalAssembly = toProfessionalAtsAssemblyDocument(applied.runtime, { useTailored: false });
  const expBlock = canonicalAssembly.sections.find((s) => s.key === "professional_experience")?.blocks[0];
  const payload = expBlock?.payload as any;
  check("adapter-untailored: bullet text is the ORIGINAL canonical wording", payload.bullets[0].text, "Managed weekly logistics reporting.");
}

// ==================== toProfessionalAtsAssemblyDocument: useTailored=true ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const applied = applyOverlay(runtime, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Tailored wording for a specific job." }] }] });

  const tailoredAssembly = toProfessionalAtsAssemblyDocument(applied.runtime, { useTailored: true });
  const expBlock = tailoredAssembly.sections.find((s) => s.key === "professional_experience")?.blocks[0];
  const payload = expBlock?.payload as any;
  check("adapter-tailored: bullet text reflects the OVERLAY wording", payload.bullets[0].text, "Tailored wording for a specific job.");
}

// ==================== Adapter never mutates the runtime it was given ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const before = JSON.stringify(runtime);
  toProfessionalAtsAssemblyDocument(runtime, { useTailored: true });
  checkTrue("adapter: never mutates its input runtime", JSON.stringify(runtime) === before);
}

// ==================== Adapter with no overlays applied: useTailored=true equals useTailored=false ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const a = toProfessionalAtsAssemblyDocument(runtime, { useTailored: false });
  const b = toProfessionalAtsAssemblyDocument(runtime, { useTailored: true });
  check("adapter-no-overlay: tailored and untailored assemblies are identical when no overlay was ever applied", a, b);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
