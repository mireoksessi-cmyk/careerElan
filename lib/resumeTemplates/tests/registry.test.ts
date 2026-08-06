/*
  Phase 6F - Registry/Metadata/Capability/TemplateID test category (spec
  section 19, items 1-4). Run with:
    npx tsx lib/resumeTemplates/tests/registry.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { clearRegistry, getTemplate, getTemplateCapabilities, listTemplates, validateTemplateId } from "../registry/templateRegistry";
import { buildCapabilityMatrix, supportsFeature } from "../engine/templateCapabilities";
import { TemplateContractError } from "../contracts/validation";
import { TEMPLATE_IDS } from "../contracts/types";

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
  ensureTemplatesRegistered();

  check("TEMPLATE_IDS has exactly 4 entries", TEMPLATE_IDS.length, 4);
  checkTrue("TEMPLATE_IDS includes professional-ats", TEMPLATE_IDS.includes("professional-ats"));
  checkTrue("TEMPLATE_IDS includes modern-sidebar", TEMPLATE_IDS.includes("modern-sidebar"));
  checkTrue("TEMPLATE_IDS includes executive-minimal", TEMPLATE_IDS.includes("executive-minimal"));
  checkTrue("TEMPLATE_IDS includes creative-timeline", TEMPLATE_IDS.includes("creative-timeline"));

  const list = listTemplates();
  check("listTemplates returns exactly 4 templates", list.length, 4);

  for (const id of TEMPLATE_IDS) {
    const capabilities = getTemplateCapabilities(id);
    check(`${id}: capabilities.id matches`, capabilities.id, id);
    checkTrue(`${id}: has a non-empty name`, capabilities.name.length > 0);
    checkTrue(`${id}: has a non-empty description`, capabilities.description.length > 0);
    checkTrue(`${id}: supportedFormats includes html`, capabilities.supportedFormats.includes("html"));
    checkTrue(`${id}: supportedFormats includes pdf`, capabilities.supportedFormats.includes("pdf"));
    checkTrue(`${id}: supportedFormats includes docx`, capabilities.supportedFormats.includes("docx"));
    checkTrue(`${id}: supportedPaperSizes includes letter`, capabilities.supportedPaperSizes.includes("letter"));
    checkTrue(`${id}: supportedPaperSizes includes a4`, capabilities.supportedPaperSizes.includes("a4"));
    checkTrue(`${id}: supportedDensities is non-empty`, capabilities.supportedDensities.length > 0);
    checkTrue(`${id}: defaultDensity is in supportedDensities`, capabilities.supportedDensities.includes(capabilities.defaultDensity));
    checkTrue(`${id}: defaultPaperSize is in supportedPaperSizes`, capabilities.supportedPaperSizes.includes(capabilities.defaultPaperSize));
    checkTrue(`${id}: version is non-empty`, capabilities.version.length > 0);
    check(`${id}: status is active`, capabilities.status, "active");
    checkTrue(`${id}: renderer path is non-empty`, capabilities.renderer.length > 0);
    checkTrue(`${id}: pdfRenderer path is non-empty`, capabilities.pdfRenderer.length > 0);
    checkTrue(`${id}: docxRenderer path is non-empty`, capabilities.docxRenderer.length > 0);
    checkTrue(`${id}: validationProfile is non-empty`, capabilities.validationProfile.length > 0);
    const definition = getTemplate(id);
    check(`${id}: getTemplate returns matching capabilities.id`, definition.capabilities.id, id);
    checkTrue(`${id}: renderer.renderHtml is a function`, typeof definition.renderer.renderHtml === "function");
    checkTrue(`${id}: renderer.renderPdf is a function`, typeof definition.renderer.renderPdf === "function");
    checkTrue(`${id}: renderer.renderDocx is a function`, typeof definition.renderer.renderDocx === "function");
  }

  check("professional-ats: category is ats", getTemplateCapabilities("professional-ats").category, "ats");
  check("modern-sidebar: category is modern", getTemplateCapabilities("modern-sidebar").category, "modern");
  check("executive-minimal: category is executive", getTemplateCapabilities("executive-minimal").category, "executive");
  check("creative-timeline: category is creative", getTemplateCapabilities("creative-timeline").category, "creative");

  check("professional-ats: atsLevel is high", getTemplateCapabilities("professional-ats").atsLevel, "high");
  check("modern-sidebar: atsLevel is medium", getTemplateCapabilities("modern-sidebar").atsLevel, "medium");
  check("executive-minimal: atsLevel is high", getTemplateCapabilities("executive-minimal").atsLevel, "high");
  check("creative-timeline: atsLevel is visual (lowest ATS friendliness, per spec)", getTemplateCapabilities("creative-timeline").atsLevel, "visual");

  check("professional-ats: supportsPhoto is false", getTemplateCapabilities("professional-ats").supportsPhoto, false);
  check("modern-sidebar: supportsPhoto is true", getTemplateCapabilities("modern-sidebar").supportsPhoto, true);
  check("creative-timeline: supportsPhoto is true", getTemplateCapabilities("creative-timeline").supportsPhoto, true);
  check("professional-ats: supportsSidebar is false", getTemplateCapabilities("professional-ats").supportsSidebar, false);
  check("modern-sidebar: supportsSidebar is true", getTemplateCapabilities("modern-sidebar").supportsSidebar, true);
  check("creative-timeline: supportsSidebar is true", getTemplateCapabilities("creative-timeline").supportsSidebar, true);
  check("modern-sidebar: supportsMetricGrid is false (fallback-rendered instead)", getTemplateCapabilities("modern-sidebar").supportsMetricGrid, false);
  check("creative-timeline: supportsMetricGrid is false (fallback-rendered instead)", getTemplateCapabilities("creative-timeline").supportsMetricGrid, false);
  check("executive-minimal: supportsMetricGrid is true", getTemplateCapabilities("executive-minimal").supportsMetricGrid, true);
  check("professional-ats: supportsMetricGrid is true", getTemplateCapabilities("professional-ats").supportsMetricGrid, true);

  for (const id of TEMPLATE_IDS) {
    checkTrue(`${id}: supportsHierarchy is true`, getTemplateCapabilities(id).supportsHierarchy);
    checkTrue(`${id}: supportsCustomSections is true`, getTemplateCapabilities(id).supportsCustomSections);
    checkTrue(`${id}: supportsMultiplePages is true`, getTemplateCapabilities(id).supportsMultiplePages);
  }

  const matrix = buildCapabilityMatrix();
  checkTrue("capability matrix has at least 7 feature rows", matrix.length >= 7);
  const photoRow = matrix.find((r) => r.feature === "photo");
  checkTrue("capability matrix has a photo row", Boolean(photoRow));
  check("capability matrix photo row: professional-ats is false", photoRow?.values["professional-ats"], false);
  check("capability matrix photo row: modern-sidebar is true", photoRow?.values["modern-sidebar"], true);

  checkTrue("supportsFeature: modern-sidebar supportsSidebar", supportsFeature("modern-sidebar", "supportsSidebar"));
  check("supportsFeature: professional-ats supportsSidebar is false", supportsFeature("professional-ats", "supportsSidebar"), false);
  check("supportsFeature: unknown id returns false, never throws", supportsFeature("nonexistent" as never, "supportsSidebar"), false);

  check("validateTemplateId: valid id returns itself", validateTemplateId("professional-ats"), "professional-ats");
  let threw = false;
  try {
    validateTemplateId("not-a-real-template");
  } catch (e) {
    threw = e instanceof TemplateContractError && e.code === "unknown-template-id";
  }
  checkTrue("validateTemplateId: unknown id throws TemplateContractError(unknown-template-id)", threw);

  let threwMissing = false;
  clearRegistry();
  try {
    getTemplateCapabilities("professional-ats");
  } catch (e) {
    threwMissing = e instanceof TemplateContractError && e.code === "missing-renderer";
  }
  checkTrue("getTemplate: known id but unregistered throws missing-renderer", threwMissing);
  ensureTemplatesRegistered();
  check("re-registering after clearRegistry restores all 4 templates", listTemplates().length, 4);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
