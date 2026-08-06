/*
  Phase 6C gate test - full Runtime <-> Persistence round-trip. Run
  with `npx tsx lib/careerMemory/persistence/roundTrip.test.ts`. This
  is the PASS-bar test: it proves the snapshot-based reconstruction
  (careerProfileToCanonicalRuntime, fed from a hand-assembled
  persistence bundle) reproduces the exact original CanonicalResumeRuntime,
  using validateRuntimeRoundTrip()'s deterministic comparison - never a
  JSON.stringify-only check, and never AI/semantic similarity.
*/
import { canonicalRuntimeToInsertBundle, careerProfileToCanonicalRuntime, runtimeToCareerTailoredResumeInsertInput } from "./mappers";
import { validateCanonicalCoverage, validateOverlayPersistence, validatePersistenceBundle, validateRuntimeRoundTrip, validateSnapshotRowDivergence } from "./validation";
import { buildFixtureResume, buildFixtureRuntime } from "./testFixtures";
import { applyOverlay } from "../runtime/overlayRuntime";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../runtime/factory";
import type { CareerMemoryPersistenceBundle } from "./bundle";
import type { CanonicalResumeRuntime } from "../runtime/types";

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

/* Assembles a full CareerMemoryPersistenceBundle from a runtime the way
   a real (future Phase 6D) repository layer would after inserting every
   row canonicalRuntimeToInsertBundle() produces - by hand here, no
   Supabase client, no query. */
