/*
  TASK 5 gate test - credential (certification/license) extraction.
  Calibrated against real fixtures: bench/resume-E-senior-ats.pdf
  (self-contained one-line certs), generated-sidebar-professional.pdf
  (wrapped across 2 lines), lossless-synthetic/f2 (license, no explicit
  issuer word). Run with
  `npx tsx lib/documentPreservation/resumeStructured/credentialExtractor.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { extractCredentialEntries } from "./credentialExtractor";
import type { SemanticContentBlock } from "../losslessSemantic/types";

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

// --- self-contained one-line entries (bench-E real shape) ---
const oneLiners = [block("Certified Six Sigma Black Belt - ASQ, 2014"), block("Gold Seal Certified Project Manager - CCA, 2011")];
const oneLinerEntries = extractCredentialEntries("s1", oneLiners);
check("one-liners: two distinct entries", oneLinerEntries.length, 2);
check("one-liners: entry1 name", oneLinerEntries[0].name?.value, "Certified Six Sigma Black Belt");
check("one-liners: entry1 issuer", oneLinerEntries[0].issuer?.value, "ASQ");
check("one-liners: entry1 date", oneLinerEntries[0].issueDateText?.value, "2014");
check("one-liners: entry1 classified as certification", oneLinerEntries[0].kind, "certification");

// --- wrapped across 2 lines (generated-sidebar-professional.pdf real shape) ---
counter = 0;
const wrapped = [block("Certified Supply Chain"), block("Professional - APICS, 2021")];
const wrappedEntries = extractCredentialEntries("s1", wrapped);
check("wrapped: exactly ONE entry (not split into two)", wrappedEntries.length, 1);
check("wrapped: name spans both wrapped lines", wrappedEntries[0].name?.value, "Certified Supply Chain Professional");
check("wrapped: issuer extracted from the closing line", wrappedEntries[0].issuer?.value, "APICS");
check("wrapped: date extracted", wrappedEntries[0].issueDateText?.value, "2021");

// --- license, no explicit issuer word (f2 real shape) ---
counter = 0;
const license = [
  block("Certificate of Qualification, Construction and Maintenance Electrician, Manitoba — 2019"),
  block("Red Seal Endorsement — 2020"),
];
const licenseEntries = extractCredentialEntries("s1", license);
check("license: two distinct entries", licenseEntries.length, 2);
check("license: entry1 date preserved", licenseEntries[0].issueDateText?.value, "2019");
check("license: entry2 date preserved", licenseEntries[1].issueDateText?.value, "2020");

// --- bullet-separated entries ---
counter = 0;
const bullets = [block("• PMP - PMI, 2020", "bullet"), block("• AWS Certified Solutions Architect - Amazon, 2022", "bullet")];
const bulletEntries = extractCredentialEntries("s1", bullets);
check("bullets: two distinct entries, glyph stripped", bulletEntries.length, 2);
check("bullets: name has no leftover bullet glyph", bulletEntries[0].name?.value, "PMP");

// --- no-date credential, not deleted ---
counter = 0;
const noDate = [block("Six Sigma Yellow Belt (in progress)")];
const noDateEntries = extractCredentialEntries("s1", noDate);
check("no-date: entry preserved, not deleted", noDateEntries.length, 1);
checkTrue("no-date: isUncertain=true", noDateEntries[0].isUncertain);
check("no-date: rawHeaderText preserved verbatim", noDateEntries[0].rawHeaderText, "Six Sigma Yellow Belt (in progress)");

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

async function checkRealFixture(fileName: string, format: "pdf" | "docx", sectionTypes: string[], expectedMinEntries: number) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });

  const section = doc.sections.find((s) => sectionTypes.includes(s.normalizedType));
  checkTrue(`${fileName}: has a certifications/licenses section`, section !== undefined);
  if (!section) return;
  const bodyBlocks = section.blocks.filter((b) => b.blockType !== "heading");
  const entries = extractCredentialEntries(section.id, bodyBlocks);
  checkTrue(`${fileName}: at least ${expectedMinEntries} credential entries detected`, entries.length >= expectedMinEntries);
  checkTrue(`${fileName}: every entry traces back to real blocks`, entries.every((e) => e.source.sourceBlockIds.length > 0));
}

async function main() {
  await checkRealFixture("bench/resume-E-senior-ats.pdf", "pdf", ["certifications"], 2);
  await checkRealFixture("generated-sidebar-professional.pdf", "pdf", ["certifications"], 2);
  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
