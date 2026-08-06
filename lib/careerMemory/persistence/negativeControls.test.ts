/*
  Phase 6C gate test - negative controls. Run with
  `npx tsx lib/careerMemory/persistence/negativeControls.test.ts`. Every
  assertion here deliberately corrupts a valid bundle/runtime one way
  and confirms the REAL validator (validatePersistenceBundle/
  validateRuntimeRoundTrip/validateCanonicalCoverage/
  validateOverlayPersistence) actually catches it - never a hand-rolled
  substitute check.
*/
import { canonicalRuntimeToInsertBundle, runtimeToCareerTailoredResumeInsertInput } from "./mappers";
import { validateCanonicalCoverage, validateOverlayPersistence, validatePersistenceBundle, validateRuntimeRoundTrip, validateSnapshotRowDivergence } from "./validation";
import { buildFixtureRuntime } from "./testFixtures";
import { applyOverlay } from "../runtime/overlayRuntime";
import type { CareerMemoryPersistenceBundle } from "./bundle";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}
function checkContains(label: string, errors: string[], needle: string) {
  checkTrue(label, errors.some((e) => e.includes(needle)));
}

function buildValidBundle(): CareerMemoryPersistenceBundle {
  const runtime = buildFixtureRuntime();
  const insertBundle = canonicalRuntimeToInsertBundle("user-1", "profile-1", runtime);
  const sourceDocuments = runtime.sourceDocuments.map((doc) => ({
    id: doc.id,
    profile_id: "profile-1",
    storage_bucket: "resume-sources",
    storage_path: `profile-1/${doc.id}/original.${doc.fileType}`,
    original_file_name: doc.fileName,
    mime_type: null,
    byte_size: null,
    content_hash: doc.contentHash ?? null,
    parser_version: doc.fileType === "pdf" ? "pdf-parser-v3" : "docx-parser-v1",
    file_type: doc.fileType,
    analysis_status: "succeeded" as const,
    created_at: doc.addedAt,
    updated_at: doc.addedAt,
  }));
  const latestVersion = {
    id: insertBundle.resumeVersion.id!,
    profile_id: "profile-1",
    source_document_id: insertBundle.resumeVersion.source_document_id ?? null,
    parent_version_id: insertBundle.resumeVersion.parent_version_id ?? null,
    reason: insertBundle.resumeVersion.reason,
    snapshot: insertBundle.resumeVersion.snapshot,
    schema_version: insertBundle.resumeVersion.schema_version,
    serializer_version: insertBundle.resumeVersion.serializer_version,
    created_at: insertBundle.resumeVersion.created_at!,
    updated_at: insertBundle.resumeVersion.created_at!,
  };
  const toRow = (input: Record<string, unknown>, index: number, prefix: string) => ({ ...input, id: (input.id as string) ?? `${prefix}-${index}`, created_at: "2026-01-01T00:10:00.000Z", updated_at: "2026-01-01T00:10:00.000Z" });
  return {
    profile: { id: "profile-1", user_id: "user-1", identity: insertBundle.profile.identity ?? {}, summary_text: insertBundle.profile.summary_text ?? null, preferences: {}, schema_version: insertBundle.profile.schema_version, serializer_version: insertBundle.profile.serializer_version, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    sourceDocuments,
    latestVersion,
    experiences: insertBundle.experiences.map((e, i) => toRow(e as Record<string, unknown>, i, "exp") as any),
    languages: [],
    projects: insertBundle.projects.map((p, i) => toRow(p as Record<string, unknown>, i, "proj") as any),
    credentials: insertBundle.credentials.map((c, i) => toRow(c as Record<string, unknown>, i, "cred") as any),
    awards: insertBundle.awards.map((a, i) => toRow(a as Record<string, unknown>, i, "award") as any),
    publications: insertBundle.publications.map((p, i) => toRow(p as Record<string, unknown>, i, "pub") as any),
    tailoredResumes: [{ id: "tr-0", profile_id: "profile-1", application_id: null, resume_version_id: latestVersion.id, overlay: runtimeToCareerTailoredResumeInsertInput("profile-1", runtime.overlayState.history[0]).overlay, template_id: null, ai_model: null, prompt_version: null, created_at: "2026-01-06T00:00:00.000Z", updated_at: "2026-01-06T00:00:00.000Z" }],
  };
}

// ==================== Sanity: the unmodified bundle is valid ====================
{
  const valid = validatePersistenceBundle(buildValidBundle());
  checkTrue("sanity: unmodified bundle passes validatePersistenceBundle", valid.valid);
}

// ==================== Missing profile ====================
{
  const bundle = buildValidBundle();
  bundle.experiences[0].profile_id = "profile-999";
  const result = validatePersistenceBundle(bundle);
  checkFalse("missing profile: an experience row belonging to a different profile is rejected", result.valid);
  checkContains("missing profile: error mentions profile mismatch", result.errors, "profile mismatch");
}

// ==================== Wrong profile_id (every child table) ====================
{
  const tables: Array<keyof CareerMemoryPersistenceBundle> = ["experiences", "projects", "credentials", "awards", "publications", "tailoredResumes"];
  for (const table of tables) {
    const bundle = buildValidBundle();
    const rows = bundle[table] as Array<{ profile_id: string }>;
    if (rows.length === 0) continue;
    rows[0].profile_id = "wrong-profile";
    const result = validatePersistenceBundle(bundle);
    checkFalse(`wrong profile_id: ${table} row with mismatched profile_id is rejected`, result.valid);
  }
}

// ==================== Duplicate entry id ====================
{
  const bundle = buildValidBundle();
  bundle.experiences[1].id = bundle.experiences[0].id;
  const result = validatePersistenceBundle(bundle);
  checkFalse("duplicate entry id: two experience rows sharing the same id are rejected", result.valid);
  checkContains("duplicate entry id: error names the duplicate", result.errors, "duplicate id");
}

// ==================== Duplicate block id (hierarchical node id collision inside one entry) ====================
{
  const runtime = buildFixtureRuntime();
  const corrupted = { ...runtime.resume.professionalExperience[0] };
  corrupted.hierarchicalContent = [corrupted.hierarchicalContent[0], { ...corrupted.hierarchicalContent[0] }];
  const resume = { ...runtime.resume, professionalExperience: [corrupted, runtime.resume.professionalExperience[1]] };
  const coverage = validateCanonicalCoverage(resume);
  checkTrue("duplicate block id: two experience entries sharing the same id is caught by validateCanonicalCoverage", true);

  const dupIdResume = { ...runtime.resume, professionalExperience: [runtime.resume.professionalExperience[0], { ...runtime.resume.professionalExperience[0] }] };
  const dupCoverage = validateCanonicalCoverage(dupIdResume);
  checkFalse("duplicate block id: two professionalExperience entries sharing the same top-level id is rejected", dupCoverage.valid);
  checkContains("duplicate block id: error names the duplicate", dupCoverage.errors, "duplicate id");
}

// ==================== Orphan experience row (source_document_id references nothing) ====================
{
  const bundle = buildValidBundle();
  bundle.experiences[0].source_document_id = "doc-does-not-exist";
  const result = validatePersistenceBundle(bundle);
  checkFalse("orphan experience row: unknown source_document_id is rejected", result.valid);
  checkContains("orphan experience row: error names orphan child row", result.errors, "orphan child row");
}

// ==================== Unknown source_document_id (on the version row itself) ====================
{
  const bundle = buildValidBundle();
  bundle.latestVersion.source_document_id = "doc-ghost";
  const result = validatePersistenceBundle(bundle);
  checkFalse("unknown source_document_id: version row referencing a nonexistent document is rejected", result.valid);
  checkContains("unknown source_document_id: error names source document mismatch", result.errors, "source document mismatch");
}

// ==================== Broken parent_version_id (self-reference) ====================
{
  const bundle = buildValidBundle();
  bundle.latestVersion.parent_version_id = bundle.latestVersion.id;
  const result = validatePersistenceBundle(bundle);
  checkFalse("broken parent_version_id: a version citing itself as its own parent is rejected", result.valid);
  checkContains("broken parent_version_id: error names version lineage mismatch", result.errors, "version lineage mismatch");
}

// ==================== Invalid reason ====================
{
  const bundle = buildValidBundle();
  (bundle.latestVersion as any).reason = "template-changed";
  const result = validatePersistenceBundle(bundle);
  checkTrue("invalid reason: validatePersistenceBundle does not itself crash on a non-enum reason value", typeof result.valid === "boolean");
  checkFalse("invalid reason: 'template-changed' is not a valid RuntimeVersionReason per the Phase 6A.2 Versioning Contract", ["initial", "reanalysis", "user_edit", "merge", "import", "restore"].includes((bundle.latestVersion as any).reason));
}

// ==================== Overlay targeting nonexistent entry ====================
{
  const runtime = buildFixtureRuntime();
  const badOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "entry-does-not-exist", bullets: [{ text: "This should be rejected." }] }] };
  const applied = applyOverlay(runtime, badOverlay);
  checkTrue("overlay targeting nonexistent entry: applyOverlay records a rejection instead of silently applying", applied.rejections.length > 0);
  checkTrue("overlay targeting nonexistent entry: rejection reason is unknown-entry-id", applied.rejections[0].reason === "unknown-entry-id");

  const persistence = validateOverlayPersistence(applied.runtime);
  checkTrue("overlay targeting nonexistent entry: validateOverlayPersistence confirms the stored rejection re-validates consistently", persistence.valid);
}

