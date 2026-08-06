/*
  Phase 6F - contracts/validation.ts guard-function test category (spec
  section 19). Pure unit tests, hand-constructed inputs, no rendering.
  Covers both the pass-through (valid input never throws) and
  throw (invalid input throws the correct TemplateContractErrorCode)
  behavior of every exported guard. Run with:
    npx tsx lib/resumeTemplates/tests/contractValidation.test.ts
*/
import { assertHasIdentity, assertRuntimeResumeIsRenderable, assertSupportedDensity, assertSupportedFormat, assertSupportedPaperSize, isKnownTemplateId, TemplateContractError } from "../contracts/validation";
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { getTemplateCapabilities } from "../registry/templateRegistry";
import { TEMPLATE_IDS } from "../contracts/types";
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

function expectThrows(label: string, fn: () => void, expectedCode: string) {
  let code: string | null = null;
  try {
    fn();
  } catch (e) {
    code = e instanceof TemplateContractError ? e.code : "non-contract-error";
  }
  check(label, code, expectedCode);
}

function main() {
  ensureTemplatesRegistered();

  /* --- isKnownTemplateId --- */
  checkTrue("isKnownTemplateId: 'professional-ats' is known", isKnownTemplateId("professional-ats", TEMPLATE_IDS));
  checkTrue("isKnownTemplateId: 'modern-sidebar' is known", isKnownTemplateId("modern-sidebar", TEMPLATE_IDS));
  checkTrue("isKnownTemplateId: 'executive-minimal' is known", isKnownTemplateId("executive-minimal", TEMPLATE_IDS));
  checkTrue("isKnownTemplateId: 'creative-timeline' is known", isKnownTemplateId("creative-timeline", TEMPLATE_IDS));
  check("isKnownTemplateId: 'not-a-template' is NOT known", isKnownTemplateId("not-a-template", TEMPLATE_IDS), false);
  check("isKnownTemplateId: empty string is NOT known", isKnownTemplateId("", TEMPLATE_IDS), false);
  check("isKnownTemplateId: case-sensitive - 'Professional-Ats' is NOT known", isKnownTemplateId("Professional-Ats", TEMPLATE_IDS), false);

  /* --- assertSupportedFormat --- */
  const atsCaps = getTemplateCapabilities("professional-ats");
  for (const format of atsCaps.supportedFormats) {
    let threw = false;
    try {
      assertSupportedFormat(atsCaps, format);
    } catch {
      threw = true;
    }
    check(`assertSupportedFormat: professional-ats supports its own declared format '${format}' (never throws)`, threw, false);
  }
  expectThrows("assertSupportedFormat: an unsupported format throws 'unsupported-format'", () => assertSupportedFormat(atsCaps, "xml" as never), "unsupported-format");

  /* --- assertSupportedPaperSize --- */
  for (const size of atsCaps.supportedPaperSizes) {
    let threw = false;
    try {
      assertSupportedPaperSize(atsCaps, size);
    } catch {
      threw = true;
    }
    check(`assertSupportedPaperSize: professional-ats supports its own declared paper size '${size}' (never throws)`, threw, false);
  }
  expectThrows("assertSupportedPaperSize: an unsupported paper size throws 'unsupported-paper-size'", () => assertSupportedPaperSize(atsCaps, "legal" as never), "unsupported-paper-size");

  /* --- assertSupportedDensity --- */
  for (const density of atsCaps.supportedDensities) {
    let threw = false;
    try {
      assertSupportedDensity(atsCaps, density);
    } catch {
      threw = true;
    }
    check(`assertSupportedDensity: professional-ats supports its own declared density '${density}' (never throws)`, threw, false);
  }
  expectThrows("assertSupportedDensity: an unsupported density throws 'unsupported-density'", () => assertSupportedDensity(atsCaps, "ultra-loose" as never), "unsupported-density");

  /* --- assertRuntimeResumeIsRenderable --- */
  const validResume = buildJordanEllisResume();
  let renderableThrew = false;
  try {
    assertRuntimeResumeIsRenderable(validResume);
  } catch {
    renderableThrew = true;
  }
  check("assertRuntimeResumeIsRenderable: a well-formed ResumeStructuredModel never throws", renderableThrew, false);

  expectThrows("assertRuntimeResumeIsRenderable: null resume throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable(null), "malformed-runtime");
  expectThrows("assertRuntimeResumeIsRenderable: undefined resume throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable(undefined), "malformed-runtime");
  expectThrows("assertRuntimeResumeIsRenderable: a non-object primitive throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable("not-a-resume" as never), "malformed-runtime");
  expectThrows("assertRuntimeResumeIsRenderable: an object missing professionalExperience[] throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable({ ...validResume, professionalExperience: undefined } as never), "malformed-runtime");
  expectThrows("assertRuntimeResumeIsRenderable: an object missing education[] throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable({ ...validResume, education: undefined } as never), "malformed-runtime");
  expectThrows("assertRuntimeResumeIsRenderable: professionalExperience present but not an array throws 'malformed-runtime'", () => assertRuntimeResumeIsRenderable({ ...validResume, professionalExperience: "oops" } as never), "malformed-runtime");

  /* --- assertHasIdentity --- */
  let identityThrew = false;
  try {
    assertHasIdentity(validResume);
  } catch {
    identityThrew = true;
  }
  check("assertHasIdentity: Jordan Ellis fixture (has identity.fullName) never throws", identityThrew, false);

  const noIdentityResume: ResumeStructuredModel = { ...validResume, identity: undefined };
  expectThrows("assertHasIdentity: identity entirely undefined throws 'missing-identity'", () => assertHasIdentity(noIdentityResume), "missing-identity");

  const emptyIdentityResume: ResumeStructuredModel = { ...validResume, identity: { ...validResume.identity!, fullName: undefined, otherContactLines: [] } };
  expectThrows("assertHasIdentity: identity present but no fullName AND no fallback contact line throws 'missing-identity'", () => assertHasIdentity(emptyIdentityResume), "missing-identity");

  const fallbackContactResume: ResumeStructuredModel = {
    ...validResume,
    identity: { ...validResume.identity!, fullName: undefined, otherContactLines: [{ value: "jordan@example.com", confidence: 1, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } }] },
  };
  let fallbackThrew = false;
  try {
    assertHasIdentity(fallbackContactResume);
  } catch {
    fallbackThrew = true;
  }
  check("assertHasIdentity: no fullName BUT at least one fallback contact line does NOT throw (documented fallback path)", fallbackThrew, false);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
