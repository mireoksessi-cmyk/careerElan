/*
  Phase 6D gate test - service layer behavior. Run with
  `npx tsx lib/careerMemory/services/services.test.ts`. Every scenario
  is built from buildSeededScenario()/createBareScenario() (fake
  in-memory client) - no real Supabase client anywhere in this file.
*/
import { buildSeededScenario, createBareScenario } from "../repositories/testSupport/scenario";
import { CanonicalCareerMemoryService } from "./canonicalCareerMemoryService";
import { CanonicalResumeVersionService } from "./canonicalResumeVersionService";
import { CanonicalOverlayService } from "./canonicalOverlayService";
import { CanonicalSourceDocumentService } from "./canonicalSourceDocumentService";
import { CanonicalUserEditService } from "./canonicalUserEditService";
import { CanonicalGeneratedDocumentService } from "./canonicalGeneratedDocumentService";
import { ConflictError, NotFoundError, SchemaGapError, ValidationError } from "../errors/domainErrors";
import { buildFixtureRuntime } from "../persistence/testFixtures";
import { validateCanonicalCoverage } from "../persistence/validation";
import type { CanonicalResumeRuntime } from "../runtime/types";

/*
  The canonical save workflow's own step 6 ("source document
  relationship check") requires any sourceDocumentId a runtime
  references to already be a registered career_source_documents row for
  that profile - buildFixtureRuntime()'s own sourceDocuments (doc-1/
  doc-2) are Phase 6C fixture data, not pre-registered rows in a fresh
  bare scenario. Also strips overlayState.history: buildFixtureRuntime()
  has one overlay already applied (Phase 6C's own fixture), but
  saveCanonicalRuntime() never persists overlays as part of a canonical
  save ("tailored overlay 저장 금지" - §8) - a full round-trip
  comparison against a runtime that HAS overlay history would correctly
  fail (nothing was ever written to career_tailored_resumes), so tests
  that only care about the resume-content round-trip start from a
  pristine (no source docs, no overlay history) runtime.
*/
function pristineCanonicalRuntime(runtime: CanonicalResumeRuntime): CanonicalResumeRuntime {
  return { ...runtime, sourceDocuments: [], overlayState: { history: [] } };
}

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
async function expectThrows(label: string, fn: () => Promise<unknown>, ctor: new (...args: never[]) => Error) {
  try {
    await fn();
    check(label, "did not throw", `${ctor.name} thrown`);
  } catch (e) {
    checkTrue(label, e instanceof ctor);
  }
}

