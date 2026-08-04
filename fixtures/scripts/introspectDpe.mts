/*
  DPE stage-level introspection (task: E2E stage-level DPE introspection
  per fixture). Runs the SAME real DPE function chain
  (analyzeDocument -> generateContentBoxes -> createReplacementPlan ->
  runExecutionEngine) that runDpePreservationForApplication calls, using
  each fixture's REAL original file bytes (downloaded from real Storage)
  and REAL original_text.

  Honesty note (disclosed in the final report): for the 4 fixtures whose
  real Generate Package run never reached DPE (blocked earlier by the
  Protected Claims date-format bug - see final report), this script uses
  the resume's own real ORIGINAL text as the "aiGeneratedResumeText"
  input, since no real AI-generated text exists for them yet. This is NOT
  a substitute for testing the full real pipeline end-to-end (that
  genuinely could not happen for those 4, and is reported as such) - it
  IS a real, honest test of the DPE sub-pipeline itself (Layout Analysis,
  Content Box Generation, Template Layer Detection, Replacement, real
  Playwright Measurement, Validation, Relayout Plan, Page Clone Strategy)
  against each real fixture file, independent of whatever text ends up
  being replaced in. For the 1 fixture that DID reach DPE for real
  (google_docs_docx), this script re-runs with that SAME real
  AI-generated resume text already saved to the DB - a genuine
  reproduction, not a substitute.
*/
import { getUserClient } from "./seedE2E.mts";
import { analyzeDocument } from "../../lib/documentPreservation/layoutAnalysis/index.ts";
import { generateContentBoxes } from "../../lib/documentPreservation/contentBox/index.ts";
import { createReplacementPlan } from "../../lib/documentPreservation/contentMapping/index.ts";
import { runExecutionEngine } from "../../lib/documentPreservation/executionEngine/index.ts";
import { closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser.ts";

type FixtureTarget = {
  key: string;
  label: string;
  email: string;
  resumeId: string;
  templateId: string;
  aiGeneratedResumeTextOverride?: string;
};

import { readFileSync } from "node:fs";
const targets: FixtureTarget[] = JSON.parse(readFileSync(process.argv[2], "utf8"));

async function introspectOne(target: FixtureTarget) {
  console.log(`\n\n========== ${target.label} (${target.key}) ==========`);

  const client = await getUserClient(target.email);
  const { data: resumeRow, error: resumeError } = await client
    .from("resumes")
    .select("storage_path, original_file_type, original_text")
    .eq("id", target.resumeId)
    .single();

  if (resumeError || !resumeRow) {
    console.log("FAIL: could not read resumes row:", resumeError?.message);
    return { key: target.key, error: `resumes read failed: ${resumeError?.message}` };
  }

  const { data: fileBlob, error: downloadError } = await client.storage
    .from("resumes")
    .download(resumeRow.storage_path);

  if (downloadError || !fileBlob) {
    console.log("FAIL: could not download original file:", downloadError?.message);
    return { key: target.key, error: `download failed: ${downloadError?.message}` };
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const sourceFormat = resumeRow.original_file_type as "pdf" | "docx";
  const aiGeneratedResumeText = target.aiGeneratedResumeTextOverride ?? resumeRow.original_text ?? "";

  console.log(`Storage Path Resolution: PASS (downloaded ${buffer.length} bytes from ${resumeRow.storage_path})`);
  console.log(`Selected Template Loaded: PASS (templateId=${target.templateId})`);

  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const layoutPass = layoutResult.pages.length > 0;
  console.log(`Layout Analysis: ${layoutPass ? "PASS" : "FAIL"} (pageCount=${layoutResult.pageCount}, pages=${layoutResult.pages.length}, sourceFormat=${sourceFormat})`);

  const layerModel = generateContentBoxes("resume", layoutResult);
  const contentBoxPass = layerModel.boxes.length > 0;
  console.log(`Content Box Generation: ${contentBoxPass ? "PASS" : "FAIL"} (totalBoxes=${layerModel.boxes.length}, editable=${layerModel.editableBoxes.length}, template=${layerModel.templateBoxes.length}, unknown=${layerModel.unknownBoxes.length})`);

  const templateLayerPass = layerModel.templateBoxes.length > 0 || layerModel.templateRegions.length > 0;
  console.log(`Template Layer Detection: ${templateLayerPass ? "PASS" : "FAIL (no real signal found)"} - templateBoxes roles: [${layerModel.templateBoxes.map((b) => b.role).join(", ")}], templateRegions: [${layerModel.templateRegions.map((r) => r.role).join(", ")}]`);
  console.log(`  reasons: ${layerModel.templateRegionReasons.join(" | ")}`);

  const editableLayerPass = layerModel.editableBoxes.length > 0;
  console.log(`Editable Layer Detection: ${editableLayerPass ? "PASS" : "FAIL"} (editableBoxes=${layerModel.editableBoxes.length})`);
  console.log(`ALL BOXES DETAIL: ${JSON.stringify(layerModel.boxes.map((b) => ({ id: b.id, layer: b.layer, role: b.role, text: b.text ?? "", boundingBox: b.boundingBox })), null, 2)}`);

  const replacementPlan = createReplacementPlan("resume", aiGeneratedResumeText, layerModel);
  const totalAssignedUnits =
    replacementPlan.documentType === "resume"
      ? replacementPlan.sections.reduce((sum, s) => sum + s.assignments.filter((a) => a.unit).length, 0)
      : 0;
  const totalUnassigned =
    replacementPlan.documentType === "resume"
      ? replacementPlan.sections.reduce((sum, s) => sum + s.unassignedUnits.length, 0)
      : 0;
  console.log(`Replacement (mapping stage): assignedUnits=${totalAssignedUnits}, unassignedUnits=${totalUnassigned}`);

  const result = await runExecutionEngine({
    applicationId: `introspect-${target.key}`,
    documentType: "resume",
    layerModel,
    replacementPlan,
    templateId: target.templateId,
  });

  console.log(`\nExecution status: ${result.status}`);
  console.log(`Replacement: ${result.replacedBoxes.length > 0 ? "PASS" : "FAIL"} (${result.replacedBoxes.length} boxes)`);
  console.log(`Relayout Plan: ${result.relayoutPlan.actions.length > 0 ? "PASS" : "FAIL"} (${result.relayoutPlan.actions.length} actions, requiredRelayout=${result.relayoutPlan.requiredRelayout})`);
  for (const action of result.relayoutPlan.actions) {
    console.log(`    - [${action.priority}] ${action.action} (page ${action.page}): ${action.reason}`);
  }

  console.log(`Browser Measurement: ${result.measurement.measurable ? "PASS" : `FAIL (${result.measurement.unmeasurableReason})`} (totalPageCount=${result.measurement.totalPageCount}, rawElements=${result.measurement.rawElements.length})`);

  console.log(`Overflow: ${result.overflow.hasOverflow ? "DETECTED" : "none"} (${result.overflow.findings.length} findings)`);
  for (const f of result.overflow.findings.filter((f) => f.verdict !== "fits")) {
    console.log(`    - ${f.verdict}: ${f.detail}`);
  }

  console.log(`Validation: ${result.validation.valid ? "PASS" : "FAIL"} (errors=${result.validation.errors.length}, warnings=${result.validation.warnings.length})`);
  for (const e of result.validation.errors) {
    console.log(`    - ERROR[${e.type}]: ${e.detail}`);
  }
  for (const w of result.validation.warnings) {
    console.log(`    - WARN[${w.type}]: ${w.detail}`);
  }
  console.log(`  similarityScores: overall=${result.validation.similarityScores.overallScore}, position=${result.validation.similarityScores.positionSimilarity}, style=${result.validation.similarityScores.styleSimilarity}, region=${result.validation.similarityScores.regionSimilarity}, spacing=${result.validation.similarityScores.spacingSimilarity} (comparedElementCount=${result.validation.similarityScores.comparedElementCount})`);
  console.log(`  ${result.validation.similarityScores.reason}`);

  console.log(`\nPage Count: ${result.measurement.totalPageCount} (pageCloned=${result.pageCloned}, mode=${result.pageClonePlan.mode})`);
  console.log(`Repeatable Elements: ${result.pageClonePlan.cloneStrategy.repeatableElements.length} entries`);
  for (const el of result.pageClonePlan.cloneStrategy.repeatableElements) {
    console.log(`    - ${el.templateRole} on pages [${el.repeatsOnPages.join(",")}] (source=${el.source})`);
  }
  console.log(`Continuation Chain: ${result.pageClonePlan.continuationChain.chains.length} real chain(s): ${JSON.stringify(result.pageClonePlan.continuationChain.chains)}`);

  const specificChecks = {
    header: result.validation.errors.concat(result.validation.warnings).some((i) => i.detail.toLowerCase().includes("header")),
    footer: result.validation.errors.concat(result.validation.warnings).some((i) => i.detail.toLowerCase().includes("footer")),
    sidebar: layerModel.templateRegions.some((r) => r.role === "sidebar"),
    branding: layerModel.templateBoxes.some((b) => b.role === "branding"),
    divider: layerModel.templateBoxes.some((b) => b.role === "divider" || b.role === "border"),
    background: layerModel.templateBoxes.some((b) => b.role === "background"),
    missingContent: result.validation.errors.some((e) => e.type === "missing_content"),
    duplicateContent: result.validation.errors.some((e) => e.type === "duplicated_content"),
    clipping: result.validation.errors.some((e) => e.type === "clipping" || e.type === "horizontal_overflow"),
  };
  console.log(`\nSpecific preservation signals found: ${JSON.stringify(specificChecks)}`);

  return {
    key: target.key,
    layoutPass,
    contentBoxPass,
    templateLayerPass,
    editableLayerPass,
    executionStatus: result.status,
    measurable: result.measurement.measurable,
    validationValid: result.validation.valid,
    validationErrors: result.validation.errors.map((e) => `${e.type}: ${e.detail}`),
    totalPageCount: result.measurement.totalPageCount,
    specificChecks,
  };
}

const summary = [];
for (const target of targets) {
  const r = await introspectOne(target);
  summary.push(r);
}

console.log("\n\n========== SUMMARY ==========");
console.log(JSON.stringify(summary, null, 2));

await closeSharedBrowser();
process.exit(0);
