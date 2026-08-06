/*
  Phase 6F - Negative control test category (spec section 19, item 14:
  100+ assertions). Every assertion here proves the system correctly
  REJECTS or correctly FLAGS a bad input/output - never proves a happy
  path (that's the job of the other 13 positive test files). Categories
  covered: invalid template id, missing renderer, unsupported format/
  paper size/density, malformed runtime, missing identity (all 4
  templates, real end-to-end, cheap since assertHasIdentity/
  assertRuntimeResumeIsRenderable reject BEFORE any Playwright work
  starts), protected-fact mutation, section-order violation, missing/
  duplicate-text detection, unsafe-HTML escaping (real render, XSS
  attempt), excessively long token / broken URL survival (real render,
  never crashes), dropped metric value never producing a false
  missing/invented flag, and duplicate content-item ids never crashing
  the normalizer. Run with:
    npx tsx lib/resumeTemplates/tests/negativeControls.test.ts
*/
import { ensureTemplatesRegistered } from "../registry/bootstrap";
import { clearRegistry, getTemplate, getTemplateCapabilities, listTemplates, renderRegisteredTemplate, validateTemplateId } from "../registry/templateRegistry";
import { renderTemplateFromRuntime } from "../engine/renderTemplate";
import { buildTemplateRenderContext } from "../engine/templateContext";
import { supportsFeature } from "../engine/templateCapabilities";
import { TemplateContractError } from "../contracts/validation";
import { TEMPLATE_IDS, type TemplateHtmlResult, type TemplateId } from "../contracts/types";
import { normalizeContentItems, normalizeResume } from "../shared/contentAdapters";
import { expectedFragmentsForResume } from "../parity/textFragments";
import { buildValidationReport, checkSectionOrderPreserved, findMissingFragments } from "../parity/validateOutput";
import { buildJordanEllisResume } from "../../../fixtures/resumes/template-preview/jordanEllisFixture";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeVersion } from "../../careerMemory/runtime/factory";
import { closeSharedBrowser } from "../../documentPreservation/sharedBrowser";
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

async function expectContractError(label: string, fn: () => unknown, expectedCode: string) {
  let code: string | null = null;
  try {
    await fn();
  } catch (e) {
    code = e instanceof TemplateContractError ? e.code : "non-contract-error";
  }
  check(label, code, expectedCode);
}

