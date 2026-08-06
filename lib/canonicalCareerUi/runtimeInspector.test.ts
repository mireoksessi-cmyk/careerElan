/*
  Phase 6E - "Runtime Inspector" test category. Run with
  `npx tsx lib/canonicalCareerUi/runtimeInspector.test.ts`.
*/
import { buildRuntimeInspectorSummary, buildRuntimeJsonPreview } from "./runtimeInspector";
import { buildFixtureRuntime } from "../careerMemory/persistence/testFixtures";

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

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