function assembleBundleFromRuntime(userId: string, profileId: string, runtime: CanonicalResumeRuntime): CareerMemoryPersistenceBundle {
  const insertBundle = canonicalRuntimeToInsertBundle(userId, profileId, runtime);

  const sourceDocuments = runtime.sourceDocuments.map((doc) => ({
    id: doc.id,
    profile_id: profileId,
    storage_bucket: "resume-sources",
    storage_path: `${profileId}/${doc.id}/original.${doc.fileType}`,
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
    profile_id: profileId,
    source_document_id: insertBundle.resumeVersion.source_document_id ?? null,
    parent_version_id: insertBundle.resumeVersion.parent_version_id ?? null,
    reason: insertBundle.resumeVersion.reason,
    snapshot: insertBundle.resumeVersion.snapshot,
    schema_version: insertBundle.resumeVersion.schema_version,
    serializer_version: insertBundle.resumeVersion.serializer_version,
    created_at: insertBundle.resumeVersion.created_at!,
    updated_at: insertBundle.resumeVersion.created_at!,
  };

  const toRow = <T extends Record<string, unknown>>(input: T, index: number, prefix: string) => ({
    ...input,
    id: (input.id as string) ?? `${prefix}-${index}`,
    created_at: "2026-01-01T00:10:00.000Z",
    updated_at: "2026-01-01T00:10:00.000Z",
  });

  const experiences = insertBundle.experiences.map((e, i) => toRow(e, i, "exp") as any);
  const projects = insertBundle.projects.map((p, i) => toRow(p, i, "proj") as any);
  const credentials = insertBundle.credentials.map((c, i) => toRow(c, i, "cred") as any);
  const awards = insertBundle.awards.map((a, i) => toRow(a, i, "award") as any);
  const publications = insertBundle.publications.map((p, i) => toRow(p, i, "pub") as any);

  const tailoredResumes = runtime.overlayState.history.map((record, i) => ({
    id: `tr-${i}`,
    profile_id: profileId,
    application_id: null,
    resume_version_id: latestVersion.id,
    overlay: runtimeToCareerTailoredResumeInsertInput(profileId, record).overlay,
    template_id: null,
    ai_model: null,
    prompt_version: null,
    created_at: `2026-01-06T00:0${i}:00.000Z`,
    updated_at: `2026-01-06T00:0${i}:00.000Z`,
  }));

  return {
    profile: { ...insertBundle.profile, id: profileId, identity: insertBundle.profile.identity ?? {}, summary_text: insertBundle.profile.summary_text ?? null, preferences: insertBundle.profile.preferences ?? {}, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    sourceDocuments,
    latestVersion,
    experiences,
    languages: [],
    projects,
    credentials,
    awards,
    publications,
    tailoredResumes,
  };
}

// ==================== 25. Full Runtime round-trip ====================
{
  const original = buildFixtureRuntime();
  const bundle = assembleBundleFromRuntime("user-1", "profile-1", original);
  const reconstructed = careerProfileToCanonicalRuntime(bundle);

  const roundTrip = validateRuntimeRoundTrip(original, reconstructed);
  checkTrue("full round-trip: validateRuntimeRoundTrip reports valid (0 canonical field loss)", roundTrip.valid);
  check("full round-trip: 0 errors", roundTrip.errors, []);

  check("full round-trip: resume deep-equal", reconstructed.resume, original.resume);
  check("full round-trip: professionalExperience count preserved", reconstructed.resume.professionalExperience.length, original.resume.professionalExperience.length);
  check("full round-trip: hierarchicalContent preserved on exp-acme-ops", reconstructed.resume.professionalExperience[0].hierarchicalContent, original.resume.professionalExperience[0].hierarchicalContent);
  check("full round-trip: education preserved (no child table, snapshot-only)", reconstructed.resume.education, original.resume.education);
  check("full round-trip: customSections preserved (no child table, snapshot-only)", reconstructed.resume.customSections, original.resume.customSections);
  check("full round-trip: metricGrids preserved (no child table, snapshot-only)", reconstructed.resume.metricGrids, original.resume.metricGrids);
  check("full round-trip: skillGroups preserved in order", reconstructed.resume.skillGroups, original.resume.skillGroups);
  check("full round-trip: identity preserved with per-field confidence", reconstructed.resume.identity, original.resume.identity);
  check("full round-trip: validation report preserved", reconstructed.resume.validation, original.resume.validation);
  check("full round-trip: slotAvailability preserved", reconstructed.resume.slotAvailability, original.resume.slotAvailability);

  check("full round-trip: sourceDocuments order preserved", reconstructed.sourceDocuments.map((d) => d.id), original.sourceDocuments.map((d) => d.id));
  check("full round-trip: version.reason preserved", reconstructed.version.reason, original.version.reason);
  check("full round-trip: overlayState.history preserved", reconstructed.overlayState.history, original.overlayState.history);
  check("full round-trip: overlayState.history[0].rejections preserved (empty array)", reconstructed.overlayState.history[0].rejections, []);

  const coverage = validateCanonicalCoverage(reconstructed.resume);
  checkTrue("full round-trip: reconstructed resume passes validateCanonicalCoverage", coverage.valid);
  check("full round-trip: validateCanonicalCoverage 0 errors", coverage.errors, []);

  const bundleValidity = validatePersistenceBundle(bundle);
  checkTrue("full round-trip: assembled bundle passes validatePersistenceBundle", bundleValidity.valid);
  check("full round-trip: validatePersistenceBundle 0 errors", bundleValidity.errors, []);

  const divergence = validateSnapshotRowDivergence(bundle);
  checkTrue("full round-trip: assembled bundle has 0 snapshot/normalized-row divergence", divergence.valid);
}

// ==================== Ordering Contract ====================
{
  const original = buildFixtureRuntime();
  const bundle = assembleBundleFromRuntime("user-1", "profile-1", original);
  const reconstructed = careerProfileToCanonicalRuntime(bundle);

  check("ordering: professionalExperience array order preserved", reconstructed.resume.professionalExperience.map((e) => e.id), original.resume.professionalExperience.map((e) => e.id));
  check("ordering: volunteerExperience array order preserved", reconstructed.resume.volunteerExperience.map((e) => e.id), original.resume.volunteerExperience.map((e) => e.id));
  check("ordering: education array order preserved", reconstructed.resume.education.map((e) => e.id), original.resume.education.map((e) => e.id));
  check("ordering: credentials array order preserved", reconstructed.resume.credentials.map((e) => e.id), original.resume.credentials.map((e) => e.id));
  check("ordering: projects array order preserved", reconstructed.resume.projects.map((e) => e.id), original.resume.projects.map((e) => e.id));
  check("ordering: awards array order preserved", reconstructed.resume.awards.map((e) => e.id), original.resume.awards.map((e) => e.id));
  check("ordering: publications array order preserved", reconstructed.resume.publications.map((e) => e.id), original.resume.publications.map((e) => e.id));
  check("ordering: skillGroups array order preserved", reconstructed.resume.skillGroups.map((g) => g.skills[0]), original.resume.skillGroups.map((g) => g.skills[0]));
  check("ordering: content block order preserved within an entry", reconstructed.resume.professionalExperience[0].content.map((c) => c.id), original.resume.professionalExperience[0].content.map((c) => c.id));
  check("ordering: hierarchical node DFS order preserved (top-level)", reconstructed.resume.professionalExperience[0].hierarchicalContent.map((n) => n.id), original.resume.professionalExperience[0].hierarchicalContent.map((n) => n.id));
  check("ordering: hierarchical node DFS order preserved (nested child)", reconstructed.resume.professionalExperience[0].hierarchicalContent[0].children.map((n) => n.id), original.resume.professionalExperience[0].hierarchicalContent[0].children.map((n) => n.id));
  check("ordering: sourceDocuments order derived via created_at ascending", reconstructed.sourceDocuments.map((d) => d.id), ["doc-1", "doc-2"]);
  check("ordering: overlay application order preserved (1 record, trivially in order)", reconstructed.overlayState.history.map((h) => h.appliedEntryIds), original.overlayState.history.map((h) => h.appliedEntryIds));
}

// ==================== Multiple overlay applications, version lineage ====================
{
  let runtime = buildFixtureRuntime(); // already has 1 overlay applied
  const secondOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-beta-analyst", bullets: [{ text: "Automated the weekly KPI dashboard refresh." }] }] };
  const applied = applyOverlay(runtime, secondOverlay);
  runtime = applied.runtime;

  check("multi-overlay: runtime now has 2 history records", runtime.overlayState.history.length, 2);

  const bundle = assembleBundleFromRuntime("user-1", "profile-2", runtime);
  check("multi-overlay: bundle has 2 tailoredResumes rows (1 per history record)", bundle.tailoredResumes.length, 2);

  const reconstructed = careerProfileToCanonicalRuntime(bundle);
  check("multi-overlay: overlayState.history order preserved after round-trip (created_at ascending)", reconstructed.overlayState.history.map((h) => h.appliedEntryIds), [["exp-acme-ops"], ["exp-beta-analyst"]]);

  const roundTrip = validateRuntimeRoundTrip(runtime, reconstructed);
  checkTrue("multi-overlay: full round-trip still valid with 2 overlay records", roundTrip.valid);
}

// ==================== Bundle row counts + overlay re-validation ====================
{
  const original = buildFixtureRuntime();
  const bundle = assembleBundleFromRuntime("user-1", "profile-1", original);

  check("bundle: experiences row count matches professionalExperience+volunteerExperience", bundle.experiences.length, original.resume.professionalExperience.length + original.resume.volunteerExperience.length);
  check("bundle: projects row count matches resume.projects", bundle.projects.length, original.resume.projects.length);
  check("bundle: credentials row count matches resume.credentials", bundle.credentials.length, original.resume.credentials.length);
  check("bundle: awards row count matches resume.awards", bundle.awards.length, original.resume.awards.length);
  check("bundle: publications row count matches resume.publications", bundle.publications.length, original.resume.publications.length);
  check("bundle: sourceDocuments row count matches runtime.sourceDocuments", bundle.sourceDocuments.length, original.sourceDocuments.length);
  check("bundle: tailoredResumes row count matches overlayState.history", bundle.tailoredResumes.length, original.overlayState.history.length);

  const reconstructed = careerProfileToCanonicalRuntime(bundle);
  const overlayCheck = validateOverlayPersistence(reconstructed);
  checkTrue("reconstructed runtime's overlay history passes validateOverlayPersistence", overlayCheck.valid);
}

// ==================== Empty overlay history round-trip (no overlays ever applied) ====================
{
  const resume = buildFixtureResume();
  const noOverlayRuntime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id: "version-noop", reason: "initial", createdAt: "2026-02-01T00:00:00.000Z" }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion, serializerVersion: "career-memory-runtime-v1" }),
    sourceDocuments: [],
    overlayState: createRuntimeOverlayState(),
  });

  const bundle = assembleBundleFromRuntime("user-2", "profile-3", noOverlayRuntime);
  check("empty overlay history: bundle has 0 tailoredResumes rows", bundle.tailoredResumes.length, 0);
  check("empty overlay history: bundle has 0 sourceDocuments rows", bundle.sourceDocuments.length, 0);

  const reconstructed = careerProfileToCanonicalRuntime(bundle);
  check("empty overlay history: reconstructed overlayState.history is an empty array, not undefined", reconstructed.overlayState.history, []);
  check("empty overlay history: reconstructed sourceDocuments is an empty array", reconstructed.sourceDocuments, []);
  check("empty overlay history: reconstructed metadata.parserVersion is undefined (no linked source document)", reconstructed.metadata.parserVersion, undefined);

  const roundTrip = validateRuntimeRoundTrip(noOverlayRuntime, reconstructed);
  checkTrue("empty overlay history: full round-trip still valid with 0 source documents and 0 overlays", roundTrip.valid);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