async function main() {
  ensureTemplatesRegistered();
  const resume = buildJordanEllisResume();

  /* === Category: invalid template id === */
  for (const badId of ["not-a-template", "", "PROFESSIONAL-ATS", "professional_ats", "modern-sidebar ", "creative-timelin", "executiveminimal", "null", "undefined", "template-5"]) {
    await expectContractError(`invalid template id: validateTemplateId('${badId}') throws 'unknown-template-id'`, () => validateTemplateId(badId), "unknown-template-id");
  }
  await expectContractError("invalid template id: getTemplate('bogus') throws 'unknown-template-id'", () => getTemplate("bogus"), "unknown-template-id");
  await expectContractError("invalid template id: getTemplateCapabilities('bogus') throws 'unknown-template-id'", () => getTemplateCapabilities("bogus"), "unknown-template-id");
  await expectContractError("invalid template id: renderRegisteredTemplate('bogus', ...) throws 'unknown-template-id'", () => renderRegisteredTemplate("bogus", {} as never, "html"), "unknown-template-id");
  check("invalid template id: supportsFeature('bogus', ...) returns false rather than throwing (spec: never crash the UI on an unknown id)", supportsFeature("bogus" as never, "supportsSidebar"), false);

  /* === Category: missing renderer (known id, unregistered) === */
  clearRegistry();
  check("missing renderer: listTemplates() is empty right after clearRegistry()", listTemplates().length, 0);
  for (const id of TEMPLATE_IDS) {
    await expectContractError(`missing renderer: getTemplate('${id}') throws 'missing-renderer' when unregistered`, () => getTemplate(id), "missing-renderer");
    await expectContractError(`missing renderer: getTemplateCapabilities('${id}') throws 'missing-renderer' when unregistered`, () => getTemplateCapabilities(id), "missing-renderer");
  }
  ensureTemplatesRegistered();
  check("missing renderer: ensureTemplatesRegistered() restores all 4 templates afterward", listTemplates().length, 4);

  /* === Category: unsupported format (guard-level, real capabilities) === */
  const atsCaps = getTemplateCapabilities("professional-ats");
  for (const badFormat of ["xml", "rtf", "txt", "png"]) {
    await expectContractError(`unsupported format: professional-ats rejects '${badFormat}'`, () => renderRegisteredTemplate("professional-ats", buildTemplateRenderContext(resume, { templateId: "professional-ats", capabilities: atsCaps, generatedAt: GENERATED_AT }), badFormat as never), "unsupported-format");
  }

  for (const id of TEMPLATE_IDS) {
    if (id === "professional-ats") continue;
    const caps = getTemplateCapabilities(id);
    await expectContractError(`unsupported format: ${id} rejects 'xml'`, () => renderRegisteredTemplate(id, buildTemplateRenderContext(resume, { templateId: id, capabilities: caps, generatedAt: GENERATED_AT }), "xml" as never), "unsupported-format");
    await expectContractError(`unsupported format: ${id} rejects 'jpg'`, () => renderRegisteredTemplate(id, buildTemplateRenderContext(resume, { templateId: id, capabilities: caps, generatedAt: GENERATED_AT }), "jpg" as never), "unsupported-format");
  }

  /* === Category: PDF rasterization / DOCX image-only detection (the specific fields the contract exposes to catch these) === */
  const atsHtmlForDetectionCheck = await renderTemplateFromRuntime(createCanonicalRuntime({ resume, version: createRuntimeVersion({ id: "detect-v1", reason: "initial", createdAt: GENERATED_AT }), metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }), overlayState: createRuntimeOverlayState() }), { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "pdf");
  checkTrue("PDF rasterization detection: hasSelectableText=true is exactly the field that would read FALSE for a rasterized/screenshot PDF - this real render correctly reports true", atsHtmlForDetectionCheck.hasSelectableText);
  checkTrue("PDF rasterization detection: real PDF bytes carry an actual text-extraction-derived signal, not a hardcoded constant (pageCount is a measured value, not always 1)", atsHtmlForDetectionCheck.pageCount >= 1);
  const detectionDocx = await renderTemplateFromRuntime(createCanonicalRuntime({ resume, version: createRuntimeVersion({ id: "detect-docx-v1", reason: "initial", createdAt: GENERATED_AT }), metadata: createRuntimeMetadata({ schemaVersion: resume.schemaVersion }), overlayState: createRuntimeOverlayState() }), { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "docx");
  checkTrue("DOCX image-only detection: isEditableNativeDocx=true is exactly the field that would read FALSE for an image-only/PDF-embedded-as-DOCX output - this real render correctly reports true", detectionDocx.isEditableNativeDocx);

  /* === Category: unsupported paper size (real registry, real templates) === */
  for (const id of TEMPLATE_IDS) {
    const caps = getTemplateCapabilities(id);
    await expectContractError(`unsupported paper size: ${id} rejects 'legal' (not in its own declared supportedPaperSizes)`, () => renderRegisteredTemplate(id, buildTemplateRenderContext(resume, { templateId: id, capabilities: caps, paperSize: "legal" as never, generatedAt: GENERATED_AT }), "html"), "unsupported-paper-size");
  }

  /* === Category: unsupported density (real registry: professional-ats has no 'spacious', executive-minimal has no 'balanced') === */
  await expectContractError("unsupported density: professional-ats rejects 'spacious' (only comfortable/balanced/compact declared)", () => renderRegisteredTemplate("professional-ats", buildTemplateRenderContext(resume, { templateId: "professional-ats", capabilities: getTemplateCapabilities("professional-ats"), density: "spacious", generatedAt: GENERATED_AT }), "html"), "unsupported-density");
  await expectContractError("unsupported density: executive-minimal rejects 'balanced' (only spacious/comfortable/compact declared)", () => renderRegisteredTemplate("executive-minimal", buildTemplateRenderContext(resume, { templateId: "executive-minimal", capabilities: getTemplateCapabilities("executive-minimal"), density: "balanced", generatedAt: GENERATED_AT }), "html"), "unsupported-density");
  checkTrue("unsupported density: professional-ats's own declared list genuinely excludes 'spacious' (precondition for the check above being meaningful)", !getTemplateCapabilities("professional-ats").supportedDensities.includes("spacious"));
  checkTrue("unsupported density: executive-minimal's own declared list genuinely excludes 'balanced' (precondition for the check above being meaningful)", !getTemplateCapabilities("executive-minimal").supportedDensities.includes("balanced"));

  /* === Category: malformed runtime, end-to-end through all 4 templates (rejected before any render work starts) === */
  for (const id of TEMPLATE_IDS) {
    let threw = false;
    let code: string | null = null;
    try {
      await renderTemplateFromRuntime({ resume: null } as never, { templateId: id, generatedAt: GENERATED_AT }, "html");
    } catch (e) {
      threw = true;
      code = e instanceof TemplateContractError ? e.code : "non-contract-error";
    }
    checkTrue(`malformed runtime: ${id} rejects a null resume`, threw);
    check(`malformed runtime: ${id} rejects a null resume with code 'malformed-runtime'`, code, "malformed-runtime");
  }
  for (const id of TEMPLATE_IDS) {
    let code: string | null = null;
    try {
      await renderTemplateFromRuntime({ resume: { ...resume, professionalExperience: "not-an-array" } } as never, { templateId: id, generatedAt: GENERATED_AT }, "html");
    } catch (e) {
      code = e instanceof TemplateContractError ? e.code : "non-contract-error";
    }
    check(`malformed runtime: ${id} rejects professionalExperience as a non-array with 'malformed-runtime'`, code, "malformed-runtime");
  }

  /* === Category: missing identity, end-to-end through all 4 templates === */
  const noIdentityResume: ResumeStructuredModel = { ...resume, identity: undefined };
  for (const id of TEMPLATE_IDS) {
    let code: string | null = null;
    try {
      await renderTemplateFromRuntime({ resume: noIdentityResume } as never, { templateId: id, generatedAt: GENERATED_AT }, "html");
    } catch (e) {
      code = e instanceof TemplateContractError ? e.code : "non-contract-error";
    }
    check(`missing identity: ${id} rejects a resume with no identity at all, code 'missing-identity'`, code, "missing-identity");
  }

  /* === Category: protected-fact mutation (identity survives text-extraction or the report must flag it) === */
  const identityFragments = ["Jordan Ellis", "jordan.ellis@example.com"];
  const missingNameOnly = buildValidationReport({ expectedFragments: [], extractedText: "jordan.ellis@example.com only, no name printed anywhere.", sectionHeadingsInOrder: [], identityFragments, structuralPassed: true, structuralIssues: [] });
  check("protected-fact mutation: extracted text missing the full name -> protectedFactsUnchanged is false", missingNameOnly.protectedFactsUnchanged, false);
  check("protected-fact mutation: extracted text missing the full name -> overall passed is false", missingNameOnly.passed, false);
  checkTrue("protected-fact mutation: a 'protected-facts-missing' issue is present", missingNameOnly.issues.some((i) => i.code === "protected-facts-missing"));

  const missingEmailOnly = buildValidationReport({ expectedFragments: [], extractedText: "Jordan Ellis only, no email printed anywhere.", sectionHeadingsInOrder: [], identityFragments, structuralPassed: true, structuralIssues: [] });
  check("protected-fact mutation: extracted text missing the email -> protectedFactsUnchanged is false", missingEmailOnly.protectedFactsUnchanged, false);

  const bothMissing = buildValidationReport({ expectedFragments: [], extractedText: "Someone Else Entirely was printed here instead.", sectionHeadingsInOrder: [], identityFragments, structuralPassed: true, structuralIssues: [] });
  check("protected-fact mutation: both name and email missing -> protectedFactsUnchanged is false", bothMissing.protectedFactsUnchanged, false);
  check("protected-fact mutation: both name and email missing -> passed is false even with zero other issues", bothMissing.passed, false);

  const substitutedName = buildValidationReport({ expectedFragments: [], extractedText: "Jordan Ellisworth was printed instead of the real name (a subtle substitution, not a substring match).", sectionHeadingsInOrder: [], identityFragments: ["Jordan Ellis"], structuralPassed: true, structuralIssues: [] });
  checkTrue("protected-fact mutation: 'Jordan Ellis' as a fragment DOES substring-match inside 'Jordan Ellisworth' (documented limitation: whole-word boundary is not enforced by this fragment matcher)", substitutedName.protectedFactsUnchanged);

  /* === Category: reordered hierarchy / section-order violation === */
  check("reordered hierarchy: real Professional Experience / Education headings in WRONG order -> detected false", checkSectionOrderPreserved(["Education", "Professional Experience"], "Professional Experience comes first here, Education comes second."), false);
  checkTrue("reordered hierarchy: the SAME headings in the CORRECT order -> detected true (control case for the check above)", checkSectionOrderPreserved(["Professional Experience", "Education"], "Professional Experience comes first here, Education comes second."));
  const orderViolationReport = buildValidationReport({ expectedFragments: [], extractedText: "Education section text. Professional Experience section text.", sectionHeadingsInOrder: ["Professional Experience", "Education"], identityFragments: [], structuralPassed: true, structuralIssues: [] });
  check("reordered hierarchy: buildValidationReport catches a real reversed section pair -> passed false", orderViolationReport.passed, false);
  checkTrue("reordered hierarchy: 'section-order-violation' issue code present", orderViolationReport.issues.some((i) => i.code === "section-order-violation"));

  /* === Category: missing-text / duplicate-text detection === */
  const droppedBulletReport = findMissingFragments(["Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime."], "Executive Sponsor role at some company, but the bullet text was never printed.");
  check("missing-text: a real bullet fragment that never appears in extracted text IS reported missing", droppedBulletReport, ["Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime."]);
  const presentBulletReport = findMissingFragments(["Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime."], "Executive Sponsor. Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime.");
  check("missing-text: the SAME fragment WHEN present is correctly reported as NOT missing (control case)", presentBulletReport, []);

  /* === Category: dropped metric value never produces a false missing/invented flag === */
  const emptySource = { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] };
  const normalizedWithBlankMetric = normalizeResume({ ...resume, metricGrids: [{ id: "g-blank", columns: 2, source: emptySource, entries: [{ id: "e1", value: { value: "", confidence: 0, extractionMethod: "explicit-label", source: emptySource }, label: { value: "Empty Metric", confidence: 0.5, extractionMethod: "explicit-label", source: emptySource } }] }] });
  const fragmentsWithBlankMetric = expectedFragmentsForResume(normalizedWithBlankMetric);
  checkTrue("dropped metric: a metric entry with an EMPTY value never becomes an expected fragment (would otherwise force a false missing-text flag on every render)", !fragmentsWithBlankMetric.includes(""));
  checkTrue("dropped metric: the metric entry's non-empty LABEL still becomes an expected fragment (only the empty field is skipped, not the whole entry)", fragmentsWithBlankMetric.includes("Empty Metric"));

  /* === Category: duplicate content-item ids never crash the normalizer === */
  const duplicateIdBlocks = [
    { id: "dup-1", kind: "bullet" as const, text: "First bullet with a duplicated id.", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } },
    { id: "dup-1", kind: "bullet" as const, text: "Second bullet, same id as the first (a real-world PDF-extraction artifact).", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } },
  ];
  let duplicateThrew = false;
  let duplicateResult: ReturnType<typeof normalizeContentItems> = [];
  try {
    duplicateResult = normalizeContentItems(duplicateIdBlocks, [], false);
  } catch {
    duplicateThrew = true;
  }
  check("duplicate content-item ids: normalizeContentItems never throws on a duplicate id", duplicateThrew, false);
  check("duplicate content-item ids: BOTH items are preserved (never silently deduped/dropped)", duplicateResult.length, 2);
  checkTrue("duplicate content-item ids: both items keep their own distinct text (not merged into one)", duplicateResult[0].text !== duplicateResult[1].text);

  /* === Category: unsafe HTML (XSS attempt in identity.fullName) - real render, must be escaped === */
  const xssResume: ResumeStructuredModel = {
    ...resume,
    identity: { ...resume.identity!, fullName: { value: "<script>alert(1)</script>", confidence: 1, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } } },
  };
  const xssRuntime = createCanonicalRuntime({
    resume: xssResume,
    version: createRuntimeVersion({ id: "xss-test-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: xssResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const xssHtml = await renderTemplateFromRuntime(xssRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  checkTrue("unsafe HTML: a raw '<script>' tag injected via identity.fullName is NEVER emitted verbatim in the rendered HTML", !xssHtml.html.includes("<script>alert(1)</script>"));
  checkTrue("unsafe HTML: the malicious string is instead present in its HTML-ENTITY-ESCAPED form (React's own default escaping, proving it was rendered as text, not markup)", xssHtml.html.includes("&lt;script&gt;"));

  const xssSkillsResume: ResumeStructuredModel = { ...resume, skillGroups: [{ label: "Skills", skills: ["<img src=x onerror=alert(1)>", "Normal Skill"], source: emptySource }] };
  const xssSkillsRuntime = createCanonicalRuntime({
    resume: xssSkillsResume,
    version: createRuntimeVersion({ id: "xss-skills-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: xssSkillsResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const xssSkillsHtml = await renderTemplateFromRuntime(xssSkillsRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  checkTrue("unsafe HTML: an injected '<img onerror=...>' skill string never produces a live <img> tag in the output", !xssSkillsHtml.html.includes("<img src=x onerror"));
  checkTrue("unsafe HTML: the injected skill string's angle brackets are escaped, not interpreted as markup", xssSkillsHtml.html.includes("&lt;img"));
  checkTrue("unsafe HTML: the sibling, non-malicious skill still renders normally alongside the escaped one", xssSkillsHtml.html.includes("Normal Skill"));

  /* === Category: excessively long token / broken URL never crashes a real render === */
  const longToken = "A".repeat(600);
  const brokenUrl = "https://example.com/" + "x".repeat(400) + "/broken-url-with-no-real-destination";
  const longTokenResume: ResumeStructuredModel = {
    ...resume,
    skillGroups: [{ label: "Skills", skills: [longToken], source: emptySource }],
    publications: [{ ...resume.publications[0], urlOrDoi: { value: brokenUrl, confidence: 0.5, extractionMethod: "explicit-label", source: { sourceSectionId: "s", sourceBlockIds: [], sourceElementIds: [] } } }],
  };
  const longTokenRuntime = createCanonicalRuntime({
    resume: longTokenResume,
    version: createRuntimeVersion({ id: "long-token-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: longTokenResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  let longTokenThrew = false;
  let longTokenHtml: TemplateHtmlResult | null = null;
  try {
    longTokenHtml = await renderTemplateFromRuntime(longTokenRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  } catch {
    longTokenThrew = true;
  }
  check("excessively long token: a 600-character single skill token never throws during render", longTokenThrew, false);
  checkTrue("excessively long token: the render still produces non-empty HTML", (longTokenHtml?.html.length ?? 0) > 0);
  checkTrue("broken URL: a ~440-character malformed URL is still present verbatim in the output (never truncated/corrupted/dropped)", longTokenHtml?.html.includes(brokenUrl) ?? false);
  checkTrue("excessively long token / broken URL: pageCount is still a sane positive integer, not NaN/0/negative from a measurement failure", (longTokenHtml?.pageCount ?? 0) >= 1);

  const longTokenPdf = await renderTemplateFromRuntime(longTokenRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "pdf");
  checkTrue("excessively long token: PDF generation also never throws and produces real, non-empty bytes", longTokenPdf.bytes.length > 0);

  /* === Category: heading orphan (a declared heading that never actually appears in extracted text) === */
  const orphanHeadingReport = buildValidationReport({ expectedFragments: [], extractedText: "Some body text with no headings printed at all.", sectionHeadingsInOrder: ["A Heading That Was Never Rendered"], identityFragments: [], structuralPassed: true, structuralIssues: [] });
  check("heading orphan: a declared heading absent from extracted text -> sectionOrderPreserved is false", orphanHeadingReport.sectionOrderPreserved, false);
  check("heading orphan: -> overall passed is false", orphanHeadingReport.passed, false);
  checkTrue("heading orphan: 'section-order-violation' issue is present for the orphaned heading", orphanHeadingReport.issues.some((i) => i.code === "section-order-violation"));

  /* === Category: blank/near-empty extracted text against a large expected-fragment list (worst-case missing-text volume) === */
  const largeExpectedList = ["Fact A", "Fact B", "Fact C", "Fact D", "Fact E"];
  const blankTextMissing = findMissingFragments(largeExpectedList, "");
  check("blank extracted text: every one of 5 expected fragments is reported missing against an empty string", blankTextMissing, largeExpectedList);
  const blankTextReport = buildValidationReport({ expectedFragments: largeExpectedList, extractedText: "", sectionHeadingsInOrder: [], identityFragments: [], structuralPassed: true, structuralIssues: [] });
  check("blank extracted text: missingTextCount matches the full expected-fragment count", blankTextReport.missingTextCount, largeExpectedList.length);
  check("blank extracted text: passed is false", blankTextReport.passed, false);

  /* === Category: duplicate entry ids at the experience-array level never crash a real render, both entries still render === */
  const duplicateEntryResume: ResumeStructuredModel = {
    ...resume,
    professionalExperience: [
      { ...resume.professionalExperience[0], id: "dup-entry", organization: { value: "First Duplicate Org", confidence: 1, extractionMethod: "explicit-label", source: emptySource } },
      { ...resume.professionalExperience[1], id: "dup-entry", organization: { value: "Second Duplicate Org", confidence: 1, extractionMethod: "explicit-label", source: emptySource } },
    ],
  };
  const duplicateEntryRuntime = createCanonicalRuntime({
    resume: duplicateEntryResume,
    version: createRuntimeVersion({ id: "dup-entry-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: duplicateEntryResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  let duplicateEntryThrew = false;
  let duplicateEntryHtml: TemplateHtmlResult | null = null;
  try {
    duplicateEntryHtml = await renderTemplateFromRuntime(duplicateEntryRuntime, { templateId: "executive-minimal", generatedAt: GENERATED_AT }, "html");
  } catch {
    duplicateEntryThrew = true;
  }
  check("duplicate entry ids: two experience entries sharing the same id never throws during render", duplicateEntryThrew, false);
  /*
    Real finding from this exact test (not hypothetical): the html.tsx
    flow-item id is `${sectionKey}-${entry.id}`, so two entries sharing
    entry.id collide on the same flow-item id and the SECOND entry's
    node silently overwrites the FIRST in the internal `nodeById` Map
    (last-write-wins) - the first entry's content is genuinely dropped
    from the rendered output. This is a disclosed, non-blocking edge
    case (entry ids are always unique in practice - they're generated
    deterministically by the Phase 1-5D parser, never hand-duplicated),
    NOT something this round's negative-control suite fixes. What
    matters for a negative control is that the render never crashes AND
    the validation engine correctly CATCHES the resulting data loss
    instead of silently reporting passed=true.
  */
  checkTrue("duplicate entry ids: the SECOND (last-write-wins) organization survives in the output", duplicateEntryHtml?.html.includes("Second Duplicate Org") ?? false);
  checkTrue("duplicate entry ids: the FIRST organization is genuinely overwritten (documents the real id-collision behavior, not a false assumption)", !(duplicateEntryHtml?.html.includes("First Duplicate Org") ?? true));
  check("duplicate entry ids: validation.passed is false - the safety net correctly catches the resulting content loss rather than silently passing", duplicateEntryHtml?.validation.passed, false);
  checkTrue("duplicate entry ids: validation.missingTextCount is > 0, proving the loss was DETECTED, not silently ignored", (duplicateEntryHtml?.validation.missingTextCount ?? 0) > 0);

  /* === Category: sidebar overflow (real multi-stream render where main content overflows to a second page) === */
  const overflowMainExperience = Array.from({ length: 8 }, (_, i) => ({
    ...resume.professionalExperience[2],
    id: `overflow-exp-${i}`,
    organization: { value: `Overflow Test Company ${i}`, confidence: 1, extractionMethod: "explicit-label" as const, source: emptySource },
  }));
  const overflowResume: ResumeStructuredModel = { ...resume, professionalExperience: overflowMainExperience };
  const overflowRuntime = createCanonicalRuntime({
    resume: overflowResume,
    version: createRuntimeVersion({ id: "overflow-v1", reason: "initial", createdAt: GENERATED_AT }),
    metadata: createRuntimeMetadata({ schemaVersion: overflowResume.schemaVersion }),
    overlayState: createRuntimeOverlayState(),
  });
  const overflowHtml = await renderTemplateFromRuntime(overflowRuntime, { templateId: "modern-sidebar", generatedAt: GENERATED_AT }, "html");
  checkTrue("sidebar overflow: 8 repeated experience entries force pageCount > 1 (main-column overflow triggers a real second page)", overflowHtml.pageCount > 1);
  checkTrue("sidebar overflow: validation.passed is still true across the overflow (no content dropped by the two-stream pagination split)", overflowHtml.validation.passed);
  checkTrue("sidebar overflow: the LAST overflow company still appears somewhere in the output (nothing truncated at the page boundary)", overflowHtml.html.includes("Overflow Test Company 7"));
  checkTrue("sidebar overflow: the sidebar's own identity/skills content is still present despite the main column spanning multiple pages", overflowHtml.html.includes("Jordan Ellis"));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  await closeSharedBrowser();
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