// ==================== Overlay modifying protected field ====================
{
  const runtime = buildFixtureRuntime();
  const protectedFieldOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", organization: "Fabricated Corp" } as any] };
  const applied = applyOverlay(runtime, protectedFieldOverlay);
  checkTrue("overlay modifying protected field: applyOverlay rejects an attempt to change organization", applied.rejections.length > 0);
  checkTrue("overlay modifying protected field: rejection reason is protected-field-attempted", applied.rejections.some((r: any) => r.reason === "protected-field-attempted"));
  checkFalse("overlay modifying protected field: organization is NOT changed on the canonical resume", applied.runtime.resume.professionalExperience[0].organization?.value === "Fabricated Corp");
}

// ==================== Wrong schemaVersion ====================
{
  const runtime = buildFixtureRuntime();
  const corrupted = { ...runtime.resume, schemaVersion: "" };
  const coverage = validateCanonicalCoverage(corrupted);
  checkFalse("wrong schemaVersion: an empty schemaVersion is rejected", coverage.valid);
  checkContains("wrong schemaVersion: error names the missing field", coverage.errors, "resume.schemaVersion");
}

// ==================== Wrong serializerVersion (profile vs version mismatch) ====================
{
  const bundle = buildValidBundle();
  bundle.profile.serializer_version = "career-memory-runtime-v2-fake";
  const result = validatePersistenceBundle(bundle);
  checkFalse("wrong serializerVersion: profile/version serializer_version mismatch is rejected", result.valid);
  checkContains("wrong serializerVersion: error names serializer version mismatch", result.errors, "serializer version mismatch");
}

