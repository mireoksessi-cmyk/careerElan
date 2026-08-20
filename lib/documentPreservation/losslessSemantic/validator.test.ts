/*
  TASK 6 gate test - full pipeline assembly (blockAdapter ->
  sectionBoundaryDetector -> classifier -> validator) against real
  fixtures, verifying all six section-11 requirements this validator
  actually covers (A-E as report fields, F as a repeat-run equality
  check at the test level). Run with
  `npx tsx lib/documentPreservation/losslessSemantic/validator.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "./buildLosslessDocument";
import { adaptLayoutToBlocks } from "./blockAdapter";
import { orderBlocksForSectionDetection } from "./preSectionRegionOrdering";
import { validateLosslessDocument } from "./validator";
import type { LosslessResumeDocument, SemanticContentBlock } from "./types";

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

async function runFixture(label: string, fileName: string, sourceFormat: "pdf" | "docx", expectsIntentionalReorder = false) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName, fileType: sourceFormat });

  checkTrue(`${label}: validation.passed is true`, doc.validation.passed);
  check(`${label}: zero missing elements`, doc.validation.missingElementIds.length, 0);
  check(`${label}: zero duplicate elements`, doc.validation.duplicateElementIds.length, 0);
  check(`${label}: zero missing text spans`, doc.validation.missingTextSpans.length, 0);
  check(`${label}: zero invented text spans`, doc.validation.inventedTextSpans.length, 0);
  if (expectsIntentionalReorder) {
    /*
      Phase 3C reordered this page on purpose. The divergence from source
      order is still REPORTED here - the report stays an honest record of
      physical order - and `passed` is true above only because the
      validator independently re-derived the page's canonical order and
      confirmed the assembled document matches, exactly, the permutation
      the ordering step declared before validation ran.
    */
    checkTrue(`${label}: intentional reorder is still reported in orderViolations`, doc.validation.orderViolations.length > 0);
  } else {
    check(`${label}: zero order violations`, doc.validation.orderViolations.length, 0);
  }
  check(`${label}: representedElementCount == sourceElementCount`, doc.validation.representedElementCount, doc.validation.sourceElementCount);
  checkTrue(`${label}: at least one section produced`, doc.sections.length >= 1);
  checkTrue(
    `${label}: every custom section has isUncertain=true`,
    doc.sections.every((s) => (s.normalizedType === "custom") === s.isUncertain)
  );
  checkTrue(
    `${label}: displayHeading is verbatim originalHeading for every section`,
    doc.sections.every((s) => s.displayHeading === s.originalHeading)
  );

  return { layoutResult, doc };
}

