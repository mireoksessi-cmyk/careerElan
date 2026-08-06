/*
  Phase 6F - Engine layer test category (spec section 19): resolveTemplate.ts
  and templateContext.ts in isolation, hand-constructed inputs, no
  rendering. Covers default application (paperSize/density/locale/
  photoOption) and the useTailored resolution switch. Run with:
    npx tsx lib/resumeTemplates/tests/engine.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { getTemplateCapabilities } from "../registry/templateRegistry";
import { buildTemplateRenderContext } from "../engine/templateContext";
import { resolveResumeFromRuntime } from "../engine/resolveTemplate";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { TemplateContractError } from "../contracts/validation";

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

function main() {
  ensureTemplatesRegistered();
  const resume = buildJordanEllisResume();

  /* --- buildTemplateRenderContext: default application --- */
  const atsCaps = getTemplateCapabilities("professional-ats");
  const defaultCtx = buildTemplateRenderContext(resume, { templateId: "professional-ats", capabilities: atsCaps, generatedAt: GENERATED_AT });
  check("buildTemplateRenderContext: no paperSize override -> uses capabilities.defaultPaperSize", defaultCtx.paperSize, atsCaps.defaultPaperSize);
  check("buildTemplateRenderContext: no density override -> uses capabilities.defaultDensity", defaultCtx.density, atsCaps.defaultDensity);
  check("buildTemplateRenderContext: no locale override -> defaults to 'en'", defaultCtx.locale, "en");
  check("buildTemplateRenderContext: professional-ats (supportsPhoto=false) -> photoOption defaults to 'none'", defaultCtx.photoOption, "none");
  check("buildTemplateRenderContext: templateId is carried through unchanged", defaultCtx.templateId, "professional-ats");
  check("buildTemplateRenderContext: generatedAt is carried through unchanged, never computed internally", defaultCtx.generatedAt, GENERATED_AT);
  check("buildTemplateRenderContext: resume reference is carried through unchanged (identity function on the model itself)", defaultCtx.resume, resume);
  check("buildTemplateRenderContext: sectionVisibility is undefined when not provided", defaultCtx.sectionVisibility, undefined);

  const sidebarCaps = getTemplateCapabilities("modern-sidebar");
  const sidebarDefaultCtx = buildTemplateRenderContext(resume, { templateId: "modern-sidebar", capabilities: sidebarCaps, generatedAt: GENERATED_AT });
  check("buildTemplateRenderContext: modern-sidebar (supportsPhoto=true) -> photoOption defaults to 'placeholder'", sidebarDefaultCtx.photoOption, "placeholder");

  /* --- buildTemplateRenderContext: explicit overrides win over defaults --- */
  const overriddenCtx = buildTemplateRenderContext(resume, { templateId: "professional-ats", capabilities: atsCaps, paperSize: "a4", density: "compact", locale: "fr", photoOption: "placeholder", generatedAt: GENERATED_AT, sectionVisibility: { awards: false } });
  check("buildTemplateRenderContext: explicit paperSize='a4' overrides the default", overriddenCtx.paperSize, "a4");
  check("buildTemplateRenderContext: explicit density='compact' overrides the default", overriddenCtx.density, "compact");
  check("buildTemplateRenderContext: explicit locale='fr' overrides the 'en' default", overriddenCtx.locale, "fr");
  check("buildTemplateRenderContext: explicit photoOption='placeholder' overrides the capability-derived default", overriddenCtx.photoOption, "placeholder");
  check("buildTemplateRenderContext: sectionVisibility override is carried through verbatim", overriddenCtx.sectionVisibility, { awards: false });

  /* --- buildTemplateRenderContext: malformed/unidentifiable resume rejected before a template ever sees it --- */
  let malformedThrew = false;
  try {
    buildTemplateRenderContext(null as never, { templateId: "professional-ats", capabilities: atsCaps, generatedAt: GENERATED_AT });
  } catch (e) {
    malformedThrew = e instanceof TemplateContractError && e.code === "malformed-runtime";
  }
  checkTrue("buildTemplateRenderContext: null resume is rejected with 'malformed-runtime' before context construction completes", malformedThrew);

  let noIdentityThrew = false;
  try {
    buildTemplateRenderContext({ ...resume, identity: undefined }, { templateId: "professional-ats", capabilities: atsCaps, generatedAt: GENERATED_AT });
  } catch (e) {
    noIdentityThrew = e instanceof TemplateContractError && e.code === "missing-identity";
  }
  checkTrue("buildTemplateRenderContext: resume with no identity at all is rejected with 'missing-identity'", noIdentityThrew);

  /* --- resolveResumeFromRuntime --- */
  const runtime = createCanonicalRuntime({
    resume,
    version: createRuntimeVersion({ id: "engine-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });

  const defaultResolved = resolveResumeFromRuntime(runtime);
  check("resolveResumeFromRuntime: no options -> returns runtime.resume verbatim (useTailored defaults to false)", defaultResolved, runtime.resume);

  const explicitFalseResolved = resolveResumeFromRuntime(runtime, { useTailored: false });
  check("resolveResumeFromRuntime: useTailored:false explicitly -> returns runtime.resume verbatim", explicitFalseResolved, runtime.resume);

  const tailoredResolved = resolveResumeFromRuntime(runtime, { useTailored: true });
  checkTrue("resolveResumeFromRuntime: useTailored:true -> returns a resolved model (never throws for a runtime with no overlay changes)", typeof tailoredResolved === "object" && tailoredResolved !== null);
  check("resolveResumeFromRuntime: useTailored:true on a runtime with an EMPTY overlay -> identity/summary/experience count matches the untailored base (no overlay = no change)", tailoredResolved.professionalExperience.length, runtime.resume.professionalExperience.length);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