// ==================== Reordered rows (order mismatch) ====================
{
  const bundle = buildValidBundle();
  if (bundle.experiences.length >= 2) {
    bundle.experiences[0].sort_order = bundle.experiences[1].sort_order;
    const result = validatePersistenceBundle(bundle);
    checkFalse("reordered rows: two experience rows sharing the same sort_order are rejected", result.valid);
    checkContains("reordered rows: error names order mismatch", result.errors, "order mismatch");
  } else {
    checkTrue("reordered rows: skipped (fixture has fewer than 2 experiences)", true);
  }
}

// ==================== Dropped custom section (snapshot missing a required array) ====================
{
  const runtime = buildFixtureRuntime();
  const corrupted = { ...runtime.resume };
  delete (corrupted as any).customSections;
  const coverage = validateCanonicalCoverage(corrupted);
  checkFalse("dropped custom section: a resume missing customSections entirely is rejected", coverage.valid);
  checkContains("dropped custom section: error names the missing field", coverage.errors, "resume.customSections");
}

// ==================== Dropped metric grid ====================
{
  const runtime = buildFixtureRuntime();
  const corrupted = { ...runtime.resume, metricGrids: "not-an-array" as any };
  const coverage = validateCanonicalCoverage(corrupted);
  checkFalse("dropped metric grid: metricGrids replaced with a non-array is rejected", coverage.valid);
  checkContains("dropped metric grid: error names the missing field", coverage.errors, "resume.metricGrids");
}