async function main() {
  await runFixture("standard-pdf-resume.pdf", "standard-pdf-resume.pdf", "pdf");
  await runFixture("word-docx-resume.docx", "word-docx-resume.docx", "docx");
  await runFixture("regtest3-two-column-pdf.pdf", "regtest3-two-column-pdf.pdf", "pdf", true);
  await runFixture("canva-pdf-resume.pdf", "canva-pdf-resume.pdf", "pdf", true);
  await runFixture("generated-table-resume.pdf", "generated-table-resume.pdf", "pdf");
  const { layoutResult, doc } = await runFixture(
    "resume-E-senior-ats.pdf",
    path.join("bench", "resume-E-senior-ats.pdf"),
    "pdf"
  );

  // --- F. Determinism (test-level, not a report field) ---
  const doc2 = buildLosslessResumeDocument(layoutResult, { fileName: "resume-E-senior-ats.pdf", fileType: "pdf" });
  check("determinism: repeat build on same layoutResult yields identical section id sequence", doc.sections.map((s) => s.id), doc2.sections.map((s) => s.id));
  check("determinism: repeat build yields identical normalizedType sequence", doc.sections.map((s) => s.normalizedType), doc2.sections.map((s) => s.normalizedType));
  check("determinism: repeat build yields byte-identical validation report", doc.validation, doc2.validation);

  /*
    --- Exact declared-permutation authorization ---

    The gate these cases defend: an intentional reorder is allowed to pass
    validation ONLY by declaring, in advance, the complete final block
    order of each page it moved - and the validator then proves the
    assembled document matches that declaration exactly. Every case below
    is the same document with the declaration bent one way or another;
    each must go red. If any of them goes green, the declaration has
    become a blanket permission and the lossless order guarantee is gone
    for every other caller too.
  */
  const reorderedBuffer = fs.readFileSync(path.join(FIXTURES_DIR, "regtest3-two-column-pdf.pdf"));
  const reorderedLayout = await analyzeDocument("resume", "pdf", reorderedBuffer);
  const reorderedDoc = buildLosslessResumeDocument(reorderedLayout, { fileName: "regtest3-two-column-pdf.pdf", fileType: "pdf" });

  // Produced the same way production produces it: by the ordering step
  // itself, from the adapted blocks - never read back off the document
  // that is about to be validated.
  const declaration = new Map<number, readonly string[]>();
  orderBlocksForSectionDetection(adaptLayoutToBlocks(reorderedLayout).blocks, (pageIndex, orderedBlockIds) => {
    declaration.set(pageIndex, orderedBlockIds);
  });
  const declaredPage = [...declaration.keys()][0];
  const declaredIds = [...(declaration.get(declaredPage) ?? [])];
  checkTrue("V-setup: the ordering step declared exactly one page", declaration.size === 1 && declaredIds.length > 0);

  const withDeclaration = (entries: Array<[number, readonly string[]]>) =>
    validateLosslessDocument(reorderedDoc, reorderedLayout, new Map(entries));
  const remapBlocks = (doc: LosslessResumeDocument, map: (blocks: SemanticContentBlock[]) => SemanticContentBlock[]) => ({
    ...doc,
    sections: doc.sections.map((s) => ({ ...s, blocks: map(s.blocks) })),
  });

  // V-A - no declaration at all: the reorder is unauthorized and fails.
  const undeclared = validateLosslessDocument(reorderedDoc, reorderedLayout);
  check("V-A: an undeclared within-page reorder still FAILS", undeclared.passed, false);
  checkTrue("V-A: and is still reported as order violations", undeclared.orderViolations.length > 0);
  check("V-A: no other invariant was disturbed", [undeclared.missingElementIds.length, undeclared.duplicateElementIds.length, undeclared.missingTextSpans.length, undeclared.inventedTextSpans.length], [0, 0, 0, 0]);

  // V-B - the exact declaration authorizes it, and violations stay reported.
  const exact = withDeclaration([[declaredPage, declaredIds]]);
  check("V-B: the exact declared permutation PASSES", exact.passed, true);
  checkTrue("V-B: order violations are still reported, not suppressed", exact.orderViolations.length > 0);

  // V-C - same blocks, one pair out of order.
  const swapped = [...declaredIds];
  [swapped[swapped.length - 2], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[swapped.length - 2]];
  check("V-C: a declaration with one pair transposed FAILS", withDeclaration([[declaredPage, swapped]]).passed, false);

  // V-D / V-E / V-F - incomplete, padded, and duplicated declarations.
  check("V-D: a declaration missing one block FAILS", withDeclaration([[declaredPage, declaredIds.slice(0, -1)]]).passed, false);
  check("V-E: a declaration with an extra block id FAILS", withDeclaration([[declaredPage, [...declaredIds, "block-p9-b999"]]]).passed, false);
  check("V-F: a declaration with a duplicated id FAILS", withDeclaration([[declaredPage, [...declaredIds.slice(0, -1), declaredIds[0]]]]).passed, false);

  // V-G - right sequence, wrong page.
  check("V-G: a declaration filed under another page FAILS", withDeclaration([[declaredPage + 7, declaredIds]]).passed, false);

  // V-J - a declaration describing NO permutation authorizes nothing.
  const canonicalOrder = [...declaredIds].sort((a, b) => {
    const blockOf = (id: string) => reorderedDoc.sections.flatMap((s) => s.blocks).concat(reorderedDoc.identityBlocks).find((b) => b.id === id);
    return (blockOf(a)?.sourceOrder ?? 0) - (blockOf(b)?.sourceOrder ?? 0);
  });
  check("V-J: declaring the unpermuted canonical order authorizes nothing", withDeclaration([[declaredPage, canonicalOrder]]).passed, false);

  // V-I - the document picks up one further swap after the declaration was made.
  const extraSwap = remapBlocks(reorderedDoc, (blocks) => (blocks.length >= 2 ? [blocks[1], blocks[0], ...blocks.slice(2)] : blocks));
  check("V-I: one extra swap beyond the declaration FAILS", validateLosslessDocument(extraSwap, reorderedLayout, new Map([[declaredPage, declaredIds]])).passed, false);

  // V-K / V-L / V-M - an exact declaration never excuses content damage.
  const dropped = remapBlocks(reorderedDoc, (blocks) => (blocks.length >= 2 ? blocks.slice(1) : blocks));
  const droppedReport = validateLosslessDocument(dropped, reorderedLayout, new Map([[declaredPage, declaredIds]]));
  check("V-K: a missing block still FAILS despite an exact declaration", droppedReport.passed, false);
  checkTrue("V-K: and is reported as missing elements", droppedReport.missingElementIds.length > 0);

  const duplicated = remapBlocks(reorderedDoc, (blocks) => (blocks.length >= 1 ? [blocks[0], ...blocks] : blocks));
  const duplicatedReport = validateLosslessDocument(duplicated, reorderedLayout, new Map([[declaredPage, declaredIds]]));
  check("V-L: duplicated content still FAILS despite an exact declaration", duplicatedReport.passed, false);
  checkTrue("V-L: and is reported as duplicate elements", duplicatedReport.duplicateElementIds.length > 0);

  const invented = remapBlocks(reorderedDoc, (blocks) =>
    blocks.map((b, i) => (i === 0 ? { ...b, rawText: `${b.rawText} fabricated addition` } : b))
  );
  const inventedReport = validateLosslessDocument(invented, reorderedLayout, new Map([[declaredPage, declaredIds]]));
  check("V-M: invented text still FAILS despite an exact declaration", inventedReport.passed, false);
  checkTrue("V-M: and is reported as invented text spans", inventedReport.inventedTextSpans.length > 0);

  // V-H / V-N - a second, undeclared page-level disturbance is never covered.
  const twoPageBuffer = fs.readFileSync(path.join(FIXTURES_DIR, "canva-pdf-resume.pdf"));
  const twoPageLayout = await analyzeDocument("resume", "pdf", twoPageBuffer);
  const twoPageDoc = buildLosslessResumeDocument(twoPageLayout, { fileName: "canva-pdf-resume.pdf", fileType: "pdf" });
  const twoPageDeclaration = new Map<number, readonly string[]>();
  orderBlocksForSectionDetection(adaptLayoutToBlocks(twoPageLayout).blocks, (pageIndex, orderedBlockIds) => {
    twoPageDeclaration.set(pageIndex, orderedBlockIds);
  });
  checkTrue("V-setup: the two-page fixture passes with its own exact declaration", twoPageDoc.validation.passed);

  /*
    V-H needs a fixture with real content on more than one page - a second
    PAGE is not the same thing as a second block-bearing page, and a page
    carrying no blocks cannot hold the accidental reorder this case is
    about. So the preconditions below are asserted rather than assumed:
    without them the mutation silently does nothing and the case passes
    while proving nothing.

    Only the observed sequence is disturbed. No sourceOrder, id, text,
    pageIndex or provenance is touched - the blocks are the originals,
    merely visited in the wrong order, which is exactly the accidental
    reorder Invariant D exists to catch.
  */
  const multiPageLayout = await analyzeDocument("resume", "pdf", fs.readFileSync(path.join(FIXTURES_DIR, path.join("bench", "resume-D-mid-canva.pdf"))));
  const multiPageDoc = buildLosslessResumeDocument(multiPageLayout, { fileName: "resume-D-mid-canva.pdf", fileType: "pdf" });
  const multiPageDeclaration = new Map<number, readonly string[]>();
  orderBlocksForSectionDetection(adaptLayoutToBlocks(multiPageLayout).blocks, (pageIndex, orderedBlockIds) => {
    multiPageDeclaration.set(pageIndex, orderedBlockIds);
  });

  const observedBlocks = (d: LosslessResumeDocument) => [...d.identityBlocks, ...d.sections.flatMap((s) => s.blocks)];
  const blockBearingPages = [...new Set(observedBlocks(multiPageDoc).map((b) => b.pageIndex))];
  const undeclaredPage = blockBearingPages.find((page) => !multiPageDeclaration.has(page));
  const victimSection = multiPageDoc.sections.find((s) => s.blocks.filter((b) => b.pageIndex === undeclaredPage).length >= 2);
  const victims = victimSection?.blocks.filter((b) => b.pageIndex === undeclaredPage).slice(0, 2) ?? [];

  checkTrue("V-H setup: the fixture carries blocks on at least two pages", blockBearingPages.length >= 2);
  checkTrue("V-H setup: the multi-column page is the declared one", multiPageDeclaration.size === 1 && blockBearingPages.includes([...multiPageDeclaration.keys()][0]));
  checkTrue("V-H setup: a different block-bearing page is NOT declared", undeclaredPage !== undefined && !multiPageDeclaration.has(undeclaredPage));
  checkTrue("V-H setup: that undeclared page offers two blocks to invert", victims.length === 2 && victims[0].sourceOrder < victims[1].sourceOrder);
  checkTrue("V-H setup: the document is valid BEFORE the accidental reorder", multiPageDoc.validation.passed);

  const undeclaredReorder: LosslessResumeDocument = {
    ...multiPageDoc,
    sections: multiPageDoc.sections.map((s) => {
      if (s !== victimSection) return s;
      const blocks = [...s.blocks];
      const first = blocks.indexOf(victims[0]);
      const second = blocks.indexOf(victims[1]);
      [blocks[first], blocks[second]] = [blocks[second], blocks[first]];
      return { ...s, blocks };
    }),
  };

  const mutated = observedBlocks(undeclaredReorder);
  checkTrue("V-H setup: the observed order really did change", mutated.map((b) => b.id).join() !== observedBlocks(multiPageDoc).map((b) => b.id).join());
  checkTrue(
    "V-H setup: the swap is a genuine sourceOrder regression on the undeclared page",
    mutated.some((b, i) => i > 0 && b.pageIndex === undeclaredPage && mutated[i - 1].pageIndex === undeclaredPage && b.sourceOrder < mutated[i - 1].sourceOrder)
  );

  const undeclaredReport = validateLosslessDocument(undeclaredReorder, multiPageLayout, multiPageDeclaration);
  check("V-H: an undeclared reorder on another page FAILS even though page 1 is exact", undeclaredReport.passed, false);
  checkTrue("V-H: the undeclared page's own violation is reported", undeclaredReport.orderViolations.some((v) => v.afterId === victims[0].id && v.beforeId === victims[1].id));
  check("V-H: nothing else was damaged - only order", [undeclaredReport.missingElementIds.length, undeclaredReport.duplicateElementIds.length, undeclaredReport.missingTextSpans.length, undeclaredReport.inventedTextSpans.length], [0, 0, 0, 0]);

  const pagesReversed = { ...twoPageDoc, sections: [...twoPageDoc.sections].reverse() };
  check("V-N: a cross-page regression is never authorized by a declaration", validateLosslessDocument(pagesReversed, twoPageLayout, twoPageDeclaration).passed, false);

  await closeSharedBrowser();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
