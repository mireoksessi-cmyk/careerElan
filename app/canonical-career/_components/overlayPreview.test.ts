/*
  Phase 6E - "Overlay" test category for the Overlay Viewer's preview
  helper (spec section 11: Canonical Resume -> Overlay -> result
  Preview). Exercises previewOverlay() against the REAL Runtime Layer
  (createCanonicalRuntime/applyOverlay/resolveTailoredResume - none of
  it reimplemented here). Run with
  `npx tsx app/canonical-career/_components/overlayPreview.test.ts`.
*/
import { previewOverlay } from "./overlayPreview";
import { buildFixtureResume } from "../../../lib/careerMemory/persistence/testFixtures";

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
  const resume = buildFixtureResume();

  /* ---------------- valid overlay: bullet rewrite ---------------- */
  {
    const overlay = {
      schemaVersion: "resume-structured-v1",
      entries: [{ entryId: "exp-acme-ops", bullets: [{ id: "exp-acme-ops-b1", text: "Rewrote this bullet for a target role." }] }],
    };
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: exactly 1 applied entry", result.appliedEntryIds.length, 1);
    check("preview: applied entry is exp-acme-ops", result.appliedEntryIds[0], "exp-acme-ops");
    check("preview: 0 rejections for a valid overlay", result.rejections.length, 0);
    const acme = result.tailored.professionalExperience.find((e) => e.id === "exp-acme-ops");
    check("preview: bullet text was actually rewritten", acme?.bullets.find((b) => b.id === "exp-acme-ops-b1")?.text, "Rewrote this bullet for a target role.");
    checkTrue("preview: the ORIGINAL resume object is not mutated", resume.professionalExperience.find((e) => e.id === "exp-acme-ops")!.bullets[0].text !== "Rewrote this bullet for a target role.");
  }

  /* ---------------- valid overlay: additional bullet (no id -> appended) ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "A brand-new tailored bullet." }] }] };
    const before = resume.professionalExperience.find((e) => e.id === "exp-acme-ops")!.bullets.length;
    const result = previewOverlay(resume, "version-1", overlay);
    const after = result.tailored.professionalExperience.find((e) => e.id === "exp-acme-ops")!.bullets.length;
    check("preview: appending a bullet with no id increases the bullet count by 1", after, before + 1);
  }

  /* ---------------- valid overlay: professional summary override ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", professionalSummaryText: "A tailored one-line summary for this role." };
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: professionalSummary.text reflects the override", result.tailored.professionalSummary?.text, "A tailored one-line summary for this role.");
    check("preview: no entries applied when only the summary is overlaid", result.appliedEntryIds.length, 0);
  }

  /* ---------------- protected fields cannot be overlaid (rejected, not silently applied) ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", organization: "A Different Company" } as unknown as { entryId: string }] };
    const result = previewOverlay(resume, "version-1", overlay);
    checkTrue("preview: an overlay attempting a protected field is rejected", result.rejections.length >= 1);
    check("preview: rejection reason is protected-field-attempted", result.rejections[0]?.reason, "protected-field-attempted");
    const acme = result.tailored.professionalExperience.find((e) => e.id === "exp-acme-ops");
    check("preview: organization is UNCHANGED despite the attempted overlay", acme?.organization?.value, "Acme Manufacturing");
  }

  /* ---------------- unknown entryId is rejected, never invents a new entry ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "entry-that-does-not-exist", bullets: [{ text: "x" }] }] };
    const beforeCount = resume.professionalExperience.length;
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: unknown entryId produces a rejection", result.rejections[0]?.reason, "unknown-entry-id");
    check("preview: no new entry was invented", result.tailored.professionalExperience.length, beforeCount);
  }

  /* ---------------- invalid overlay shape ---------------- */
  {
    const result = previewOverlay(resume, "version-1", { not: "a valid overlay shape" });
    checkTrue("preview: an unrecognized top-level shape is rejected, not crashed on", result.rejections.length >= 1);
  }

  /* ---------------- empty overlay: no-op, no rejections ---------------- */
  {
    const result = previewOverlay(resume, "version-1", { schemaVersion: "resume-structured-v1" });
    check("preview: an empty overlay applies 0 entries", result.appliedEntryIds.length, 0);
    check("preview: an empty overlay has 0 rejections", result.rejections.length, 0);
    check("preview: an empty overlay leaves the resume identical", JSON.stringify(result.tailored), JSON.stringify(resume));
  }

  /* ---------------- multiple entries overlaid in a single call ---------------- */
  {
    const overlay = {
      schemaVersion: "resume-structured-v1",
      entries: [
        { entryId: "exp-acme-ops", bullets: [{ id: "exp-acme-ops-b1", text: "Bullet 1 rewritten." }] },
        { entryId: "exp-beta-analyst", bullets: [{ id: "exp-beta-analyst-b1", text: "Bullet 2 rewritten." }] },
      ],
    };
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: 2 entries overlaid in one call -> 2 applied entries", result.appliedEntryIds.length, 2);
    checkTrue("preview: both target entry ids are present in appliedEntryIds", result.appliedEntryIds.includes("exp-acme-ops") && result.appliedEntryIds.includes("exp-beta-analyst"));
  }

  /* ---------------- a mix of one valid and one invalid entry: valid one still applies ---------------- */
  {
    const overlay = {
      schemaVersion: "resume-structured-v1",
      entries: [
        { entryId: "exp-acme-ops", bullets: [{ text: "A valid tailored bullet." }] },
        { entryId: "does-not-exist", bullets: [{ text: "x" }] },
      ],
    };
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: the valid entry is still applied even when a sibling entry is invalid", result.appliedEntryIds, ["exp-acme-ops"]);
    check("preview: exactly 1 rejection for the invalid sibling", result.rejections.length, 1);
  }

  /* ---------------- resumeVersionId does not affect the resulting tailored content ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", professionalSummaryText: "Same overlay, different version id." };
    const resultA = previewOverlay(resume, "version-A", overlay);
    const resultB = previewOverlay(resume, "version-B", overlay);
    check("preview: the SAME overlay applied against two different versionIds produces the SAME tailored content", JSON.stringify(resultA.tailored), JSON.stringify(resultB.tailored));
  }

  /* ---------------- overlaying a bullet by its existing id rewrites it in-place (does not append a duplicate) ---------------- */
  {
    const acme = resume.professionalExperience.find((e) => e.id === "exp-acme-ops")!;
    const before = acme.bullets.length;
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: [{ id: "exp-acme-ops-b2", text: "Rewritten second bullet." }] }] };
    const result = previewOverlay(resume, "version-1", overlay);
    const after = result.tailored.professionalExperience.find((e) => e.id === "exp-acme-ops")!.bullets;
    check("preview: rewriting an existing bullet by id does not change the bullet COUNT", after.length, before);
    check("preview: the rewritten bullet's text is updated", after.find((b) => b.id === "exp-acme-ops-b2")?.text, "Rewritten second bullet.");
  }

  /* ---------------- other, untouched entries are byte-identical after a targeted overlay ---------------- */
  {
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "Only this entry changes." }] }] };
    const result = previewOverlay(resume, "version-1", overlay);
    const untouchedBefore = resume.professionalExperience.find((e) => e.id === "exp-beta-analyst");
    const untouchedAfter = result.tailored.professionalExperience.find((e) => e.id === "exp-beta-analyst");
    check("preview: an entry NOT named in the overlay is byte-identical in the tailored output", JSON.stringify(untouchedAfter), JSON.stringify(untouchedBefore));
  }

  /* ---------------- overlaying a project entry is in scope (professionalExperience/volunteerExperience/projects all support overlays) ---------------- */
  {
    const project = resume.projects[0];
    const before = project.bullets.length;
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: project.id, bullets: [{ text: "A tailored project bullet." }] }] };
    const result = previewOverlay(resume, "version-1", overlay);
    check("preview: overlaying a project entry succeeds (projects support overlays, same as experience)", result.rejections.length, 0);
    checkTrue("preview: the project entry id appears in appliedEntryIds", result.appliedEntryIds.includes(project.id));
    check("preview: the project's bullet count increased by 1 (appended, no id match)", result.tailored.projects.find((p) => p.id === project.id)?.bullets.length, before + 1);
  }

  /* ---------------- overlaying a CREDENTIAL entry (out of scope - no bullets field) is rejected as unknown-entry-id ---------------- */
  {
    const credential = resume.credentials[0];
    const overlay = { schemaVersion: "resume-structured-v1", entries: [{ entryId: credential.id, bullets: [{ text: "Attempted credential overlay." }] }] };
    const result = previewOverlay(resume, "version-1", overlay);
    checkTrue("preview: overlaying a credential entry id (credentials have no bullets field, genuinely out of scope) is rejected", result.rejections.some((r) => r.reason === "unknown-entry-id"));
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
