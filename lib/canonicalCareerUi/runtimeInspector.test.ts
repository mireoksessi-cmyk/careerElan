/*
  Phase 6E - "Runtime Inspector" test category. Run with
  `npx tsx lib/canonicalCareerUi/runtimeInspector.test.ts`.
*/
import { buildRuntimeInspectorSummary, buildRuntimeJsonPreview } from "./runtimeInspector";
import { buildFixtureRuntime, buildFixtureResume } from "../careerMemory/persistence/testFixtures";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeVersion, createRuntimeOverlayState } from "../careerMemory/runtime/factory";

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

function main() {
  const runtime = buildFixtureRuntime();
  const summary = buildRuntimeInspectorSummary(runtime);

  check("inspector: schemaVersion matches runtime.metadata.schemaVersion", summary.schemaVersion, runtime.metadata.schemaVersion);
  check("inspector: serializerVersion matches runtime.metadata.serializerVersion", summary.serializerVersion, runtime.metadata.serializerVersion);
  check("inspector: runtimeSerializerVersion matches runtime.serializerVersion", summary.runtimeSerializerVersion, runtime.serializerVersion);
  check("inspector: versionId matches runtime.version.id", summary.versionId, runtime.version.id);
  check("inspector: versionReason matches runtime.version.reason", summary.versionReason, runtime.version.reason);
  check("inspector: parentVersionId matches runtime.version.parentVersionId", summary.parentVersionId, runtime.version.parentVersionId);
  check("inspector: overlayCount matches runtime.overlayState.history.length", summary.overlayCount, runtime.overlayState.history.length);
  checkTrue("inspector: overlayCount is at least 1 (fixture applies one overlay)", summary.overlayCount >= 1);
  check("inspector: sourceDocumentCount matches runtime.sourceDocuments.length", summary.sourceDocumentCount, runtime.sourceDocuments.length);
  check("inspector: sourceDocumentCount is 2 (fixture has doc-1 and doc-2)", summary.sourceDocumentCount, 2);
  check("inspector: validationPassed matches runtime.resume.validation.passed", summary.validationPassed, runtime.resume.validation.passed);
  check("inspector: validationWarningCount matches runtime.resume.validation.warnings.length", summary.validationWarningCount, runtime.resume.validation.warnings.length);

  check("inspector: entryCounts.professionalExperience matches actual array length", summary.entryCounts.professionalExperience, runtime.resume.professionalExperience.length);
  check("inspector: entryCounts.volunteerExperience matches actual array length", summary.entryCounts.volunteerExperience, runtime.resume.volunteerExperience.length);
  check("inspector: entryCounts.education matches actual array length", summary.entryCounts.education, runtime.resume.education.length);
  check("inspector: entryCounts.projects matches actual array length", summary.entryCounts.projects, runtime.resume.projects.length);
  check("inspector: entryCounts.credentials matches actual array length", summary.entryCounts.credentials, runtime.resume.credentials.length);

  const jsonPreview = buildRuntimeJsonPreview(runtime);
  checkTrue("json preview: is valid JSON", (() => {
    try {
      JSON.parse(jsonPreview);
      return true;
    } catch {
      return false;
    }
  })());
  check("json preview: round-trips back to an equivalent runtime object", JSON.parse(jsonPreview), JSON.parse(JSON.stringify(runtime)));
  checkTrue("json preview: contains the version id verbatim (readonly, not redacted)", jsonPreview.includes(runtime.version.id));
  checkTrue("json preview: is pretty-printed (contains newlines)", jsonPreview.includes("\n"));

  check("inspector: entryCounts has exactly the 5 expected section keys", Object.keys(summary.entryCounts).sort(), ["credentials", "education", "professionalExperience", "projects", "volunteerExperience"].sort());

  /* ---------------- bare runtime: 0 overlays, 0 source documents ---------------- */
  {
    const resume = buildFixtureResume();
    const bareRuntime = createCanonicalRuntime({
      resume,
      version: createRuntimeVersion({ id: "v-bare", reason: "initial", createdAt: "2026-01-01T00:00:00.000Z" }),
      metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
      sourceDocuments: [],
      overlayState: createRuntimeOverlayState(),
    });
    const bareSummary = buildRuntimeInspectorSummary(bareRuntime);
    check("bare: overlayCount is 0 with no overlay history", bareSummary.overlayCount, 0);
    check("bare: sourceDocumentCount is 0 with no source documents", bareSummary.sourceDocumentCount, 0);
    check("bare: parentVersionId is undefined for a root version", bareSummary.parentVersionId, undefined);
    check("bare: versionReason reflects the constructed version", bareSummary.versionReason, "initial");

    const bareJson = buildRuntimeJsonPreview(bareRuntime);
    checkTrue("bare: JSON preview of a bare runtime is still valid JSON", (() => {
      try {
        JSON.parse(bareJson);
        return true;
      } catch {
        return false;
      }
    })());
  }

  /* ---------------- a runtime whose version has a parent ---------------- */
  {
    const resume = buildFixtureResume();
    const childRuntime = createCanonicalRuntime({
      resume,
      version: createRuntimeVersion({ id: "v-child", reason: "restore", createdAt: "2026-01-02T00:00:00.000Z", parentVersionId: "v-parent" }),
      metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
      sourceDocuments: [],
      overlayState: createRuntimeOverlayState(),
    });
    const childSummary = buildRuntimeInspectorSummary(childRuntime);
    check("child version: parentVersionId is carried through", childSummary.parentVersionId, "v-parent");
    check("child version: versionReason is 'restore'", childSummary.versionReason, "restore");
  }

  /* ---------------- multiple source documents + multiple overlay history entries ---------------- */
  {
    const resume = buildFixtureResume();
    const multiRuntime = createCanonicalRuntime({
      resume,
      version: createRuntimeVersion({ id: "v-multi", reason: "reanalysis", createdAt: "2026-02-01T00:00:00.000Z" }),
      metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
      sourceDocuments: [
        { id: "doc-a", fileName: "a.pdf", fileType: "pdf", addedAt: "2026-01-01T00:00:00.000Z" },
        { id: "doc-b", fileName: "b.docx", fileType: "docx", addedAt: "2026-01-02T00:00:00.000Z" },
        { id: "doc-c", fileName: "c.pdf", fileType: "pdf", addedAt: "2026-01-03T00:00:00.000Z" },
      ],
      overlayState: {
        history: [
          { overlay: { schemaVersion: "resume-structured-v1", entries: [] }, appliedEntryIds: [], rejections: [] },
          { overlay: { schemaVersion: "resume-structured-v1", professionalSummaryText: "x" }, appliedEntryIds: [], rejections: [] },
        ],
      },
    });
    const multiSummary = buildRuntimeInspectorSummary(multiRuntime);
    check("multi: sourceDocumentCount reflects all 3 registered documents", multiSummary.sourceDocumentCount, 3);
    check("multi: overlayCount reflects both history entries", multiSummary.overlayCount, 2);
    check("multi: versionReason is 'reanalysis'", multiSummary.versionReason, "reanalysis");

    const multiJson = buildRuntimeJsonPreview(multiRuntime);
    checkTrue("multi: JSON preview includes all 3 source document ids", ["doc-a", "doc-b", "doc-c"].every((id) => multiJson.includes(id)));
  }

  /* ---------------- every RuntimeVersionReason value round-trips through the summary ---------------- */
  {
    const resume = buildFixtureResume();
    const reasons = ["initial", "reanalysis", "user_edit", "merge", "import", "restore"] as const;
    for (const reason of reasons) {
      const runtime = createCanonicalRuntime({
        resume,
        version: createRuntimeVersion({ id: `v-${reason}`, reason, createdAt: "2026-01-01T00:00:00.000Z" }),
        metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
        sourceDocuments: [],
        overlayState: createRuntimeOverlayState(),
      });
      check(`reason round-trip: '${reason}' is preserved verbatim in the summary`, buildRuntimeInspectorSummary(runtime).versionReason, reason);
    }
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
