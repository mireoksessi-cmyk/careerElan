/*
  TASK 2 gate test - source trace helpers + deterministic id generators.
  Run with `npx tsx lib/documentPreservation/resumeStructured/sourceTrace.test.ts`.
*/
import { traceFromBlock, traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId, bulletId, customSectionId } from "./ids";
import type { SemanticContentBlock } from "../losslessSemantic/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

function makeBlock(id: string, elementIds: string[]): SemanticContentBlock {
  return {
    id,
    sourceElementIds: elementIds,
    text: "x",
    rawText: "x",
    pageIndex: 0,
    sourceOrder: 0,
    blockType: "paragraph",
  };
}

const b1 = makeBlock("block-p0-b0", ["el-p0-e0", "el-p0-e1"]);
const b2 = makeBlock("block-p0-b1", ["el-p0-e2"]);

// --- traceFromBlock / traceFromBlocks ---
check("traceFromBlock: single block trace", traceFromBlock("section-s1", b1), {
  sourceSectionId: "section-s1",
  sourceBlockIds: ["block-p0-b0"],
  sourceElementIds: ["el-p0-e0", "el-p0-e1"],
});
check("traceFromBlocks: multi-block trace concatenates in order", traceFromBlocks("section-s1", [b1, b2]), {
  sourceSectionId: "section-s1",
  sourceBlockIds: ["block-p0-b0", "block-p0-b1"],
  sourceElementIds: ["el-p0-e0", "el-p0-e1", "el-p0-e2"],
});
check("traceFromBlocks: empty blocks yields empty trace", traceFromBlocks("section-s1", []), {
  sourceSectionId: "section-s1",
  sourceBlockIds: [],
  sourceElementIds: [],
});

// --- mergeTraces ---
const t1 = traceFromBlock("section-s1", b1);
const t2 = traceFromBlock("section-s1", b2);
check("mergeTraces: unions block/element ids", mergeTraces(t1, t2), {
  sourceSectionId: "section-s1",
  sourceBlockIds: ["block-p0-b0", "block-p0-b1"],
  sourceElementIds: ["el-p0-e0", "el-p0-e1", "el-p0-e2"],
});
check("mergeTraces: de-duplicates repeated ids across traces", mergeTraces(t1, t1), {
  sourceSectionId: "section-s1",
  sourceBlockIds: ["block-p0-b0"],
  sourceElementIds: ["el-p0-e0", "el-p0-e1"],
});
check("mergeTraces: no ids invented beyond the union of inputs", mergeTraces(t1, t2).sourceBlockIds.length, 2);

// --- deterministic ids ---
check("entryId: deterministic format", entryId("section-s2", "experience", 0), "section-s2-experience-0");
check("entryId: repeat call is byte-identical", entryId("section-s2", "experience", 0), entryId("section-s2", "experience", 0));
check("entryId: distinct index -> distinct id", entryId("section-s2", "experience", 0) === entryId("section-s2", "experience", 1), false);
check("bulletId: deterministic format", bulletId("section-s2-experience-0", 2), "section-s2-experience-0-bullet-2");
check("customSectionId: deterministic format", customSectionId("section-s7"), "section-s7-custom");

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
