/*
  TASK 10 - Synthetic edge-case scenario gate test. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/syntheticScenarios.test.ts`.
*/
import { closeSharedBrowser } from "../sharedBrowser";
import { buildProfessionalAtsHtmlPreview } from "./buildProfessionalAtsHtmlPreview";
import { veryLongSingleEntry, veryLongSkillGroup, volunteerOnly, allElevenSections, customSectionOnly, manyShortEntries } from "./syntheticScenarios";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  // --- very-long-single-entry: must split across multiple pages, nothing dropped ---
  {
    const assembly = veryLongSingleEntry();
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("very-long-single-entry: pageCount > 1", preview.plan.pageCount > 1, preview.plan.pageCount);
    checkTrue("very-long-single-entry: validation passed (all 40 bullets preserved across pages)", preview.validation.passed, preview.validation);
    const blockPlacements = preview.plan.blockPlacements.filter((p) => p.blockId === "synthetic-exp-long");
    checkTrue("very-long-single-entry: block split into more than one fragment", blockPlacements.length > 1, blockPlacements.length);
  }

  // --- very-long-skill-group: unsplittable block - content never dropped even under pressure ---
  {
    const assembly = veryLongSkillGroup();
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("very-long-skill-group: measurable", preview.measurement.measurable);
    checkTrue("very-long-skill-group: no missing text fragments (content never dropped)", preview.validation.missingTextFragments.length === 0, preview.validation.missingTextFragments);
    checkTrue("very-long-skill-group: no invented text fragments", preview.validation.inventedTextFragments.length === 0, preview.validation.inventedTextFragments);
    checkTrue("very-long-skill-group: destructiveCompactionFlags empty (never shrinks below safety floor)", preview.validation.destructiveCompactionFlags.length === 0);
  }

  // --- volunteer-only: professional_experience hidden, volunteer_experience visible ---
  {
    const assembly = volunteerOnly();
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("volunteer-only: professional_experience NOT in visibleSectionKeys", !assembly.visibleSectionKeys.includes("professional_experience"));
    checkTrue("volunteer-only: volunteer_experience IS in visibleSectionKeys", assembly.visibleSectionKeys.includes("volunteer_experience"));
    checkTrue("volunteer-only: validation passed", preview.validation.passed, preview.validation);
  }

  // --- all-eleven-sections: every fixed slot populated, order respected ---
  {
    const assembly = allElevenSections();
    check("all-eleven-sections: all 11 sections visible", assembly.visibleSectionKeys.length, 11);
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("all-eleven-sections: validation passed", preview.validation.passed, preview.validation);
    checkTrue("all-eleven-sections: domOrderMatchesReadingOrder", preview.validation.domOrderMatchesReadingOrder);
  }

  // --- custom-section-only: minimal non-empty document ---
  {
    const assembly = customSectionOnly();
    check("custom-section-only: exactly 2 visible sections (identity + additional_information)", assembly.visibleSectionKeys.length, 2);
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("custom-section-only: validation passed", preview.validation.passed, preview.validation);
    checkTrue("custom-section-only: pageCount === 1", preview.plan.pageCount === 1, preview.plan.pageCount);
  }

  // --- many-short-entries: orphan regression pressure across a real page boundary ---
  {
    const assembly = manyShortEntries();
    const preview = await buildProfessionalAtsHtmlPreview(assembly, "letter");
    checkTrue("many-short-entries: pageCount > 1", preview.plan.pageCount > 1, preview.plan.pageCount);
    checkTrue("many-short-entries: validation passed", preview.validation.passed, preview.validation);
    check("many-short-entries: sectionHeadingOrphans empty", preview.validation.sectionHeadingOrphans, []);
    check("many-short-entries: entryHeaderOrphans empty", preview.validation.entryHeaderOrphans, []);
  }

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
