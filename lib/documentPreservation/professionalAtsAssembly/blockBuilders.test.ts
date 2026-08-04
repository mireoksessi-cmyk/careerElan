/*
  TASK 5 gate test - block builders. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/blockBuilders.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import {
  buildExperienceEntryBlock,
  buildEducationEntryBlock,
  buildCredentialEntryBlock,
  buildProjectEntryBlock,
  buildAwardEntryBlock,
  buildPublicationEntryBlock,
  buildCustomSectionBlock,
  buildSkillGroupBlock,
  buildSummaryBlock,
  buildIdentityBlock,
} from "./blockBuilders";

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

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function main() {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "threepage-pdf-resume.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: "threepage-pdf-resume.pdf", fileType: "pdf" });
  const model = buildStructuredResume(document);

  // ==================== Experience / Volunteer ====================
  checkTrue("threepage: has professionalExperience entries", model.professionalExperience.length > 0);
  checkTrue("threepage: has volunteerExperience entries", model.volunteerExperience.length > 0);
  model.professionalExperience.forEach((entry, i) => {
    const block = buildExperienceEntryBlock(entry, i);
    check(`experience block[${i}]: kind`, block.kind, "experience-entry");
    check(`experience block[${i}]: sourceEntryId matches Phase 2 entry id`, block.sourceEntryId, entry.id);
    check(`experience block[${i}]: sourceSectionIds = [entry.source.sourceSectionId]`, block.sourceSectionIds, [entry.source.sourceSectionId]);
    check(`experience block[${i}]: sourceBlockIds copied verbatim, no invention`, block.sourceBlockIds, entry.source.sourceBlockIds);
    check(`experience block[${i}]: priority = array index`, block.priority, i);
    check(`experience block[${i}]: isUncertain mirrors Phase 2`, block.isUncertain, entry.isUncertain);
    checkTrue(`experience block[${i}]: payload IS the same entry object (no copy/rewrite)`, block.payload === entry);
    checkTrue(`experience block[${i}]: estimatedContentUnits >= 1`, block.estimatedContentUnits >= 1);
  });
  model.volunteerExperience.forEach((entry) => {
    const block = buildExperienceEntryBlock(entry, 0);
    check("volunteer entry -> kind=volunteer-entry (never experience-entry)", block.kind, "volunteer-entry");
  });

  // ==================== Education ====================
  checkTrue("threepage: has education entries", model.education.length > 0);
  model.education.forEach((entry, i) => {
    const block = buildEducationEntryBlock(entry, i);
    check(`education block[${i}]: kind`, block.kind, "education-entry");
    check(`education block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, entry.source.sourceBlockIds);
    check(`education block[${i}]: isUncertain mirrors Phase 2`, block.isUncertain, entry.isUncertain);
  });

  // ==================== Credentials ====================
  checkTrue("threepage: has credential entries", model.credentials.length > 0);
  model.credentials.forEach((entry, i) => {
    const block = buildCredentialEntryBlock(entry, i);
    check(`credential block[${i}]: kind`, block.kind, "credential-entry");
    check(`credential block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, entry.source.sourceBlockIds);
  });

  // ==================== Custom sections ====================
  checkTrue("threepage: has custom sections", model.customSections.length > 0);
  model.customSections.forEach((section, i) => {
    const block = buildCustomSectionBlock(section, i);
    check(`custom block[${i}]: kind`, block.kind, "custom-section");
    check(`custom block[${i}]: sourceEntryId = section.id`, block.sourceEntryId, section.id);
    check(`custom block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, section.source.sourceBlockIds);
  });

  // ==================== Skill groups ====================
  checkTrue("threepage: has skill groups", model.skillGroups.length > 0);
  model.skillGroups.forEach((group, i) => {
    const block = buildSkillGroupBlock(group, i);
    check(`skill-group block[${i}]: kind`, block.kind, "skill-group");
    check(`skill-group block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, group.source.sourceBlockIds);
  });

  // ==================== Summary ====================
  checkTrue("threepage: has professionalSummary", model.professionalSummary !== undefined);
  if (model.professionalSummary) {
    const block = buildSummaryBlock(model.professionalSummary);
    check("summary block: kind", block.kind, "summary");
    check("summary block: sourceBlockIds preserved", block.sourceBlockIds, model.professionalSummary.source.sourceBlockIds);
  }

  // ==================== Identity ====================
  checkTrue("threepage: has identity", model.identity !== undefined);
  if (model.identity) {
    const block = buildIdentityBlock("identity", ["some-block"], model.identity);
    check("identity block: kind", block.kind, "identity");
    checkTrue("identity block: payload is the identity object itself", block.payload === model.identity);
  }

  // ==================== Synthetic-only entry types (projects/awards/publications not in threepage) ====================
  const f4Buffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f4-projects.docx"));
  const f4Layout = await analyzeDocument("resume", "docx", f4Buffer);
  const f4Doc = buildLosslessResumeDocument(f4Layout, { fileName: "f4-projects.docx", fileType: "docx" });
  const f4Model = buildStructuredResume(f4Doc);
  checkTrue("f4: has project entries", f4Model.projects.length > 0);
  f4Model.projects.forEach((entry, i) => {
    const block = buildProjectEntryBlock(entry, i);
    check(`project block[${i}]: kind`, block.kind, "project-entry");
    check(`project block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, entry.source.sourceBlockIds);
  });

  const f1Buffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f1-career-profile-awards-custom.docx"));
  const f1Layout = await analyzeDocument("resume", "docx", f1Buffer);
  const f1Doc = buildLosslessResumeDocument(f1Layout, { fileName: "f1-career-profile-awards-custom.docx", fileType: "docx" });
  const f1Model = buildStructuredResume(f1Doc);
  checkTrue("f1: has award entries", f1Model.awards.length > 0);
  f1Model.awards.forEach((entry, i) => {
    const block = buildAwardEntryBlock(entry, i);
    check(`award block[${i}]: kind`, block.kind, "award-entry");
    check(`award block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, entry.source.sourceBlockIds);
  });

  const f3Buffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f3-combined-licenses-certifications.docx"));
  const f3Layout = await analyzeDocument("resume", "docx", f3Buffer);
  const f3Doc = buildLosslessResumeDocument(f3Layout, { fileName: "f3-combined-licenses-certifications.docx", fileType: "docx" });
  const f3Model = buildStructuredResume(f3Doc);
  checkTrue("f3: has publication entries", f3Model.publications.length > 0);
  f3Model.publications.forEach((entry, i) => {
    const block = buildPublicationEntryBlock(entry, i);
    check(`publication block[${i}]: kind`, block.kind, "publication-entry");
    check(`publication block[${i}]: sourceBlockIds preserved`, block.sourceBlockIds, entry.source.sourceBlockIds);
  });

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
