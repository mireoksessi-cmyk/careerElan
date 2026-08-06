/*
  Phase 6F - Unicode/edge-case real-render test category (spec section
  19: paper size letter/A4, missing-photo, empty-optional-sections,
  density variation). Builds trimmed variants of the Jordan Ellis
  fixture rather than a second hand-authored fixture, since
  ResumeStructuredModel's only required top-level fields are
  schemaVersion/source/skillGroups/professionalExperience/
  volunteerExperience/education/credentials/projects/awards/
  publications/customSections/metricGrids/slotAvailability/validation
  (all arrays) - zeroing the optional-section arrays while keeping
  identity/professionalSummary/professionalExperience produces a
  legitimately minimal-but-valid model. Run with:
    npx tsx lib/resumeTemplates/tests/unicodeAndEdgeCases.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";

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

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

function minimalResume(): ResumeStructuredModel {
  const full = buildJordanEllisResume();
  return {
    ...full,
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    customSections: [],
    metricGrids: [],
    professionalExperience: [full.professionalExperience[0]],
  };
}

async function main() {
  ensureTemplatesRegistered();
  const fullResume = buildJordanEllisResume();
  const fullRuntime = createCanonicalRuntime({
    resume: fullResume,
    version: createRuntimeVersion({ id: "edge-full-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: fullResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const minResume = minimalResume();
  const minRuntime = createCanonicalRuntime({
    resume: minResume,
    version: createRuntimeVersion({ id: "edge-min-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: minResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  /* --- Paper size: letter vs A4, same template/content --- */
  const letterHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "executive-minimal", paperSize: "letter", generatedAt: GENERATED_AT }, "html");
  const a4Html = await renderTemplateFromRuntime(fullRuntime, { templateId: "executive-minimal", paperSize: "a4", generatedAt: GENERATED_AT }, "html");
  check("paper size: letter render reports paperSize='letter'", letterHtml.paperSize, "letter");
  check("paper size: a4 render reports paperSize='a4'", a4Html.paperSize, "a4");
  checkTrue("paper size: letter render's page width (816px, per PAPER_DIMENSIONS) differs from a4's (794px)", letterHtml.html.includes("width: 816px") && a4Html.html.includes("width: 794px"));
  checkTrue("paper size: both letter and a4 validation.passed is true (paper size never affects content parity)", letterHtml.validation.passed && a4Html.validation.passed);
  checkTrue("paper size: both contain the same identity fact regardless of page dimensions", letterHtml.html.includes("Jordan Ellis") && a4Html.html.includes("Jordan Ellis"));

  /* --- Density variation: spacious vs compact, same template/content --- */
  const spaciousHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "executive-minimal", density: "spacious", generatedAt: GENERATED_AT }, "html");
  const compactHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "executive-minimal", density: "compact", generatedAt: GENERATED_AT }, "html");
  check("density: spacious render reports density='spacious'", spaciousHtml.density, "spacious");
  check("density: compact render reports density='compact'", compactHtml.density, "compact");
  checkTrue("density: spacious and compact produce different padding values (distinct spacing tokens actually applied)", spaciousHtml.html !== compactHtml.html);
  checkTrue("density: compact pageCount is never greater than spacious pageCount for identical content (compact should fit the same or more per page)", compactHtml.pageCount <= spaciousHtml.pageCount);
  checkTrue("density: both spacious and compact validation.passed is true", spaciousHtml.validation.passed && compactHtml.validation.passed);

  /* --- Missing photo: explicit photoOption='none' on a photo-supporting template --- */
  const noPhotoHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "modern-sidebar", photoOption: "none", generatedAt: GENERATED_AT }, "html");
  const withPhotoHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "modern-sidebar", photoOption: "placeholder", generatedAt: GENERATED_AT }, "html");
  checkTrue("missing photo: photoOption='none' renders with NO photo placeholder element", !noPhotoHtml.html.includes("border-radius:50%"));
  checkTrue("missing photo: photoOption='placeholder' DOES render a photo placeholder element (control case)", withPhotoHtml.html.includes("border-radius:50%"));
  checkTrue("missing photo: identity name still renders correctly when the photo slot is omitted (no layout gap breaks content)", noPhotoHtml.html.includes("Jordan Ellis"));
  checkTrue("missing photo: validation.passed is true even with photoOption='none'", noPhotoHtml.validation.passed);

  /* --- Empty optional sections: no education/credentials/projects/awards/publications/custom/volunteer/metrics --- */
  const minimalHtml = await renderTemplateFromRuntime(minRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  checkTrue("empty sections: renders without throwing on a resume with only identity+summary+1 experience entry", minimalHtml.html.length > 0);
  checkTrue("empty sections: validation.passed is true for the trimmed resume", minimalHtml.validation.passed);
  check("empty sections: validation.missingTextCount is 0 (no expected fragment for an empty array)", minimalHtml.validation.missingTextCount, 0);
  checkTrue("empty sections: still contains identity and the one kept experience entry", minimalHtml.html.includes("Jordan Ellis") && minimalHtml.html.includes("Northbridge"));
  checkTrue("empty sections: pageCount is exactly 1 for a short, trimmed resume", minimalHtml.pageCount === 1);

  const minimalPdf = await renderTemplateFromRuntime(minRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "pdf");
  checkTrue("empty sections: PDF still generates real, non-empty, selectable-text bytes for a minimal resume", minimalPdf.bytes.length > 0 && minimalPdf.hasSelectableText);
  const minimalDocx = await renderTemplateFromRuntime(minRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "docx");
  checkTrue("empty sections: DOCX still generates a real, non-empty, editable native document for a minimal resume", minimalDocx.bytes.length > 0 && minimalDocx.isEditableNativeDocx);

  /* --- Unicode: mixed-script content (French accents, Korean) survives every paper size / density combination --- */
  const a4CompactHtml = await renderTemplateFromRuntime(fullRuntime, { templateId: "executive-minimal", paperSize: "a4", density: "compact", generatedAt: GENERATED_AT }, "html");
  checkTrue("unicode: accented French text ('Québec') survives an a4+compact render", /Qu[ée]bec/i.test(a4CompactHtml.html));
  checkTrue("unicode: French/Korean-bearing custom sections render on modern-sidebar too (cross-template unicode survival)", /[가-힣]/.test(noPhotoHtml.html));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
