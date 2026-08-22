/*
  Phase 6A.2 Implementation gate test - Runtime Serializer. Run with
  `npx tsx lib/careerMemory/runtime/serializer.test.ts`. Purely in-memory -
  no Supabase, no network, no file I/O anywhere in serializer.ts or here.
*/
import { serializeCanonicalRuntime, deserializeCanonicalRuntime, validateCanonicalRuntime, normalizeCanonicalRuntime } from "./serializer";
import { createCanonicalRuntime, createRuntimeVersion, createRuntimeSourceDocument } from "./factory";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "./types";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { CanonicalResumeRuntime } from "./types";

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
    professionalSummary: { text: "Operations lead.", source: src },
    skillGroups: [{ label: "Skills", skills: ["Excel", "SQL"], source: src }],
    professionalExperience: [
      {
        id: "entry-exp-0",
        organization: { value: "Acme Corp", confidence: 1, extractionMethod: "pattern-rule", source: src },
        role: { value: "Coordinator", confidence: 1, extractionMethod: "pattern-rule", source: src },
        location: undefined,
        startDateText: undefined,
        endDateText: undefined,
        dateRangeText: { value: "2019 - 2022", confidence: 1, extractionMethod: "pattern-rule", source: src },
        bullets: [{ id: "entry-exp-0-bullet-0", text: "Managed logistics reporting.", source: src }],
        descriptionParagraphs: [],
        content: [{ id: "entry-exp-0-content-0", kind: "bullet", text: "Managed logistics reporting.", source: src }],
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
    languages: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: true,
      professional_summary: true,
      core_skills: true,
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
      sourceSectionCount: 1,
      representedSectionCount: 1,
      missingSectionIds: [],
      sourceBlockCount: 1,
      representedBlockCount: 1,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };
}

