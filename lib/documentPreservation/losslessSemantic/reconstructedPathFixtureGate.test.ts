/*
  Reconstructed production-path fixture gate.

  WHY THIS FILE EXISTS
    Every other fixture gate runs buildLosslessResumeDocument straight into
    buildStructuredResume. The canonical import does not: it rejoins wrapped
    physical lines in between (canonicalResumeImportService.ts, the
    reconstructWrappedLines call between the lossless gate and the structured
    build). So no gate in this repository executes that stage, and a change to
    it - in either direction - moves no gate number at all. Two import-blocking
    failures were repaired on the real path while every gate kept reporting the
    number it reported before.

  WHY IT DOES NOT CALL THE SERVICE
    CanonicalResumeImportService.importResume downloads from storage, reads
    repositories and writes profile and source-document rows. It takes database
    ids, not a file. None of that is available or desirable here, so this gate
    composes the same four production functions in the same order instead. That
    mirrors a composition rather than owning it: if the service ever gains a
    stage, this file has to follow it by hand. It is deliberately the smallest
    thing that ends the blindness, not a second copy of the parser.

  WHAT IT ASSERTS
    Field-level semantics on the two fixtures whose repairs the path exists to
    protect, plus one structural count. The count is not decoration: the
    section-stream adjacency fix changed 35 merges and not one structured
    field, so semantics alone cannot see it regress. Only the block count can.

  Run with `npx tsx lib/documentPreservation/losslessSemantic/reconstructedPathFixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "./buildLosslessDocument";
import { reconstructWrappedLines } from "./wrappedLineReconstruction";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import type { LosslessResumeDocument } from "./types";

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

function blockCount(document: LosslessResumeDocument): number {
  return document.sections.reduce((total, section) => total + section.blocks.length, 0);
}

/* The production composition, in production order. */
async function runProductionPath(file: string) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
  const layout = await analyzeDocument("resume", "pdf", buffer);
  const lossless = buildLosslessResumeDocument(layout, { fileName: file, fileType: "pdf" });
  const reconstructed = reconstructWrappedLines(lossless);
  return {
    model: buildStructuredResume(reconstructed),
    rawBlocks: blockCount(lossless),
    reconstructedBlocks: blockCount(reconstructed),
  };
}

async function main() {
  /*
    A two-column resume whose Education wraps inside the narrow right
    column: the institution line runs out of room mid-date-range and the
    closing year lands on the line below.
  */
  {
    const { model } = await runProductionPath("regtest3-two-column-pdf.pdf");
    const education = model.education[0];

    check("regtest3: one education entry is recovered", model.education.length, 1);
    check("regtest3: the credential is read", education?.credential?.value, "Bachelor of Commerce");
    check("regtest3: the institution is whole", education?.institution?.value, "University of Toronto");
    check("regtest3: the wrapped date range is closed", education?.dateRangeText?.value, "2015 to 2019");
    check("regtest3: nothing is invented on the reconstructed path", model.validation.inventedFactValues, []);

    /*
      The line above the wrap is a finished credential line that also ends
      flush against the same narrow margin. Fusing it into the institution
      is the over-merge this path has to keep refusing, and it shows up
      here as the field of study swallowed into the school's name.
    */
    checkTrue(
      "regtest3: the credential line is not fused into the institution",
      !(education?.institution?.value ?? "").includes("Finance")
    );
  }

  /*
    A sidebar resume whose certification wraps on a dangling dash, its
    issuing body carrying onto the next line as an acronym.
  */
  {
    const { model, rawBlocks, reconstructedBlocks } = await runProductionPath("bench/resume-F-senior-canva.pdf");
    const goldSeal = model.credentials.find((entry) => (entry.name?.value ?? "").startsWith("Gold Seal"));

    check("resume-F: the wrapped credential title is whole", goldSeal?.name?.value, "Gold Seal Certified Project Manager");
    check("resume-F: its issuer is a field, not part of the title", goldSeal?.issuer?.value, "CCA");
    check("resume-F: nothing is invented on the reconstructed path", model.validation.inventedFactValues, []);

    /* Surrounding structure, so a repair here cannot quietly cost content. */
    check("resume-F: identity survives", model.identity?.fullName?.value, "Patricia Wallace");
    check("resume-F: every experience entry survives", model.professionalExperience.length, 5);
    check("resume-F: every education entry survives", model.education.length, 3);

    /*
      The structural oracle. Reading a two-column page column-major leaves
      the halves of a wrapped line numbered apart, and reconstruction used
      to require them adjacent - a defect worth 15 merges on this fixture
      that changed no field anywhere in the corpus. Narrow-run evidence is
      worth 3 more. Both are visible here and nowhere else, so this count
      is the only thing standing between either of them and a silent
      regression.
    */
    check("resume-F: the lossless document is unchanged in size", rawBlocks, 123);
    check("resume-F: reconstruction rejoins every wrapped line it should", reconstructedBlocks, 90);
  }

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
