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


  /* ============================================================
     L3.0 - a Languages section laid out as a grid: one column per
     language, the lower row repeating a single shared value. Every
     case below is geometry plus abstract tokens; nothing here knows
     what a language or a proficiency is, and the same code path serves
     two columns and ten.
     ============================================================ */

  /* Regular layout: disjoint columns, vertically separated rows. The
     numbers are the test's own, not measured from any document. */
  const gridBlocks = (rows: string[][]): SemanticContentBlock[] => {
    const out: SemanticContentBlock[] = [];
    let n = 0;
    rows.forEach((row, r) =>
      row.forEach((text, c) => {
        const i = n++;
        out.push({
          id: `grid-b${i}`,
          sourceElementIds: [`grid-e${i}`],
          text,
          rawText: text,
          pageIndex: 1,
          sourceOrder: i,
          blockType: "paragraph",
          bbox: { x: 50 + c * 100, y: 100 + r * 20, width: 60, height: 10 },
        });
      })
    );
    return out;
  };

  /* Explicit geometry, for the cases whose whole point is an irregular
     shape. */
  const cellBlocks = (specs: { text: string; x: number; y: number; w: number; h: number; page?: number }[]): SemanticContentBlock[] =>
    specs.map((spec, i) => ({
      id: `cell-b${i}`,
      sourceElementIds: [`cell-e${i}`],
      text: spec.text,
      rawText: spec.text,
      pageIndex: spec.page ?? 1,
      sourceOrder: i,
      blockType: "paragraph",
      bbox: { x: spec.x, y: spec.y, width: spec.w, height: spec.h },
    }));

  const gridShape = (rows: string[][]) => extractLanguageEntries(SECTION_ID, gridBlocks(rows)).map((e) => [e.name, e.proficiency]);

  // --- the same algorithm across lane counts ---
  check("L3 N=2: two columns pair with the shared lower value", gridShape([["Alpha", "Beta"], ["Xi", "Xi"]]), [
    ["Alpha", "Xi"],
    ["Beta", "Xi"],
  ]);
  check("L3 N=3: three columns, identical code path", gridShape([["Alpha", "Beta", "Gamma"], ["Xi", "Xi", "Xi"]]), [
    ["Alpha", "Xi"],
    ["Beta", "Xi"],
    ["Gamma", "Xi"],
  ]);
  check("L3 N=4: four columns, identical code path", gridShape([["Alpha", "Beta", "Gamma", "Delta"], ["Xi", "Xi", "Xi", "Xi"]]), [
    ["Alpha", "Xi"],
    ["Beta", "Xi"],
    ["Gamma", "Xi"],
    ["Delta", "Xi"],
  ]);
  check("L3 N=6: nothing is capped", gridShape([["A1", "A2", "A3", "A4", "A5", "A6"], ["Xi", "Xi", "Xi", "Xi", "Xi", "Xi"]]).length, 6);

  // --- ordering and provenance ---
  check("L3 order: entries follow columns left to right", gridShape([["Delta", "Charlie", "Bravo"], ["Xi", "Xi", "Xi"]]).map((e) => e[0]), ["Delta", "Charlie", "Bravo"]);
  {
    const entries = extractLanguageEntries(SECTION_ID, gridBlocks([["Alpha", "Beta"], ["Xi", "Xi"]]));
    check("L3 trace: each entry cites its own two cells", entries.map((e) => e.source.sourceBlockIds), [["grid-b0", "grid-b2"], ["grid-b1", "grid-b3"]]);
    check("L3 trace: element ids come from both cells too", entries.map((e) => e.source.sourceElementIds), [["grid-e0", "grid-e2"], ["grid-e1", "grid-e3"]]);
    check("L3 trace: the section id is carried", entries.map((e) => e.source.sourceSectionId), [SECTION_ID, SECTION_ID]);
  }

  // --- the lower row must be one repeated value ---
  check("L3 reject: lower values all differ", gridShape([["Alpha", "Beta", "Gamma"], ["Xi", "Psi", "Chi"]]), []);
  check("L3 reject: lower row repeats only partly", gridShape([["Alpha", "Beta", "Gamma"], ["Xi", "Xi", "Psi"]]), []);

  // --- degenerate content shapes ---
  check("L3 reject: upper row repeats a value", gridShape([["Alpha", "Alpha", "Beta"], ["Xi", "Xi", "Xi"]]), []);
  check("L3 reject: the repeated lower value also appears above", gridShape([["Alpha", "Beta", "Xi"], ["Xi", "Xi", "Xi"]]), []);
  check("L3 reject: an empty cell", gridShape([["Alpha", "  "], ["Xi", "Xi"]]), []);

  // --- a two-column grid of independent items is refused, not guessed ---
  check("L3 reject: 2x2 with four distinct values", gridShape([["Alpha", "Beta"], ["Gamma", "Delta"]]), []);

  // --- shape gates ---
  check("L3 reject: three rows", gridShape([["Alpha", "Beta"], ["Xi", "Xi"], ["Psi", "Psi"]]), []);
  check(
    "L3 reject: rows of unequal width",
    extractLanguageEntries(SECTION_ID, cellBlocks([
      { text: "Alpha", x: 50, y: 100, w: 60, h: 10 },
      { text: "Beta", x: 150, y: 100, w: 60, h: 10 },
      { text: "Gamma", x: 250, y: 100, w: 60, h: 10 },
      { text: "Xi", x: 50, y: 120, w: 60, h: 10 },
      { text: "Xi", x: 150, y: 120, w: 60, h: 10 },
    ])),
    []
  );
  check(
    "L3 reject: one upper cell straddles two lower cells",
    extractLanguageEntries(SECTION_ID, cellBlocks([
      { text: "Alpha", x: 50, y: 100, w: 200, h: 10 },
      { text: "Beta", x: 300, y: 100, w: 60, h: 10 },
      { text: "Xi", x: 50, y: 120, w: 60, h: 10 },
      { text: "Xi", x: 200, y: 120, w: 60, h: 10 },
    ])),
    []
  );
  check(
    "L3 passthrough: cells spread across pages are not a grid, so the list grammar keeps them",
    extractLanguageEntries(SECTION_ID, cellBlocks([
      { text: "Alpha", x: 50, y: 100, w: 60, h: 10 },
      { text: "Beta", x: 150, y: 100, w: 60, h: 10 },
      { text: "Xi", x: 50, y: 120, w: 60, h: 10, page: 2 },
      { text: "Xi", x: 150, y: 120, w: 60, h: 10, page: 2 },
    ])).length,
    4
  );

  // --- equality is trim-only ---
  check("L3 equality: surrounding whitespace does not stop the match", gridShape([["Alpha", "Beta"], ["Xi ", " Xi"]]), [
    ["Alpha", "Xi"],
    ["Beta", "Xi"],
  ]);
  check("L3 equality: case is not folded away", gridShape([["Alpha", "Beta"], ["Xi", "xi"]]), []);

  // --- a grid never falls through to the list grammar ---
  checkTrue(
    "L3 fail-closed: a refused grid yields nothing rather than four bare names",
    extractLanguageEntries(SECTION_ID, gridBlocks([["Alpha", "Beta"], ["Gamma", "Delta"]])).length === 0
  );

  // --- non-grid input still belongs to the list grammar ---
  check(
    "L3 passthrough: a single column of peers is still a plain list",
    extractLanguageEntries(SECTION_ID, cellBlocks([
      { text: "Alpha", x: 50, y: 100, w: 60, h: 10 },
      { text: "Beta", x: 50, y: 120, w: 60, h: 10 },
      { text: "Gamma", x: 50, y: 140, w: 60, h: 10 },
      { text: "Delta", x: 50, y: 160, w: 60, h: 10 },
    ])).map((e) => [e.name, e.proficiency]),
    [["Alpha", undefined], ["Beta", undefined], ["Gamma", undefined], ["Delta", undefined]]
  );
  check(
    "L3 passthrough: an inline pair line is still parsed as text",
    extractLanguageEntries(SECTION_ID, cellBlocks([{ text: "Alpha (one), Beta (two)", x: 50, y: 100, w: 200, h: 10 }])).map((e) => [e.name, e.proficiency]),
    [["Alpha", "one"], ["Beta", "two"]]
  );
  check("L3 passthrough: grid-shaped text without geometry stays with the list grammar", shape(["Alpha", "Beta", "Xi", "Xi"]), [
    ["Alpha", undefined],
    ["Beta", undefined],
    ["Xi", undefined],
    ["Xi", undefined],
  ]);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
