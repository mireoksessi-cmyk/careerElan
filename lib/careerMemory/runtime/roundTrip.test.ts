/*
  Phase 6A.2 Implementation gate test - full Runtime Layer round-trip.
  Run with `npx tsx lib/careerMemory/runtime/roundTrip.test.ts`. Exercises
  factory -> overlay -> serializer -> assembly adapter together, end to
  end, purely in memory (Phase 6A.2's own instruction: "현재 DB 없음.
  Memory object만"). No Supabase/network/file I/O anywhere in this file.
*/
import { createCanonicalRuntime, createRuntimeVersion, createRuntimeSourceDocument, createRuntimeMetadata } from "./factory";
import { applyOverlay, removeOverlay, resolveTailoredResume } from "./overlayRuntime";
import { serializeCanonicalRuntime, deserializeCanonicalRuntime, validateCanonicalRuntime, normalizeCanonicalRuntime } from "./serializer";
import { toProfessionalAtsAssemblyDocument } from "./assemblyAdapter";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "./types";
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
    professionalSummary: { text: "Operations coordinator with logistics experience.", source: src },
    skillGroups: [{ label: "Skills", skills: ["Excel", "Scheduling"], source: src }],
    professionalExperience: [
      {
        id: "entry-exp-0",
        organization: { value: "Acme Corp", confidence: 1, extractionMethod: "pattern-rule", source: src },
        role: { value: "Coordinator", confidence: 1, extractionMethod: "pattern-rule", source: src },
        location: { value: "Toronto, ON", confidence: 1, extractionMethod: "pattern-rule", source: src },
        startDateText: undefined,
        endDateText: undefined,
        dateRangeText: { value: "2019 - 2022", confidence: 1, extractionMethod: "pattern-rule", source: src },
        bullets: [
          { id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting.", source: src },
          { id: "entry-exp-0-bullet-1", text: "Coordinated cross-team scheduling.", source: src },
        ],
        descriptionParagraphs: [],
        content: [
          { id: "entry-exp-0-content-0", kind: "bullet", text: "Managed weekly logistics reporting.", source: src },
          { id: "entry-exp-0-content-1", kind: "bullet", text: "Coordinated cross-team scheduling.", source: src },
        ],
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
    education: [{ id: "entry-edu-0", rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [], honors: [], details: [], credentials: [], fieldsOfStudy: [], institutions: [] }],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    languages: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: true,
      professional_summary: true,
      core_skills: true,
      professional_experience: true,
      volunteer_experience: false,
      education: true,
      certifications_licenses: false,
      projects: false,
      awards: false,
      publications: false,
      additional_information: false,
    },
    validation: {
      passed: true,
      sourceSectionCount: 2,
      representedSectionCount: 2,
      missingSectionIds: [],
      sourceBlockCount: 2,
      representedBlockCount: 2,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };
}

// ==================== Full pipeline: create -> apply overlay -> serialize -> deserialize -> assembly ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const sourceDoc = createRuntimeSourceDocument({ id: "doc-1", fileName: "resume.pdf", fileType: "pdf", contentHash: "sha256-abc", addedAt: "2026-01-01T00:00:00.000Z" });
  const metadata = createRuntimeMetadata({ schemaVersion: "1.0.0", parserVersion: "dpe-2026.1" });

  const runtime = createCanonicalRuntime({ resume: makeModel(), version, sourceDocuments: [sourceDoc], metadata });
  checkTrue("pipeline: initial runtime passes validation once serialized", validateCanonicalRuntime(serializeCanonicalRuntime(runtime)).valid);

  const applied = applyOverlay(runtime, {
    schemaVersion: "1.0.0",
    professionalSummaryText: "Operations coordinator tailored for a supply-chain analyst role.",
    entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Managed weekly logistics reporting across a 12-warehouse network." }] }],
  });
  check("pipeline: overlay applied with zero rejections", applied.rejections, []);

  const serialized = serializeCanonicalRuntime(applied.runtime);
  check("pipeline: serialized payload validates", validateCanonicalRuntime(serialized).valid, true);

  const restored = deserializeCanonicalRuntime(serialized);
  check("pipeline: restored runtime's canonical resume is UNCHANGED (still pristine)", restored.resume.professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting.");
  check("pipeline: restored runtime's overlay history survived the round-trip", restored.overlayState.history.length, 1);

  const tailoredFromRestored = resolveTailoredResume(restored);
  check("pipeline: tailored view rebuilt from the restored runtime reflects the overlay", tailoredFromRestored.professionalSummary?.text, "Operations coordinator tailored for a supply-chain analyst role.");
  check("pipeline: tailored bullet rebuilt from the restored runtime", tailoredFromRestored.professionalExperience[0].bullets[0].text, "Managed weekly logistics reporting across a 12-warehouse network.");

  const canonicalAssembly = toProfessionalAtsAssemblyDocument(restored, { useTailored: false });
  const tailoredAssembly = toProfessionalAtsAssemblyDocument(restored, { useTailored: true });
  const canonicalBlock = canonicalAssembly.sections.find((s) => s.key === "professional_experience")?.blocks[0]?.payload as any;
  const tailoredBlock = tailoredAssembly.sections.find((s) => s.key === "professional_experience")?.blocks[0]?.payload as any;
  check("pipeline: assembly adapter's canonical output uses the untouched original wording", canonicalBlock.bullets[0].text, "Managed weekly logistics reporting.");
  check("pipeline: assembly adapter's tailored output uses the overlay wording", tailoredBlock.bullets[0].text, "Managed weekly logistics reporting across a 12-warehouse network.");

  checkTrue("pipeline: source document survives the whole round-trip", restored.sourceDocuments[0].contentHash === "sha256-abc");
  check("pipeline: metadata.parserVersion survives the whole round-trip", restored.metadata.parserVersion, "dpe-2026.1");
  check("pipeline: serializerVersion is the module constant throughout", restored.serializerVersion, CANONICAL_RUNTIME_SERIALIZER_VERSION);
}

// ==================== Lossless round-trip: serialize -> deserialize -> serialize again produces identical bytes ====================
{
  const version = createRuntimeVersion({ id: "v-2", reason: "reanalysis", createdAt: "2026-02-01T00:00:00.000Z", parentVersionId: "v-1" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version });
  const firstPass = serializeCanonicalRuntime(runtime);
  const restored = deserializeCanonicalRuntime(firstPass);
  const secondPass = serializeCanonicalRuntime(restored);
  check("double-round-trip: two serialize passes around one deserialize produce byte-identical output", secondPass, firstPass);
}

// ==================== Remove-then-reapply produces the same tailored view as never having applied the removed overlay ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const baseline = createCanonicalRuntime({ resume: makeModel(), version });

  const withOverlay = applyOverlay(baseline, { schemaVersion: "1.0.0", entries: [{ entryId: "entry-exp-0", bullets: [{ id: "entry-exp-0-bullet-0", text: "Temporary tailoring." }] }] });
  const removed = removeOverlay(withOverlay.runtime, 0);

  const neverApplied = createCanonicalRuntime({ resume: makeModel(), version });

  check("remove-equivalence: resolving after remove equals a runtime that never had the overlay applied", resolveTailoredResume(removed), resolveTailoredResume(neverApplied));
}

// ==================== normalize + serialize + deserialize compose cleanly ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "import", createdAt: "2026-01-01T00:00:00.000Z" });
  const docLate = createRuntimeSourceDocument({ id: "doc-late", fileName: "late.pdf", fileType: "pdf", addedAt: "2026-01-10T00:00:00.000Z" });
  const docEarly = createRuntimeSourceDocument({ id: "doc-early", fileName: "early.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version, sourceDocuments: [docLate, docEarly] });

  const normalized = normalizeCanonicalRuntime(runtime);
  const restored = deserializeCanonicalRuntime(serializeCanonicalRuntime(normalized));
  check("normalize-then-round-trip: sourceDocument order is preserved through serialize/deserialize after normalize", restored.sourceDocuments.map((d) => d.id), ["doc-early", "doc-late"]);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
