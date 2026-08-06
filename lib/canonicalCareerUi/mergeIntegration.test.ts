/*
  Phase 6E - "Repository Integration" test category: a full round trip
  through the REAL internal API (save two versions, restore, compare,
  detect conflicts, compute a merge preview, then persist the merge as
  a new version) chained together exactly as the actual UI pages do it -
  Version Browser -> Version Compare -> Merge Wizard -> Conflict
  Resolver -> save back through POST /versions. Nothing here is a
  standalone unit test; every step depends on the REAL response of the
  previous one, via the same real route handlers used throughout this
  test suite (testSupport/routeFetch.ts).

  Run with `npx tsx lib/canonicalCareerUi/mergeIntegration.test.ts`.
*/
import * as api from "./apiClient";
import { freshRouteFetch } from "./testSupport/routeFetch";
import { buildFixtureRuntime } from "../careerMemory/persistence/testFixtures";
import { compareResumeVersions } from "./versionCompare";
import { detectAllConflicts } from "./conflictDetection";
import { computeMergePreview } from "./mergeWizard";
import type { CanonicalResumeRuntime, ResumeStructuredModel, MergePlan } from "./types";

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

function pristineRuntime(): CanonicalResumeRuntime {
  const runtime = buildFixtureRuntime();
  return { ...runtime, sourceDocuments: [], overlayState: { history: [] } };
}

async function main() {
  const { fetchImpl } = freshRouteFetch("user-merge-integration-1");
  await api.createProfile({ schemaVersion: "resume-structured-v1" }, fetchImpl);
  const profile = await api.getProfile(fetchImpl);

  /* ---------------- Step 1: save the base version through the REAL API ---------------- */
  const baseSave = await api.saveVersion({ runtime: pristineRuntime() }, api.newIdempotencyKey(), fetchImpl);
  checkTrue("integration: base version saved with a real id", typeof baseSave.version.id === "string" && baseSave.version.id.length > 0);

  /* ---------------- Step 2: save a genuinely different "incoming" version ---------------- */
  const incomingRuntime = pristineRuntime();
  incomingRuntime.resume = {
    ...incomingRuntime.resume,
    professionalExperience: incomingRuntime.resume.professionalExperience.map((e) =>
      e.id === "exp-acme-ops" ? { ...e, role: { ...e.role!, value: "Director of Operations" }, dateRangeText: { ...e.dateRangeText!, value: "Jan 2020 - Aug 2023" } } : e
    ),
  };
  const incomingSave = await api.saveVersion({ runtime: incomingRuntime, expectedCurrentVersionId: baseSave.version.id }, api.newIdempotencyKey(), fetchImpl);
  checkTrue("integration: incoming version saved as a distinct id", incomingSave.version.id !== baseSave.version.id);
  check("integration: incoming version's parent is the base version", incomingSave.version.parent_version_id, baseSave.version.id);

  /* ---------------- Step 3: fetch both back through GET /versions/[id] (Version Compare's real data source) ---------------- */
  const fetchedBase = await api.getVersion(profile!.id, baseSave.version.id, fetchImpl);
  const fetchedIncoming = await api.getVersion(profile!.id, incomingSave.version.id, fetchImpl);
  check("integration: fetched base snapshot round-trips the schemaVersion", (fetchedBase.snapshot as unknown as ResumeStructuredModel).schemaVersion, incomingRuntime.resume.schemaVersion);

  /* ---------------- Step 4: real version compare on the REAL fetched snapshots ---------------- */
  const diff = compareResumeVersions(
    fetchedBase.id,
    fetchedIncoming.id,
    fetchedBase.snapshot as unknown as ResumeStructuredModel,
    fetchedIncoming.snapshot as unknown as ResumeStructuredModel
  );
  checkTrue("integration: compare detects the role/date change on exp-acme-ops", diff.rows.some((r) => r.label === "Acme Manufacturing" && r.change === "changed"));
  check("integration: exactly 1 changed row (only exp-acme-ops was edited)", diff.changedCount, 1);
  check("integration: 0 added/removed rows (both sides have identical id sets)", diff.addedCount + diff.removedCount, 0);

  /* ---------------- Step 5: conflict detection against the SAME two real snapshots ---------------- */
  const conflicts = detectAllConflicts(fetchedBase.snapshot as unknown as ResumeStructuredModel, fetchedIncoming.snapshot as unknown as ResumeStructuredModel);
  check("integration: same-id edits are NOT flagged as conflicts (conflicts require different ids)", conflicts.length, 0);

  /* ---------------- Step 6: merge preview with a real selection, then persist through the REAL save API ---------------- */
  const plan: MergePlan = {
    baseVersionId: fetchedBase.id,
    incomingVersionId: fetchedIncoming.id,
    selections: [{ section: "professionalExperience", itemId: "exp-acme-ops", choice: "take-incoming" }],
    resolutions: [],
  };
  const preview = computeMergePreview(fetchedBase.snapshot as unknown as ResumeStructuredModel, fetchedIncoming.snapshot as unknown as ResumeStructuredModel, plan);
  check("integration: merge preview picked the incoming role for exp-acme-ops", preview.resume.professionalExperience.find((e) => e.id === "exp-acme-ops")?.role?.value, "Director of Operations");

  const latestBeforeMerge = await api.listVersions(profile!.id, fetchImpl);
  const currentLatest = latestBeforeMerge.reduce((acc, v) => (new Date(v.created_at) > new Date(acc.created_at) ? v : acc));

  const mergeSave = await api.saveVersion(
    {
      runtime: {
        resume: preview.resume,
        metadata: { schemaVersion: preview.resume.schemaVersion, serializerVersion: "career-memory-runtime-v1" },
        version: { id: "pending", reason: "merge", createdAt: new Date(0).toISOString() },
        sourceDocuments: [],
        serializerVersion: "career-memory-runtime-v1",
        overlayState: { history: [] },
      },
      expectedCurrentVersionId: currentLatest.id,
    },
    api.newIdempotencyKey(),
    fetchImpl
  );
  check("integration: the merge was saved with reason 'merge'", mergeSave.version.reason, "merge");
  checkTrue("integration: the merge produced a brand-new version id", mergeSave.version.id !== baseSave.version.id && mergeSave.version.id !== incomingSave.version.id);

  /* ---------------- Step 7: fetch the merged version back and confirm the merged content survived the round trip ---------------- */
  const fetchedMerged = await api.getVersion(profile!.id, mergeSave.version.id, fetchImpl);
  const mergedResume = fetchedMerged.snapshot as unknown as ResumeStructuredModel;
  check("integration: the saved+refetched merge still has the incoming role", mergedResume.professionalExperience.find((e) => e.id === "exp-acme-ops")?.role?.value, "Director of Operations");

  const finalList = await api.listVersions(profile!.id, fetchImpl);
  check("integration: version history now has exactly 3 entries (base, incoming, merge)", finalList.length, 3);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("mergeIntegration.test.ts CRASHED:", e);
  process.exit(1);
});
