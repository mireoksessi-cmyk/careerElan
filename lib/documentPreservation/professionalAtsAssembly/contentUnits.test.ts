/*
  TASK 7 gate test - content unit heuristics. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/contentUnits.test.ts`.
*/
import { textUnit, sumTextUnits, HEADER_BASELINE_UNITS } from "./contentUnits";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

check("empty string -> 0 units", textUnit(""), 0);
check("whitespace-only -> 0 units", textUnit("   \n  "), 0);
check("short text (<=60 chars) -> 1 unit", textUnit("Managed a small team."), 1);
check("exactly 60 chars -> 1 unit", textUnit("a".repeat(60)), 1);
check("61 chars -> 2 units", textUnit("a".repeat(61)), 2);
check("120 chars -> 2 units", textUnit("a".repeat(120)), 2);
check("121 chars -> 3 units", textUnit("a".repeat(121)), 3);

check("deterministic: same text -> same units, called twice", textUnit("Some repeated sentence used for the determinism check."), textUnit("Some repeated sentence used for the determinism check."));

check("sumTextUnits: empty array -> 0", sumTextUnits([]), 0);
check("sumTextUnits: sums each item's own unit", sumTextUnits(["a".repeat(60), "a".repeat(61)]), 1 + 2);
check("sumTextUnits: whitespace-only entries contribute 0", sumTextUnits(["   ", "Real text here."]), 1);

check("HEADER_BASELINE_UNITS is a fixed positive constant", HEADER_BASELINE_UNITS, 1);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
