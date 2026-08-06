/*
  Phase 6A.2 Implementation gate test - Runtime Factory. Run with
  `npx tsx lib/careerMemory/runtime/factory.test.ts`. Pure in-memory
  object construction only - no Supabase, no network, no file I/O.
*/
import { createRuntimeMetadata, createRuntimeVersion, createRuntimeOverlayState, createRuntimeSourceDocument, createCanonicalRuntime } from "./factory";
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

function makeMinimalModel(): ResumeStructuredModel {
  return {
    schemaVersion: "1.0.0",
    source: { fileName: "synthetic.pdf", fileType: "pdf" },
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
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: false,
      professional_summary: false,
      core_skills: false,
      professional_experience: false,
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

// ==================== createRuntimeMetadata ====================
{
  const metadata = createRuntimeMetadata({ schemaVersion: "1.0.0" });
  check("metadata: schemaVersion set", metadata.schemaVersion, "1.0.0");
  check("metadata: parserVersion undefined when omitted", metadata.parserVersion, undefined);
  check("metadata: serializerVersion defaults to constant", metadata.serializerVersion, CANONICAL_RUNTIME_SERIALIZER_VERSION);
}
{
  const metadata = createRuntimeMetadata({ schemaVersion: "2.0.0", parserVersion: "parser-v3", serializerVersion: "custom-v9" });
  check("metadata: parserVersion set when provided", metadata.parserVersion, "parser-v3");
  check("metadata: serializerVersion overridable", metadata.serializerVersion, "custom-v9");
}

// ==================== createRuntimeVersion ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  check("version: id set", version.id, "v-1");
  check("version: reason set", version.reason, "initial");
  check("version: createdAt set", version.createdAt, "2026-01-01T00:00:00.000Z");
  check("version: parentVersionId undefined when omitted", version.parentVersionId, undefined);
}
{
  const version = createRuntimeVersion({ id: "v-2", reason: "reanalysis", createdAt: "2026-01-02T00:00:00.000Z", parentVersionId: "v-1" });
  check("version: parentVersionId set when provided", version.parentVersionId, "v-1");
  check("version: reason accepts reanalysis", version.reason, "reanalysis");
}
{
  const reasons: Array<"initial" | "reanalysis" | "user_edit" | "merge" | "import" | "restore"> = ["initial", "reanalysis", "user_edit", "merge", "import", "restore"];
  reasons.forEach((reason, i) => {
    const version = createRuntimeVersion({ id: `v-reason-${i}`, reason, createdAt: "2026-01-01T00:00:00.000Z" });
    check(`version: reason "${reason}" round-trips`, version.reason, reason);
  });
}

// ==================== createRuntimeOverlayState ====================
{
  const state1 = createRuntimeOverlayState();
  check("overlayState: starts with empty history", state1.history, []);
  const state2 = createRuntimeOverlayState();
  checkTrue("overlayState: two calls produce distinct array instances (never shared by reference)", state1.history !== state2.history);
}

// ==================== createRuntimeSourceDocument ====================
{
  const doc = createRuntimeSourceDocument({ id: "doc-1", fileName: "resume.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  check("sourceDocument: id set", doc.id, "doc-1");
  check("sourceDocument: fileName set", doc.fileName, "resume.pdf");
  check("sourceDocument: fileType set", doc.fileType, "pdf");
  check("sourceDocument: addedAt set", doc.addedAt, "2026-01-01T00:00:00.000Z");
  check("sourceDocument: contentHash undefined when omitted", doc.contentHash, undefined);
}
{
  const doc = createRuntimeSourceDocument({ id: "doc-2", fileName: "resume.docx", fileType: "docx", contentHash: "abc123", addedAt: "2026-01-02T00:00:00.000Z" });
  check("sourceDocument: contentHash set when provided", doc.contentHash, "abc123");
  check("sourceDocument: fileType accepts docx", doc.fileType, "docx");
}

// ==================== createCanonicalRuntime ====================
{
  const model = makeMinimalModel();
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: model, version });

  checkTrue("runtime: resume is the SAME reference passed in (no cloning at construction time)", runtime.resume === model);
  check("runtime: version set", runtime.version, version);
  check("runtime: sourceDocuments defaults to empty array", runtime.sourceDocuments, []);
  check("runtime: serializerVersion always the module constant", runtime.serializerVersion, CANONICAL_RUNTIME_SERIALIZER_VERSION);
  check("runtime: overlayState defaults to empty history", runtime.overlayState.history, []);
  check("runtime: metadata defaults schemaVersion from resume.schemaVersion", runtime.metadata.schemaVersion, model.schemaVersion);
}
{
  const model = makeMinimalModel();
  const version = createRuntimeVersion({ id: "v-2", reason: "import", createdAt: "2026-01-03T00:00:00.000Z" });
  const doc = createRuntimeSourceDocument({ id: "doc-1", fileName: "a.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  const metadata = createRuntimeMetadata({ schemaVersion: "9.9.9" });
  const overlayState = createRuntimeOverlayState();
  const runtime = createCanonicalRuntime({ resume: model, version, sourceDocuments: [doc], metadata, overlayState });

  check("runtime: sourceDocuments passed through explicitly", runtime.sourceDocuments, [doc]);
  check("runtime: metadata passed through explicitly (not derived)", runtime.metadata.schemaVersion, "9.9.9");
  checkTrue("runtime: overlayState is the SAME reference passed in", runtime.overlayState === overlayState);
}
{
  const modelA = makeMinimalModel();
  const modelB = makeMinimalModel();
  const versionA = createRuntimeVersion({ id: "v-a", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const versionB = createRuntimeVersion({ id: "v-b", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const runtimeA = createCanonicalRuntime({ resume: modelA, version: versionA });
  const runtimeB = createCanonicalRuntime({ resume: modelB, version: versionB });
  checkTrue("runtime: two independently-created runtimes never share overlayState.history array identity", runtimeA.overlayState.history !== runtimeB.overlayState.history);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
