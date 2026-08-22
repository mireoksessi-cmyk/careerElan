/*
  Unit gate for the inline Languages grammar. Every case here is
  structural - no assertion depends on knowing what a language or a
  proficiency word means, and there is deliberately no dictionary of
  either to test against. Run with
  `npx tsx lib/documentPreservation/resumeStructured/languageExtractor.test.ts`.
*/
import { extractLanguageEntries } from "./languageExtractor";
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

const SECTION_ID = "sec-lang";

function blocks(...texts: string[]): SemanticContentBlock[] {
  return texts.map((text, index) => ({
    id: `lang-b${index}`,
    sourceElementIds: [`lang-e${index}`],
    text,
    rawText: text,
    pageIndex: 1,
    sourceOrder: index,
    blockType: "paragraph",
  }));
}

/* Just the name/proficiency shape, so ordering assertions stay readable. */
function shape(texts: string[]) {
  return extractLanguageEntries(SECTION_ID, blocks(...texts)).map((e) => [e.name, e.proficiency]);
}

function main() {
  // --- A. multiple inline parenthetical entries ---
  check("A: one block of parenthetical peers yields one entry each", shape(["Alpha (one), Beta (two)"]), [
    ["Alpha", "one"],
    ["Beta", "two"],
  ]);

  // --- B. plain multi-block list ---
  check("B: bare peers across blocks omit proficiency entirely", shape(["Alpha", "Beta", "Gamma"]), [
    ["Alpha", undefined],
    ["Beta", undefined],
    ["Gamma", undefined],
  ]);
  checkTrue(
    "B: the proficiency property is absent, not null or empty",
    extractLanguageEntries(SECTION_ID, blocks("Alpha", "Beta")).every((e) => !("proficiency" in e))
  );

  // --- C. mixed parenthetical + bare peers ---
  check("C: a bare peer between two pairs survives in place", shape(["Alpha (one), Beta, Gamma (three)"]), [
    ["Alpha", "one"],
    ["Beta", undefined],
    ["Gamma", "three"],
  ]);

  // --- D. multilingual structure, no English anywhere ---
  check("D: non-Latin labels and values parse on shape alone", shape(["한국어 (모국어), Français (courant), Ελληνικά (μέτρια)"]), [
    ["한국어", "모국어"],
    ["Français", "courant"],
    ["Ελληνικά", "μέτρια"],
  ]);

  // --- E. multi-word label, proving no word-count cap ---
  check("E: a four-word label is accepted", shape(["Alpha Beta Gamma Delta", "Epsilon"]), [
    ["Alpha Beta Gamma Delta", undefined],
    ["Epsilon", undefined],
  ]);
  check("E: a long label is accepted inside a pair too", shape(["Alpha Beta Gamma Delta Epsilon (one)"]), [["Alpha Beta Gamma Delta Epsilon", "one"]]);

  // --- F. multi-word proficiency, proving no cap on the value either ---
  check("F: a five-word parenthetical value is kept whole", shape(["Alpha (one two three four five)"]), [["Alpha", "one two three four five"]]);

  // --- G. one terminal sentence terminator ---
  check("G: a single trailing terminator is removed before parsing", shape(["Alpha (one), Beta (two)."]), [
    ["Alpha", "one"],
    ["Beta", "two"],
  ]);
  check("G: only one terminator is removed - a second one still fails the item", shape(["Alpha (one).."]), []);

  // --- H. single bare item has no peer evidence ---
  check("H: a lone bare item is declined", shape(["Alpha"]), []);
  check("H: a lone bare item is declined however long it is", shape(["Alpha beta gamma delta epsilon"]), []);
  check("H: but a lone PAIR is accepted, since the parenthetical is its own marker", shape(["Alpha (one)"]), [["Alpha", "one"]]);

  // --- I-M. malformed parentheses all fail closed ---
  check("I: unbalanced open parenthesis fails the section", shape(["Alpha (one"]), []);
  check("I: a stray closing parenthesis fails the section", shape(["Alpha one)"]), []);
  check("J: nested parentheses fail the section", shape(["Alpha ((one))"]), []);
  check("K: two parenthetical groups in one item fail the section", shape(["Alpha (one) (two)"]), []);
  check("L: text after the closing parenthesis fails the section", shape(["Alpha (one) extra"]), []);
  check("M: an empty parenthetical value fails the section", shape(["Alpha ()"]), []);
  check("M: an empty label fails the section", shape(["(one)"]), []);

  // --- N. depth-aware splitting ---
  check("N: a comma inside a parenthetical does not split the item", shape(["Alpha (one, two), Beta (three)"]), [
    ["Alpha", "one, two"],
    ["Beta", "three"],
  ]);
  check("N: a semicolon inside a parenthetical does not split it either", shape(["Alpha (one; two), Beta"]), [
    ["Alpha", "one; two"],
    ["Beta", undefined],
  ]);
  check("N: semicolons DO separate peers at depth zero", shape(["Alpha (one); Beta (two)"]), [
    ["Alpha", "one"],
    ["Beta", "two"],
  ]);

  // --- O. unsupported pairing syntax is declined, never guessed at ---
  check("O: a colon pairing form fails the section", shape(["Alpha: one", "Beta: two"]), []);
  check("O: a spaced-hyphen pairing form fails the section", shape(["Alpha - one", "Beta - two"]), []);
  check("O: an en-dash pairing form fails the section", shape(["Alpha – one", "Beta – two"]), []);
  check("O: an em-dash pairing form fails the section", shape(["Alpha — one", "Beta — two"]), []);
  checkTrue(
    "O: an unspaced hyphen inside a label is NOT a pairing form and stays whole",
    JSON.stringify(shape(["Alpha-Beta", "Gamma"])) === JSON.stringify([["Alpha-Beta", undefined], ["Gamma", undefined]])
  );

  // --- P. all-or-nothing ---
  check("P: one malformed peer discards the whole section", shape(["Alpha (one), Beta (two, Gamma (three)"]), []);
  check("P: a malformed later block discards earlier valid blocks too", shape(["Alpha (one)", "Beta (two", "Gamma (three)"]), []);

  // --- Q. source order ---
  check("Q: entries follow block order, then textual order within a block", shape(["Delta (four), Charlie (three)", "Bravo (two)", "Alpha (one)"]), [
    ["Delta", "four"],
    ["Charlie", "three"],
    ["Bravo", "two"],
    ["Alpha", "one"],
  ]);
  check("Q: nothing is deduplicated or merged", shape(["Alpha (one), Alpha (two)"]), [
    ["Alpha", "one"],
    ["Alpha", "two"],
  ]);

  // --- R. source traces ---
  {
    const entries = extractLanguageEntries(SECTION_ID, blocks("Alpha (one), Beta (two)", "Gamma (three)"));
    check("R: every entry carries the section id", entries.map((e) => e.source.sourceSectionId), [SECTION_ID, SECTION_ID, SECTION_ID]);
    check("R: two entries from one block share that block's id", entries.map((e) => e.source.sourceBlockIds), [["lang-b0"], ["lang-b0"], ["lang-b1"]]);
    check("R: element ids come from the block that produced the entry", entries.map((e) => e.source.sourceElementIds), [["lang-e0"], ["lang-e0"], ["lang-e1"]]);
  }

  // --- structural policy: a parenthetical is read as proficiency without
  //     interpreting it. A variety/qualifier form is therefore stored as
  //     proficiency - the accepted L2 limitation, asserted here so the
  //     behavior is deliberate rather than incidental.
  check("policy: any terminal parenthetical becomes proficiency, uninterpreted", shape(["Alpha (Beta), Gamma (Delta)"]), [
    ["Alpha", "Beta"],
    ["Gamma", "Delta"],
  ]);

  // --- input hygiene ---
  check("empty body yields no entries", extractLanguageEntries(SECTION_ID, blocks()), []);
  check("heading blocks are not parsed as items", shape([]), []);
  {
    const headingOnly: SemanticContentBlock[] = [
      { id: "lang-h", sourceElementIds: ["lang-he"], text: "Alpha (one)", rawText: "Alpha (one)", pageIndex: 1, sourceOrder: 0, blockType: "heading" },
    ];
    check("a section of nothing but a heading yields no entries", extractLanguageEntries(SECTION_ID, headingOnly), []);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