function makeRuntime(): CanonicalResumeRuntime {
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const doc = createRuntimeSourceDocument({ id: "doc-1", fileName: "resume.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  return createCanonicalRuntime({ resume: makeModel(), version, sourceDocuments: [doc] });
}

// ==================== serializeCanonicalRuntime ====================
{
  const runtime = makeRuntime();
  const serialized = serializeCanonicalRuntime(runtime);
  check("serialize: top-level serializerVersion matches module constant", serialized.serializerVersion, CANONICAL_RUNTIME_SERIALIZER_VERSION);
  check("serialize: runtime.resume.identity survives", serialized.runtime.resume.identity?.fullName?.value, "Jordan Lee");
  check("serialize: runtime.resume.professionalExperience[0].bullets[0].text survives", serialized.runtime.resume.professionalExperience[0].bullets[0].text, "Managed logistics reporting.");
  check("serialize: version.id survives", serialized.runtime.version.id, "v-1");
  check("serialize: sourceDocuments[0].fileName survives", serialized.runtime.sourceDocuments[0].fileName, "resume.pdf");
  checkTrue("serialize: output is NOT the same object reference as input (deep copy)", serialized.runtime !== runtime);
  checkTrue("serialize: nested resume is NOT the same reference either", serialized.runtime.resume !== runtime.resume);
}
{
  const runtime = makeRuntime();
  const before = JSON.stringify(runtime);
  serializeCanonicalRuntime(runtime);
  checkTrue("serialize: never mutates its input", JSON.stringify(runtime) === before);
}

// ==================== validateCanonicalRuntime ====================
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const result = validateCanonicalRuntime(valid);
  check("validate: a freshly serialized payload is valid", result.valid, true);
  check("validate: no errors on valid payload", result.errors, []);
}
{
  check("validate: null is invalid", validateCanonicalRuntime(null).valid, false);
  check("validate: a string is invalid", validateCanonicalRuntime("not an object").valid, false);
  check("validate: an array is invalid (Array.isArray excluded)", validateCanonicalRuntime([1, 2, 3]).valid, false);
  check("validate: empty object is invalid", validateCanonicalRuntime({}).valid, false);
}
{
  const result = validateCanonicalRuntime({ serializerVersion: "" });
  checkTrue("validate: empty-string serializerVersion is rejected", !result.valid);
  checkTrue("validate: missing runtime object is reported", result.errors.some((e) => e.includes("runtime object")));
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  delete broken.runtime.resume.schemaVersion;
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: missing resume.schemaVersion is rejected", !result.valid);
  checkTrue("validate: error mentions schemaVersion", result.errors.some((e) => e.includes("schemaVersion")));
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  broken.runtime.resume.professionalExperience = "not an array";
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: professionalExperience must be an array", !result.valid);
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  delete broken.runtime.version.id;
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: missing version.id is rejected", !result.valid);
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  broken.runtime.sourceDocuments = [{ fileName: "no-id.pdf" }];
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: a sourceDocument missing an id is rejected", !result.valid);
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  broken.runtime.overlayState = { history: "not an array" };
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: overlayState.history must be an array", !result.valid);
}
{
  const valid = serializeCanonicalRuntime(makeRuntime());
  const broken = JSON.parse(JSON.stringify(valid));
  delete broken.runtime.metadata.serializerVersion;
  delete broken.runtime.resume.schemaVersion;
  const result = validateCanonicalRuntime(broken);
  checkTrue("validate: multiple simultaneous errors are all reported, not just the first", result.errors.length >= 2);
}

// ==================== deserializeCanonicalRuntime ====================
{
  const runtime = makeRuntime();
  const serialized = serializeCanonicalRuntime(runtime);
  const back = deserializeCanonicalRuntime(serialized);
  check("deserialize: resume identity round-trips", back.resume.identity?.fullName?.value, "Jordan Lee");
  check("deserialize: version round-trips", back.version, runtime.version);
  check("deserialize: sourceDocuments round-trip", back.sourceDocuments, runtime.sourceDocuments);
  checkTrue("deserialize: returns a NEW object, not the serialized wrapper's own runtime reference", back !== serialized.runtime);
}
{
  let threw = false;
  try {
    deserializeCanonicalRuntime({ not: "valid" });
  } catch {
    threw = true;
  }
  checkTrue("deserialize: throws on an invalid payload rather than returning a partial object", threw);
}
{
  let message = "";
  try {
    deserializeCanonicalRuntime(null);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  checkTrue("deserialize: error message names the actual validation failure", message.includes("invalid payload"));
}

// ==================== Round-trip: serialize -> deserialize -> equals original ====================
{
  const runtime = makeRuntime();
  const roundTripped = deserializeCanonicalRuntime(serializeCanonicalRuntime(runtime));
  check("round-trip: full runtime is byte-identical after serialize+deserialize", roundTripped, JSON.parse(JSON.stringify(runtime)));
}

// ==================== normalizeCanonicalRuntime ====================
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const docA = createRuntimeSourceDocument({ id: "doc-a", fileName: "a.pdf", fileType: "pdf", addedAt: "2026-01-05T00:00:00.000Z" });
  const docB = createRuntimeSourceDocument({ id: "doc-b", fileName: "b.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version, sourceDocuments: [docA, docB] });
  const normalized = normalizeCanonicalRuntime(runtime);
  check("normalize: sourceDocuments sorted by addedAt ascending", normalized.sourceDocuments.map((d) => d.id), ["doc-b", "doc-a"]);
}
{
  const version = createRuntimeVersion({ id: "v-1", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" });
  const docA1 = createRuntimeSourceDocument({ id: "doc-a", fileName: "a-v1.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" });
  const docA2 = createRuntimeSourceDocument({ id: "doc-a", fileName: "a-v2.pdf", fileType: "pdf", addedAt: "2026-01-02T00:00:00.000Z" });
  const runtime = createCanonicalRuntime({ resume: makeModel(), version, sourceDocuments: [docA1, docA2] });
  const normalized = normalizeCanonicalRuntime(runtime);
  check("normalize: duplicate ids deduped, first occurrence kept", normalized.sourceDocuments.length, 1);
  check("normalize: dedupe keeps the FIRST occurrence's own data", normalized.sourceDocuments[0].fileName, "a-v1.pdf");
}
{
  const runtime = makeRuntime();
  const before = JSON.stringify(runtime);
  normalizeCanonicalRuntime(runtime);
  checkTrue("normalize: never mutates its input", JSON.stringify(runtime) === before);
}
{
  const runtime = makeRuntime();
  const once = normalizeCanonicalRuntime(runtime);
  const twice = normalizeCanonicalRuntime(once);
  check("normalize: idempotent - calling twice produces the same result as calling once", twice, once);
}
{
  const runtime = makeRuntime();
  const normalized = normalizeCanonicalRuntime(runtime);
  check("normalize: resume field is untouched (deep-equal to original)", normalized.resume, runtime.resume);
  check("normalize: overlayState.history is untouched (deep-equal, never reordered)", normalized.overlayState.history, runtime.overlayState.history);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
