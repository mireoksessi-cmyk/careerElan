/*
  TASK 2 gate test - deterministic ID helpers. Run with
  `npx tsx lib/documentPreservation/losslessSemantic/ids.test.ts`.
*/
import { elementId, blockId, sectionId } from "./ids";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

check("elementId is deterministic string, not uuid-shaped", elementId(1, 3), "el-p1-e3");
check("elementId repeat call is byte-identical", elementId(1, 3), elementId(1, 3));
check("elementId differs by page", elementId(2, 3) === elementId(1, 3), false);
check("elementId differs by index", elementId(1, 4) === elementId(1, 3), false);

check("blockId is deterministic string", blockId(0, 0), "block-p0-b0");
check("blockId repeat call is byte-identical", blockId(0, 0), blockId(0, 0));

check("sectionId is deterministic string", sectionId(5), "section-s5");
check("sectionId repeat call is byte-identical", sectionId(5), sectionId(5));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
