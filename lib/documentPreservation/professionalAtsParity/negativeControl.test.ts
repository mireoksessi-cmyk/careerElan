/*
  TASK 7 - Negative-control mutation tests (spec section 16). Proves
  the parity engine actually detects real defects rather than being a
  validator that always returns PASS. Each test starts from a REAL
  snapshot generated from a real fixture through the real pipeline,
  then applies one targeted, hand-authored mutation to a COPY of that
  snapshot/manifest (never touches the renderer's own output), and
  asserts validateFormatAgainstManifest/buildCrossFormatParityReport
  actually fails with a meaningful reason code.

  Scope note: PROTECTED_FACT_CHANGED is not implemented as a distinct
  detector (see crossFormatParityValidator.ts's own header comment) -
  a changed protected fact (role/date mutations below) is expected to
  surface as MISSING_FRAGMENT instead, since the original value is now
  genuinely absent from the text. This is disclosed, not silent.
*/
import { loadFixtureAssembly } from "./testFixtureHelper";
import { buildCanonicalParityManifest } from "./canonicalParityManifest";
import { buildDocxSnapshot } from "./docxFormatAdapter";
import { validateFormatAgainstManifest, buildCrossFormatParityReport } from "./crossFormatParityValidator";
import { normalizeForParity } from "./parityNormalization";
import { closeSharedBrowser } from "../sharedBrowser";
import type { CanonicalParityManifest, NormalizedFormatSnapshot } from "./types";
import type { ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

function cloneSnapshot(snapshot: NormalizedFormatSnapshot): NormalizedFormatSnapshot {
  return JSON.parse(JSON.stringify(snapshot));
}

function removeFromText(text: string, fragment: string): string {
  return text.split(normalizeForParity(fragment)).join(" ");
}

async function main() {
  const assembly = await loadFixtureAssembly("threepage-pdf-resume.pdf");
  const manifest = buildCanonicalParityManifest(assembly, "letter", "comfortable");
  const { snapshot: baseline } = await buildDocxSnapshot(assembly, "letter", "comfortable");

  const baselineResult = validateFormatAgainstManifest(manifest, baseline);
  checkTrue("baseline (unmutated) snapshot passes", baselineResult.passed, baselineResult);

  /* 1. Missing bullet */
  {
    const entryWithBullets = manifest.entries.find((e) => e.bullets.length > 0)!;
    const bulletToRemove = entryWithBullets.bullets[0];
    const mutated = cloneSnapshot(baseline);
    mutated.normalizedText = removeFromText(mutated.normalizedText, bulletToRemove);
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("1. missing bullet -> FAIL with MISSING_FRAGMENT", !result.passed && result.missingFragments.some((m) => m.reasonCode === "MISSING_FRAGMENT"), result);
  }

  /* 2. Role changed */
  {
    const entryWithRole = manifest.entries.find((e) => e.role)!;
    const mutated = cloneSnapshot(baseline);
    mutated.normalizedText = removeFromText(mutated.normalizedText, entryWithRole.role!);
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("2. role changed -> FAIL (surfaces as MISSING_FRAGMENT, disclosed scope)", !result.passed && result.missingFragments.some((m) => m.reasonCode === "MISSING_FRAGMENT"), result);
  }

  /* 3. Duplicate entry */
  {
    const mutated = cloneSnapshot(baseline);
    mutated.entryIds = [...mutated.entryIds, mutated.entryIds[0]];
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("3. duplicate entry -> FAIL with DUPLICATE_ENTRY", !result.passed && result.duplicateEntries.some((m) => m.reasonCode === "DUPLICATE_ENTRY"), result);
  }

  /* 4. Volunteer moved under Education (section order violated) */
  {
    const mutated = cloneSnapshot(baseline);
    const withoutVolunteer: ProfessionalAtsSectionKey[] = mutated.visibleSections.filter((k) => k !== "volunteer_experience");
    const educationIndex = withoutVolunteer.indexOf("education");
    withoutVolunteer.splice(educationIndex + 1, 0, "volunteer_experience");
    mutated.visibleSections = withoutVolunteer;
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("4. volunteer moved after education -> FAIL with SECTION_ORDER_VIOLATION", !result.passed && result.sectionOrderViolations.some((m) => m.reasonCode === "SECTION_ORDER_VIOLATION"), result);
  }

  /* 5. Hidden section (Awards) inserted as visible */
  {
    const hiddenKey = manifest.hiddenSections[0];
    checkTrue("5a. fixture has at least one genuinely hidden section (precondition)", manifest.hiddenSections.length > 0);
    if (hiddenKey) {
      const mutated = cloneSnapshot(baseline);
      mutated.visibleSections = [...mutated.visibleSections, hiddenKey];
      const result = validateFormatAgainstManifest(manifest, mutated);
      checkTrue(`5b. hidden section "${hiddenKey}" rendered -> FAIL with HIDDEN_SECTION_RENDERED`, !result.passed && result.hiddenSectionViolations.some((m) => m.reasonCode === "HIDDEN_SECTION_RENDERED"), result);
    }
  }

  /* 6. Date changed */
  {
    const entryWithDate = manifest.entries.find((e) => e.date)!;
    const mutated = cloneSnapshot(baseline);
    mutated.normalizedText = removeFromText(mutated.normalizedText, entryWithDate.date!);
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("6. date changed -> FAIL (surfaces as MISSING_FRAGMENT, disclosed scope)", !result.passed && result.missingFragments.some((m) => m.reasonCode === "MISSING_FRAGMENT"), result);
  }

  /* 7. Organization removed */
  {
    const entryWithOrg = manifest.entries.find((e) => e.organization)!;
    const mutated = cloneSnapshot(baseline);
    mutated.normalizedText = removeFromText(mutated.normalizedText, entryWithOrg.organization!);
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("7. organization removed -> FAIL with MISSING_FRAGMENT", !result.passed && result.missingFragments.some((m) => m.reasonCode === "MISSING_FRAGMENT"), result);
  }

  /* 8. Entry order reversed within a section */
  {
    const sectionWithMultipleEntries = (() => {
      const counts = new Map<string, number>();
      for (const e of manifest.entries) counts.set(e.sectionKey, (counts.get(e.sectionKey) ?? 0) + 1);
      return [...counts.entries()].find(([, count]) => count > 1)?.[0];
    })();
    checkTrue("8a. fixture has a section with 2+ entries (precondition)", sectionWithMultipleEntries !== undefined);
    if (sectionWithMultipleEntries) {
      const entryIdsInSection = manifest.entries.filter((e) => e.sectionKey === sectionWithMultipleEntries).map((e) => e.entryId);
      const mutated = cloneSnapshot(baseline);
      const otherIds = mutated.entryIds.filter((id) => !entryIdsInSection.includes(id));
      const reversed = [...entryIdsInSection].reverse();
      mutated.entryIds = [...otherIds.slice(0, 1), ...reversed, ...otherIds.slice(1)];
      const result = validateFormatAgainstManifest(manifest, mutated);
      checkTrue("8b. entry order reversed -> FAIL with ENTRY_ORDER_VIOLATION", !result.passed && result.entryOrderViolations.some((m) => m.reasonCode === "ENTRY_ORDER_VIOLATION"), result);
    }
  }

  /* 9. sourceEntryId mapping missing (source coverage incomplete) */
  {
    const mutated = cloneSnapshot(baseline);
    mutated.entryIds = mutated.entryIds.slice(1);
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("9. entry dropped from source mapping -> FAIL with SOURCE_COVERAGE_INCOMPLETE", !result.passed && result.policyViolations.some((m) => m.reasonCode === "SOURCE_COVERAGE_INCOMPLETE"), result);
  }

  /* 10. Paper size mismatch */
  {
    const mutated = cloneSnapshot(baseline);
    mutated.paperSize = "a4";
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("10. paper size mismatch -> FAIL with PAPER_SIZE_MISMATCH", !result.passed && result.policyViolations.some((m) => m.reasonCode === "PAPER_SIZE_MISMATCH"), result);
  }

  /* 11. Density mismatch */
  {
    const mutated = cloneSnapshot(baseline);
    mutated.density = "compact";
    const result = validateFormatAgainstManifest(manifest, mutated);
    checkTrue("11. density mismatch -> FAIL with DENSITY_MISMATCH", !result.passed && result.policyViolations.some((m) => m.reasonCode === "DENSITY_MISMATCH"), result);
  }

  /* Cross-check: a genuinely mutated report must be passed=false at the
     top level too, not just at the per-format level. */
  {
    const mutatedManifest: CanonicalParityManifest = manifest;
    const mutatedDocx = cloneSnapshot(baseline);
    mutatedDocx.entryIds = [...mutatedDocx.entryIds, mutatedDocx.entryIds[0]];
    const report = buildCrossFormatParityReport(mutatedManifest, baseline, baseline, mutatedDocx);
    checkTrue("12. top-level CrossFormatParityReport.passed is false when one format is mutated", report.passed === false, report.formats.docx);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