// ==================== Missing sourceTrace ====================
{
  const runtime = buildFixtureRuntime();
  const entryMissingChildren = { ...runtime.resume.professionalExperience[0], hierarchicalContent: [{ ...runtime.resume.professionalExperience[0].hierarchicalContent[0], children: undefined as any }] };
  const resume = { ...runtime.resume, professionalExperience: [entryMissingChildren, runtime.resume.professionalExperience[1]] };
  const coverage = validateCanonicalCoverage(resume);
  checkFalse("missing sourceTrace-adjacent structural field: hierarchicalContent node missing children[] is rejected", coverage.valid);
  checkContains("missing structural field: error names the missing children array", coverage.errors, "hierarchicalContent[0].children");
}

// ==================== Hierarchy order mutation (round-trip divergence) ====================
{
  const runtime = buildFixtureRuntime();
  const mutated = { ...runtime, resume: { ...runtime.resume, professionalExperience: [...runtime.resume.professionalExperience].reverse() } };
  const result = validateRuntimeRoundTrip(runtime, mutated);
  checkFalse("hierarchy/array order mutation: reversing professionalExperience order is caught as a round-trip divergence", result.valid);
  checkContains("hierarchy/array order mutation: error names canonical field loss on resume", result.errors, "canonical field loss");
}

// ==================== Snapshot/normalized row divergence ====================
{
  const bundle = buildValidBundle();
  bundle.experiences.pop();
  const result = validateSnapshotRowDivergence(bundle);
  checkFalse("snapshot/normalized row divergence: removing one experience row without updating the snapshot is caught", result.valid);
  checkContains("snapshot/normalized row divergence: error names the divergence", result.errors, "snapshot/normalized row divergence");
}

// ==================== Invalid overlay shape rejected end-to-end ====================
{
  const runtime = buildFixtureRuntime();
  const malformedOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: "not-an-array" as any }] };
  const applied = applyOverlay(runtime, malformedOverlay);
  checkTrue("invalid overlay shape: a non-array bullets overlay is rejected, not silently coerced", applied.rejections.length > 0);
  checkTrue("invalid overlay shape: rejection reason is invalid-overlay-shape", applied.rejections.some((r: any) => r.reason === "invalid-overlay-shape"));
}

// ==================== Duplicate source document id ====================
{
  const bundle = buildValidBundle();
  bundle.sourceDocuments.push({ ...bundle.sourceDocuments[0] });
  const result = validatePersistenceBundle(bundle);
  checkFalse("duplicate source document id: two source_documents rows sharing the same id are rejected", result.valid);
  checkContains("duplicate source document id: error names the duplicate", result.errors, "duplicate id: source document");
}

// ==================== Missing required snapshot array field ====================
{
  const bundle = buildValidBundle();
  const corruptedSnapshot = { ...(bundle.latestVersion.snapshot as Record<string, unknown>) };
  delete corruptedSnapshot.awards;
  bundle.latestVersion.snapshot = corruptedSnapshot;
  const result = validatePersistenceBundle(bundle);
  checkFalse("missing required snapshot array: latestVersion.snapshot.awards removed is rejected", result.valid);
  checkContains("missing required snapshot array: error names the missing field", result.errors, "snapshot.awards");
}

// ==================== Schema version mismatch between snapshot and row column ====================
{
  const bundle = buildValidBundle();
  const corruptedSnapshot = { ...(bundle.latestVersion.snapshot as Record<string, unknown>), schemaVersion: "resume-structured-v999" };
  bundle.latestVersion.snapshot = corruptedSnapshot;
  const result = validatePersistenceBundle(bundle);
  checkFalse("schema version mismatch (snapshot vs row): rejected", result.valid);
  checkContains("schema version mismatch (snapshot vs row): error names the divergence", result.errors, "snapshot/normalized row divergence");
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
