/*
  TASK 6 gate test - projects, awards, publications, custom section
  preservation. Run with
  `npx tsx lib/documentPreservation/resumeStructured/remainingExtractors.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractProjectEntries } from "./projectExtractor";
import { extractAwardEntries } from "./awardExtractor";
import { extractPublicationEntries } from "./publicationExtractor";
import { adaptCustomSection } from "./customSectionAdapter";
import type { LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";

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

let counter = 0;
function block(text: string, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const i = counter++;
  return { id: `block-p0-b${i}`, sourceElementIds: [`el-p0-e${i}`], text, rawText: text, pageIndex: 0, sourceOrder: i, blockType };
}

// ==================== Projects (synthetic, f4 shape) ====================
const projectBlocks = [
  block("Shift Scheduler"),
  block("Built a small web app for volunteer shift scheduling using TypeScript, React, PostgreSQL.", "bullet"),
  block("Transit Delay Tracker"),
  block("Developed a script that polls a public transit API and logs delay patterns.", "bullet"),
];
const projects = extractProjectEntries("s1", projectBlocks);
check("projects: two distinct projects", projects.length, 2);
check("projects: entry1 name", projects[0].name?.value, "Shift Scheduler");
check("projects: entry2 name", projects[1].name?.value, "Transit Delay Tracker");
check("projects: technologies extracted from 'using X, Y, Z' phrasing", projects[0].technologies.map((t) => t.value), ["TypeScript", "React", "PostgreSQL"]);

// ==================== Awards (synthetic, f1 shape) ====================
counter = 0;
const awardBlocks = [block("Northline Media Rising Star Award, 2022", "bullet"), block("Bluepeak Agency Client Excellence Award, 2019", "bullet")];
const awards = extractAwardEntries("s1", awardBlocks);
check("awards: two distinct awards", awards.length, 2);
check("awards: entry1 name", awards[0].name?.value, "Northline Media Rising Star Award");
check("awards: entry1 date", awards[0].dateText?.value, "2022");

// ==================== Publications (synthetic, f3 shape) ====================
counter = 0;
const pubBlocks = [block("Chandran, P. (2021). Community nutrition outreach in rural Nova Scotia. Atlantic Health Journal, 14(2).")];
const publications = extractPublicationEntries("s1", pubBlocks);
check("publications: one entry produced", publications.length, 1);
check("publications: authors extracted", publications[0].authors[0]?.value, "Chandran, P");
check("publications: date extracted", publications[0].dateText?.value, "2021");
check("publications: title extracted", publications[0].title?.value, "Community nutrition outreach in rural Nova Scotia");
checkTrue("publications: full raw citation ALSO preserved in details regardless of field extraction", publications[0].details[0].value === pubBlocks[0].rawText);

// --- publication with no year anchor: preserved as detail-only, not dropped ---
counter = 0;
const noYearPub = [block("An informal talk given at a regional conference, no formal citation available.")];
const noYearPubs = extractPublicationEntries("s1", noYearPub);
checkTrue("publications no-year: entry preserved, not deleted", noYearPubs.length === 1);
checkTrue("publications no-year: isUncertain=true", noYearPubs[0].isUncertain);
check("publications no-year: full text preserved in details", noYearPubs[0].details[0].value, noYearPub[0].rawText);

// ==================== Custom section preservation ====================
counter = 0;
const customSection: LosslessResumeSection = {
  id: "section-s7",
  originalHeading: "Board & Leadership Activities",
  normalizedHeading: "board and leadership activities",
  normalizedType: "custom",
  displayHeading: "Board & Leadership Activities",
  sourceOrder: 7,
  startPageIndex: 0,
  endPageIndex: 0,
  confidence: 0,
  classificationMethod: "fallback",
  reasonCodes: ["below-classification-confidence-threshold"],
  blocks: [block("Board & Leadership Activities", "heading"), block("Board Director"), block("Serves on the board of a manufacturing association.", "bullet")],
  rawText: "",
  isUncertain: true,
};
const custom = adaptCustomSection(customSection);
check("custom: originalHeading preserved verbatim", custom.originalHeading, "Board & Leadership Activities");
check("custom: sourceOrder preserved", custom.sourceOrder, 7);
check("custom: heading block excluded from paragraphs/bullets, but section.source still traces it", custom.paragraphs.length + custom.bullets.length, 2);
checkTrue("custom: source trace includes the heading block too (nothing dropped)", custom.source.sourceBlockIds.length === 3);

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function main() {
  // Real-fixture spot check: projects (f4)
  const f4Buffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f4-projects.docx"));
  const f4Layout = await analyzeDocument("resume", "docx", f4Buffer);
  const f4Doc = buildLosslessResumeDocument(f4Layout, { fileName: "f4-projects.docx", fileType: "docx" });
  const f4ProjSection = f4Doc.sections.find((s) => s.normalizedType === "projects");
  checkTrue("f4-projects.docx: has a projects section", f4ProjSection !== undefined);
  if (f4ProjSection) {
    const realProjects = extractProjectEntries(f4ProjSection.id, f4ProjSection.blocks.filter((b) => b.blockType !== "heading"));
    check("f4-projects.docx: two real projects detected", realProjects.length, 2);
  }

  // Real-fixture spot check: awards (f1)
  const f1Buffer = fs.readFileSync(path.join(FIXTURES_DIR, "lossless-synthetic/f1-career-profile-awards-custom.docx"));
  const f1Layout = await analyzeDocument("resume", "docx", f1Buffer);
  const f1Doc = buildLosslessResumeDocument(f1Layout, { fileName: "f1-career-profile-awards-custom.docx", fileType: "docx" });
  const f1AwardSection = f1Doc.sections.find((s) => s.normalizedType === "awards");
  checkTrue("f1: has an awards section", f1AwardSection !== undefined);
  if (f1AwardSection) {
    const realAwards = extractAwardEntries(f1AwardSection.id, f1AwardSection.blocks.filter((b) => b.blockType !== "heading"));
    check("f1: two real awards detected", realAwards.length, 2);
  }
  const f1CustomSection = f1Doc.sections.find((s) => s.originalHeading === "Speaking & Media Appearances");
  checkTrue("f1: unknown custom heading section exists in Phase 1 output", f1CustomSection !== undefined);
  if (f1CustomSection) {
    const realCustom = adaptCustomSection(f1CustomSection);
    checkTrue("f1: custom section adapter preserves it with originalHeading intact", realCustom.originalHeading === "Speaking & Media Appearances");
  }

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