async function main() {
  // ==================== 9. Canonical save workflow (full E2E via fake client) ====================
  {
    const { repos, userId } = createBareScenario("save-user-1");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());

    const result = await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
    checkTrue("canonical save: round-trip valid", result.roundTripValid);
    check("canonical save: version.reason preserved", result.version.reason, runtime.version.reason);

    const fetched = await service.getCanonicalRuntime(userId);
    check("canonical save: getCanonicalRuntime reconstructs the same resume", fetched?.resume, runtime.resume);
    check("canonical save: professionalExperience count matches", fetched?.resume.professionalExperience.length, runtime.resume.professionalExperience.length);
  }

  // ==================== 10. Normalized rows replacement ====================
  {
    const { repos, userId } = createBareScenario("save-user-2");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });

    const profile = await repos.profiles.getByUserId(userId);
    const firstExperiences = await repos.experiences.listByProfileId(profile!.id);
    check("normalized rows: first save creates experience rows", firstExperiences.length, runtime.resume.professionalExperience.length + runtime.resume.volunteerExperience.length);

    // Second save with fewer experiences - a REAL caller always mints a
    // fresh version.id for a genuinely new version (never reuses the
    // prior save's id - reusing it would self-reference as its own
    // parent, which validatePersistenceBundle correctly rejects).
    const trimmedRuntime = { ...runtime, version: { ...runtime.version, id: "version-reanalysis-1" }, resume: { ...runtime.resume, professionalExperience: [runtime.resume.professionalExperience[0]] } };
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime: trimmedRuntime, expectedCurrentVersionId: (await repos.resumeVersions.getLatestByProfileId(profile!.id))?.id });

    const secondExperiences = await repos.experiences.listByProfileId(profile!.id);
    check("normalized rows: second save fully replaces (no leftover rows from first save)", secondExperiences.length, 1 + runtime.resume.volunteerExperience.length);
  }

  // ==================== 8. Version optimistic conflict ====================
  {
    const { repos, userId } = createBareScenario("save-user-3");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });

    await expectThrows("optimistic concurrency: stale expectedCurrentVersionId rejected", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime, expectedCurrentVersionId: "wrong-version-id" }), ConflictError);

    await expectThrows("optimistic concurrency: expecting null when a version already exists is rejected", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime, expectedCurrentVersionId: null }), ConflictError);
  }

  // ==================== 1. Runtime validation (canonical save workflow step 1) ====================
  {
    const { repos, userId } = createBareScenario("save-user-4");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    const corrupted = { ...runtime, resume: { ...runtime.resume, professionalExperience: "not-an-array" as never } };
    await expectThrows("canonical save: invalid runtime.resume rejected before any write", () => service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime: corrupted }), ValidationError);

    const profile = await repos.profiles.getByUserId(userId);
    check("canonical save: rejected runtime never created a profile", profile, null);
  }

  // ==================== 6. Version create/list/latest via CanonicalResumeVersionService ====================
  {
    const scenario = await buildSeededScenario("version-user-1");
    const service = new CanonicalResumeVersionService(scenario.repos);
    const versions = await service.listVersions(scenario.userId, scenario.profileId);
    check("version service: listVersions returns the seeded version", versions.length, 1);

    const fetched = await service.getVersion(scenario.userId, scenario.profileId, versions[0].id);
    check("version service: getVersion returns the exact row", fetched.id, versions[0].id);
  }

  // ==================== 7. Version restore ====================
  {
    const scenario = await buildSeededScenario("version-user-2");
    const service = new CanonicalResumeVersionService(scenario.repos);
    const versionsBefore = await service.listVersions(scenario.userId, scenario.profileId);
    const original = versionsBefore[0];

    const restoreResult = await service.restoreVersion(scenario.userId, scenario.profileId, original.id);
    check("version restore: restoredFromVersionId matches the target", restoreResult.restoredFromVersionId, original.id);
    check("version restore: new version's parentVersionId is the pre-restore latest", restoreResult.newVersion.parent_version_id, original.id);
    check("version restore: reason is 'restore'", restoreResult.newVersion.reason, "restore");
    check("version restore: snapshot copied verbatim from the target", restoreResult.newVersion.snapshot, original.snapshot);
    checkTrue("version restore: new version has a different id than the original", restoreResult.newVersion.id !== original.id);

    const versionsAfter = await service.listVersions(scenario.userId, scenario.profileId);
    check("version restore: profile now has 2 versions", versionsAfter.length, 2);
  }

  // ==================== version deletion policy ====================
  {
    const scenario = await buildSeededScenario("version-user-3");
    const service = new CanonicalResumeVersionService(scenario.repos);
    const versions = await service.listVersions(scenario.userId, scenario.profileId);

    await expectThrows("version delete: cannot delete a profile's only version", () => service.deleteVersion(scenario.userId, scenario.profileId, versions[0].id), ValidationError);

    await service.restoreVersion(scenario.userId, scenario.profileId, versions[0].id);
    const afterRestore = await service.listVersions(scenario.userId, scenario.profileId);
    const latest = afterRestore.find((v) => v.parent_version_id === versions[0].id)!;

    await expectThrows("version delete: cannot delete the latest version", () => service.deleteVersion(scenario.userId, scenario.profileId, latest.id), ConflictError);

    await expectThrows("version delete: cannot delete a version another version references as parent", () => service.deleteVersion(scenario.userId, scenario.profileId, versions[0].id), SchemaGapError);
  }

  // ==================== 12/13. Overlay create/list/delete + protected rejection ====================
  {
    const scenario = await buildSeededScenario("overlay-user-1");
    const service = new CanonicalOverlayService(scenario.repos);

    const goodOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "Tailored bullet for this job." }] }] };
    const created = await service.createOverlay(scenario.userId, { profileId: scenario.profileId, overlay: goodOverlay });
    check("overlay create: appliedEntryIds includes the tailored entry", created.appliedEntryIds, ["exp-acme-ops"]);
    check("overlay create: 0 rejections for a valid overlay", created.rejections.length, 0);

    const listed = await service.listOverlays(scenario.userId, scenario.profileId);
    check("overlay list: returns the created row", listed.length, 1);

    const protectedFieldOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", organization: "Fabricated Corp" } as never] };
    const rejected = await service.createOverlay(scenario.userId, { profileId: scenario.profileId, overlay: protectedFieldOverlay });
    checkTrue("overlay protected-field rejection: at least 1 rejection recorded", rejected.rejections.length > 0);
    check("overlay protected-field rejection: reason is protected-field-attempted", rejected.rejections[0].reason, "protected-field-attempted");

    const nonexistentEntryOverlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "no-such-entry", bullets: [{ text: "x" }] }] };
    const rejected2 = await service.createOverlay(scenario.userId, { profileId: scenario.profileId, overlay: nonexistentEntryOverlay });
    check("overlay nonexistent-entry rejection: reason is unknown-entry-id", rejected2.rejections[0].reason, "unknown-entry-id");

    await service.deleteOverlay(scenario.userId, scenario.profileId, created.row.id);
    const afterDelete = await service.listOverlays(scenario.userId, scenario.profileId);
    check("overlay delete: row removed", afterDelete.length, 2);
  }

  // ==================== overlay resolveTailoredView ====================
  {
    const scenario = await buildSeededScenario("overlay-user-2");
    const service = new CanonicalOverlayService(scenario.repos);
    const overlay = { schemaVersion: "resume-structured-v1", professionalSummaryText: "Tailored summary for this role." };
    await service.createOverlay(scenario.userId, { profileId: scenario.profileId, overlay });

    const tailoredView = await service.resolveTailoredView(scenario.userId, scenario.profileId);
    check("overlay resolveTailoredView: professionalSummary reflects the overlay", tailoredView.professionalSummary?.text, "Tailored summary for this role.");
  }

  // ==================== 3/4/5. Source document service ====================
  {
    const scenario = await buildSeededScenario("srcdoc-user-1");
    const service = new CanonicalSourceDocumentService(scenario.repos);

    const doc = await service.registerSourceDocument(scenario.userId, { profileId: scenario.profileId, fileName: "resume-v3.pdf", fileType: "pdf", contentHash: "unique-hash-001", storageBucket: "resume-sources", storagePath: "path/to/file.pdf" });
    checkTrue("source document register: creates a row", doc.id.length > 0);

    const retried = await service.registerSourceDocument(scenario.userId, { profileId: scenario.profileId, fileName: "resume-v3.pdf", fileType: "pdf", contentHash: "unique-hash-001", storageBucket: "resume-sources", storagePath: "path/to/file.pdf" });
    check("source document register: idempotent retry returns the SAME row", retried.id, doc.id);

    const updated = await service.updateAnalysisStatus(scenario.userId, scenario.profileId, doc.id, "succeeded");
    check("source document update status: succeeded", updated.analysis_status, "succeeded");

    const found = await service.findByContentHash(scenario.userId, scenario.profileId, "unique-hash-001");
    check("source document findByContentHash: finds the row via service", found?.id, doc.id);
  }

  // ==================== 14. User edit service ====================
  {
    const scenario = await buildSeededScenario("useredit-user-1");
    const service = new CanonicalUserEditService(scenario.repos);

    const edit = await service.recordEdit(scenario.userId, { profileId: scenario.profileId, targetTable: "career_experiences", targetId: "exp-1", fieldPath: "role", previousValue: "Coordinator", newValue: "Senior Coordinator" });
    checkTrue("user edit record: creates a row", edit.id.length > 0);

    const listed = await service.listEdits(scenario.userId, scenario.profileId);
    check("user edit list: returns the created edit", listed.length, 1);

    const forTarget = await service.listEditsForTarget(scenario.userId, scenario.profileId, "career_experiences", "exp-1");
    check("user edit listForTarget: returns the matching edit", forTarget.length, 1);
  }

  // ==================== 15. Generated document service ====================
  {
    const scenario = await buildSeededScenario("gendoc-user-1");
    const overlayService = new CanonicalOverlayService(scenario.repos);
    const overlayResult = await overlayService.createOverlay(scenario.userId, { profileId: scenario.profileId, overlay: { schemaVersion: "resume-structured-v1" } });

    const service = new CanonicalGeneratedDocumentService(scenario.repos);
    const doc = await service.createGeneratedDocument(scenario.userId, { profileId: scenario.profileId, tailoredResumeId: overlayResult.row.id, storageBucket: "generated-resumes", storagePath: "path/resume.pdf", fileType: "pdf" });
    checkTrue("generated document create: creates a row", doc.id.length > 0);

    const listed = await service.listGeneratedDocuments(scenario.userId, scenario.profileId, overlayResult.row.id);
    check("generated document list: returns the created row", listed.length, 1);
  }

  // ==================== 22. Partial failure / transaction rollback (Phase 6D.1 - real RPC transaction, not the old compensating-rollback) ====================
  {
    const { repos, userId, client } = createBareScenario("rollback-user-1");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());

    client.failNextQueryOn("career_credentials", { message: "simulated persistence failure", code: "XXFAIL" });

    let threw = false;
    try {
      await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });
    } catch {
      threw = true;
    }
    checkTrue("transaction rollback: save fails when a mid-workflow step errors", threw);

    const profile = await repos.profiles.getByUserId(userId);
    checkTrue("transaction rollback: profile WAS created before the failing step (not rolled back - profile creation precedes the RPC's own transaction)", profile !== null);

    const versionsAfterFailure = profile ? await repos.resumeVersions.listByProfileId(profile.id) : [];
    check("transaction rollback: the version row inserted inside the RPC's transaction was rolled back with everything else", versionsAfterFailure.length, 0);
  }

  // ==================== 24/25. Unicode/French accents + long URL round-trip via service ====================
  {
    const { repos, userId } = createBareScenario("unicode-user-1");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });

    const fetched = await service.getCanonicalRuntime(userId);
    check("unicode round-trip: identity.fullName accented characters preserved", fetched?.resume.identity?.fullName?.value, runtime.resume.identity?.fullName?.value);
    check("unicode round-trip: customSections French text preserved", fetched?.resume.customSections[0]?.paragraphs[0]?.value, runtime.resume.customSections[0]?.paragraphs[0]?.value);
    check("long URL round-trip: publication urlOrDoi preserved exactly", fetched?.resume.publications[0]?.urlOrDoi?.value, runtime.resume.publications[0]?.urlOrDoi?.value);
  }

  // ==================== 26/27. Hierarchical experience + metric/custom snapshot via service ====================
  {
    const { repos, userId } = createBareScenario("hierarchy-user-1");
    const service = new CanonicalCareerMemoryService(repos);
    const runtime = pristineCanonicalRuntime(buildFixtureRuntime());
    await service.saveCanonicalRuntimeAcknowledgingGap(userId, { runtime });

    const fetched = await service.getCanonicalRuntime(userId);
    check("hierarchical experience round-trip via service", fetched?.resume.professionalExperience[0]?.hierarchicalContent, runtime.resume.professionalExperience[0]?.hierarchicalContent);
    check("metric grid round-trip via service", fetched?.resume.metricGrids, runtime.resume.metricGrids);
    checkTrue("full canonical coverage after service round-trip", validateCanonicalCoverage(fetched!.resume).valid);
  }

  // ==================== NotFoundError coverage for cross-service lookups ====================
  {
    const scenario = await buildSeededScenario("notfound-user-1");
    const versionService = new CanonicalResumeVersionService(scenario.repos);
    await expectThrows("version service: getVersion for unknown id throws NotFoundError", () => versionService.getVersion(scenario.userId, scenario.profileId, "nonexistent-version-id"), NotFoundError);

    const overlayService = new CanonicalOverlayService(scenario.repos);
    await expectThrows("overlay service: deleteOverlay for unknown id throws NotFoundError", () => overlayService.deleteOverlay(scenario.userId, scenario.profileId, "nonexistent-overlay-id"), NotFoundError);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
