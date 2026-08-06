/*
  Phase 6E - "Merge" test category. Run with
  `npx tsx lib/canonicalCareerUi/mergeWizard.test.ts`.
*/
import { computeMergePreview } from "./mergeWizard";
import { buildBaseResume, buildIncomingVariant } from "./testSupport/resumeVariants";
import type { MergePlan } from "./types";

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
  const base = buildBaseResume();
  const incoming = buildIncomingVariant();

  /* ---------------- No selections at all: nothing is auto-merged ---------------- */
  {
    const emptyPlan: MergePlan = { baseVersionId: "v-base", incomingVersionId: "v-incoming", selections: [], resolutions: [] };
    const preview = computeMergePreview(base, incoming, emptyPlan);
    checkTrue("no-selection: every section's totalInPreview is 0 (자동 Merge 금지)", preview.sectionDiffs.every((d) => d.totalInPreview === 0));
    check("no-selection: professionalExperience result is empty", preview.resume.professionalExperience.length, 0);
    checkTrue("no-selection: both conflicts are unresolved", preview.unresolvedConflictIds.length === 2);
  }

  /* ---------------- Partial plan: 2 plain selections + 1 resolved conflict + 1 unresolved conflict ---------------- */
  {
    const plan: MergePlan = {
      baseVersionId: "v-base",
      incomingVersionId: "v-incoming",
      selections: [
        { section: "professionalExperience", itemId: "exp-beta-analyst", choice: "keep-base" },
        { section: "professionalExperience", itemId: "exp-gamma-new", choice: "take-incoming" },
      ],
      resolutions: [{ conflictId: "experience:exp-acme-ops:exp-acme-ops-conflict", choice: "both" }],
    };
    const preview = computeMergePreview(base, incoming, plan);

    const expDiff = preview.sectionDiffs.find((d) => d.section === "professionalExperience")!;
    check("partial: professionalExperience keptFromBase is 1 (exp-beta-analyst)", expDiff.keptFromBase, 1);
    check("partial: professionalExperience takenFromIncoming is 1 (exp-gamma-new)", expDiff.takenFromIncoming, 1);
    check("partial: professionalExperience keptBoth is 1 (resolved conflict, 'both')", expDiff.keptBoth, 1);
    check("partial: professionalExperience totalInPreview is 4 (1+1+2 from the 'both' conflict)", expDiff.totalInPreview, 4);

    const expIds = preview.resume.professionalExperience.map((e) => e.id).sort();
    check("partial: resulting professionalExperience ids match exactly", expIds, ["exp-acme-ops", "exp-acme-ops-conflict", "exp-beta-analyst", "exp-gamma-new"]);

    const volDiff = preview.sectionDiffs.find((d) => d.section === "volunteerExperience")!;
    check("partial: volunteerExperience untouched (no selection given) -> 0", volDiff.totalInPreview, 0);

    const eduDiff = preview.sectionDiffs.find((d) => d.section === "education")!;
    check("partial: education has 0 items (its conflict is still unresolved)", eduDiff.totalInPreview, 0);

    const projDiff = preview.sectionDiffs.find((d) => d.section === "projects")!;
    check("partial: projects untouched (no selection given) -> 0", projDiff.totalInPreview, 0);

    const credDiff = preview.sectionDiffs.find((d) => d.section === "credentials")!;
    check("partial: credentials untouched (no selection given) -> 0", credDiff.totalInPreview, 0);

    check("partial: unresolvedConflictIds contains ONLY the education conflict", preview.unresolvedConflictIds, ["education:edu-mcgill:edu-mcgill-conflict"]);
  }

  /* ---------------- Fully resolved: 'left' and 'right' conflict choices ---------------- */
  {
    const planLeft: MergePlan = {
      baseVersionId: "v-base",
      incomingVersionId: "v-incoming",
      selections: [],
      resolutions: [
        { conflictId: "experience:exp-acme-ops:exp-acme-ops-conflict", choice: "left" },
        { conflictId: "education:edu-mcgill:edu-mcgill-conflict", choice: "left" },
      ],
    };
    const previewLeft = computeMergePreview(base, incoming, planLeft);
    check("left-choice: unresolvedConflictIds is empty when every conflict has a resolution", previewLeft.unresolvedConflictIds.length, 0);
    const expIdsLeft = previewLeft.resume.professionalExperience.map((e) => e.id);
    check("left-choice: only the BASE entry survives for the experience conflict", expIdsLeft, ["exp-acme-ops"]);
    const eduIdsLeft = previewLeft.resume.education.map((e) => e.id);
    check("left-choice: only the BASE entry survives for the education conflict", eduIdsLeft, ["edu-mcgill"]);

    const planRight: MergePlan = {
      baseVersionId: "v-base",
      incomingVersionId: "v-incoming",
      selections: [],
      resolutions: [
        { conflictId: "experience:exp-acme-ops:exp-acme-ops-conflict", choice: "right" },
        { conflictId: "education:edu-mcgill:edu-mcgill-conflict", choice: "right" },
      ],
    };
    const previewRight = computeMergePreview(base, incoming, planRight);
    const expIdsRight = previewRight.resume.professionalExperience.map((e) => e.id);
    check("right-choice: only the INCOMING entry survives for the experience conflict", expIdsRight, ["exp-acme-ops-conflict"]);
    const eduIdsRight = previewRight.resume.education.map((e) => e.id);
    check("right-choice: only the INCOMING entry survives for the education conflict", eduIdsRight, ["edu-mcgill-conflict"]);
  }

  /* ---------------- keep-both on a plain (non-conflicted) item ---------------- */
  {
    const plan: MergePlan = {
      baseVersionId: "v-base",
      incomingVersionId: "v-incoming",
      selections: [{ section: "professionalExperience", itemId: "exp-beta-analyst", choice: "keep-both" }],
      resolutions: [],
    };
    const preview = computeMergePreview(base, incoming, plan);
    const expDiff = preview.sectionDiffs.find((d) => d.section === "professionalExperience")!;
    check("keep-both on plain item: keptBoth is 1", expDiff.keptBoth, 1);
    check("keep-both on a base-only item does not duplicate (no incoming counterpart)", preview.resume.professionalExperience.length, 1);
  }

  /* ---------------- Comparing base against itself: no conflicts at all ---------------- */
  {
    const plan: MergePlan = { baseVersionId: "v1", incomingVersionId: "v1", selections: [], resolutions: [] };
    const preview = computeMergePreview(base, base, plan);
    check("self-merge: 0 unresolved conflicts (identical resumes never conflict)", preview.unresolvedConflictIds.length, 0);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
