/*
  Phase 5D.7 TASK C gate test - buildHierarchicalContent's own detection
  algorithm (numbering/indent/font-weight scoring, stack-based nesting),
  tested directly against hand-authored SemanticContentBlock[] input -
  never against the algorithm's own current behavior. Mirrors the
  hand-authoring convention established by wrappedContinuationClassifier.test.ts
  (Phase 5D.6E): synthetic block()/contentBlocksFor() builders, plain
  pass/fail counter, run with `npx tsx hierarchicalGrouping.test.ts`.

  Covers the round's five named example shapes (numbered sub-groups,
  heading-only sub-teams, Roman numeral, Alphabet, nested/deep program
  hierarchy) plus the round's explicit negative controls (plain bullet
  lists, plain paragraphs, date-only lines, single weak-signal lines).
  All company/team/practice-area names below are placeholder text, not
  real company data - matching the round's own prohibition on
  hardcoding real employer names into the PRODUCT code (this is a test
  fixture, not product logic, but keeps the same placeholder-text
  discipline regardless).
*/
import { buildHierarchicalContent, verifyHierarchyOrderPreserved } from "./hierarchicalGrouping";
import type { SemanticContentBlock, SemanticBlockType } from "../losslessSemantic/types";
import type { HierarchicalContentNode, SourceTrace } from "./types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

/*
  Phase 2A - `y` overrides the default one-line-per-index vertical
  advance, so a same-Y / column-like geometry can be constructed for the
  bullet-nesting same-Y guard's own catching negative case.
*/
type LineSpec = { text: string; type?: SemanticBlockType; x?: number; y?: number; weight?: number | string };

function makeInputs(lines: LineSpec[]): { blocks: SemanticContentBlock[]; contentBlocks: { id: string; text: string; source: SourceTrace }[] } {
  const blocks: SemanticContentBlock[] = lines.map((l, i) => ({
    id: `t-p0-b${i}`,
    sourceElementIds: [`0-el${i}`],
    text: l.text,
    rawText: l.text,
    pageIndex: 0,
    sourceOrder: i,
    bbox: l.x !== undefined ? { x: l.x, y: l.y ?? i * 20, width: 240, height: 12 } : undefined,
    style: l.weight !== undefined ? { fontWeight: l.weight } : undefined,
    blockType: l.type ?? "paragraph",
  }));
  const contentBlocks = lines.map((l, i) => ({
    id: `entry-content-${i}`,
    text: l.text,
    source: { sourceSectionId: "s1", sourceBlockIds: [`t-p0-b${i}`], sourceElementIds: [`0-el${i}`] },
  }));
  return { blocks, contentBlocks };
}

function flattenTexts(nodes: HierarchicalContentNode[]): string[] {
  const out: string[] = [];
  nodes.forEach((n) => {
    out.push(n.text);
    out.push(...flattenTexts(n.children));
  });
  return out;
}

function maxDepth(nodes: HierarchicalContentNode[]): number {
  let max = -1;
  nodes.forEach((n) => {
    max = Math.max(max, n.depth, maxDepth(n.children));
  });
  return max;
}

// ==================== Shape A: Arabic-numbered sub-groups ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Battery Development", x: 50 },
    { text: "Led module design for a next-generation platform.", type: "bullet", x: 70 },
    { text: "Reduced unit cost by 12%.", type: "bullet", x: 70 },
    { text: "2. Manufacturing Technology", x: 50 },
    { text: "Implemented a new welding process.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("arabic: hasHierarchy true", result.hasHierarchy, true);
  check("arabic: 2 top-level subheadings", result.nodes.length, 2);
  check("arabic: node0 kind subheading", result.nodes[0]?.kind, "subheading");
  check("arabic: node0 numberingLabel", result.nodes[0]?.numberingLabel, "1.");
  check("arabic: node0 has 2 bullet children", result.nodes[0]?.children.length, 2);
  check("arabic: node1 has 1 bullet child", result.nodes[1]?.children.length, 1);
  check("arabic: order preserved end to end", flattenTexts(result.nodes), [
    "1. Battery Development",
    "Led module design for a next-generation platform.",
    "Reduced unit cost by 12%.",
    "2. Manufacturing Technology",
    "Implemented a new welding process.",
  ]);
}

// ==================== Shape A variant: parenthesis numbering "1)" ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1) Client Advisory", x: 50 },
    { text: "Advised mid-market clients on growth strategy.", type: "bullet", x: 70 },
    { text: "2) Internal Operations", x: 50 },
    { text: "Streamlined the quarterly reporting process.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("paren-numbering: hasHierarchy true", result.hasHierarchy, true);
  check("paren-numbering: numberingLabel", result.nodes[0]?.numberingLabel, "1)");
}

// ==================== Shape B: heading-only sub-teams, no numbering (DOCX bold) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "Search Infrastructure", x: 50, weight: 700 },
    { text: "Owned the query relevance ranking system.", type: "bullet", x: 70 },
    { text: "Cloud Platform", x: 50, weight: 700 },
    { text: "Migrated core services to a managed container platform.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("heading-only: hasHierarchy true", result.hasHierarchy, true);
  check("heading-only: 2 top-level subheadings", result.nodes.length, 2);
  check("heading-only: no numberingLabel", result.nodes[0]?.numberingLabel, undefined);
  check("heading-only: node1 has 1 child", result.nodes[1]?.children.length, 1);
}

// ==================== Shape C: Roman numeral ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "I. Strategic Direction", x: 50 },
    { text: "Set the multi-year roadmap for the division.", type: "bullet", x: 70 },
    { text: "II. Governance Oversight", x: 50 },
    { text: "Chaired quarterly governance reviews.", type: "bullet", x: 70 },
    { text: "III. Talent Development", x: 50 },
    { text: "Built a rotational leadership program.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("roman: hasHierarchy true", result.hasHierarchy, true);
  check("roman: 3 top-level subheadings", result.nodes.length, 3);
  check("roman: node0 numberingLabel", result.nodes[0]?.numberingLabel, "I.");
  check("roman: node2 numberingLabel", result.nodes[2]?.numberingLabel, "III.");
}

// ==================== Shape D: Alphabet ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "A. Corporate Practice", x: 50 },
    { text: "Advised clients on transaction structuring.", type: "bullet", x: 70 },
    { text: "B. Litigation Practice", x: 50 },
    { text: "Represented clients in commercial disputes.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("alpha: hasHierarchy true", result.hasHierarchy, true);
  check("alpha: node0 numberingLabel is alpha not roman", result.nodes[0]?.numberingLabel, "A.");
  check("alpha: node1 numberingLabel", result.nodes[1]?.numberingLabel, "B.");
}

// ==================== Shape E: nested/deep - "Programs" -> numbered sub-programs -> bullets (2 level) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "Programs", x: 40, weight: 700 },
    { text: "1. Leadership Accelerator", x: 60 },
    { text: "Coached 20 senior directors.", type: "bullet", x: 80 },
    { text: "2. Innovation Lab", x: 60 },
    { text: "Piloted five new product concepts.", type: "bullet", x: 80 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("nested: hasHierarchy true", result.hasHierarchy, true);
  check("nested: 1 top-level node (Programs)", result.nodes.length, 1);
  check("nested: Programs has 2 children (sub-programs)", result.nodes[0]?.children.length, 2);
  check("nested: sub-program 0 has 1 bullet child", result.nodes[0]?.children[0]?.children.length, 1);
  check("nested: sub-program 1 has 1 bullet child", result.nodes[0]?.children[1]?.children.length, 1);
  check("nested: max depth is 2", maxDepth(result.nodes), 2);
  check("nested: order preserved end to end", flattenTexts(result.nodes), [
    "Programs",
    "1. Leadership Accelerator",
    "Coached 20 senior directors.",
    "2. Innovation Lab",
    "Piloted five new product concepts.",
  ]);
}

// ==================== Shape E variant: 3-level (Research Areas -> named area -> numbered sub-topic -> bullet) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "Research Areas", x: 40, weight: 700 },
    { text: "Applied Materials", x: 55, weight: 700 },
    { text: "1. Thin-Film Coatings", x: 70 },
    { text: "Published three peer-reviewed papers.", type: "bullet", x: 90 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("3-level: hasHierarchy true", result.hasHierarchy, true);
  check("3-level: max depth is 3", maxDepth(result.nodes), 3);
  check("3-level: Research Areas -> Applied Materials -> 1. Thin-Film -> bullet chain", flattenTexts(result.nodes), [
    "Research Areas",
    "Applied Materials",
    "1. Thin-Film Coatings",
    "Published three peer-reviewed papers.",
  ]);
}

// ==================== Shape E variant: sibling reset after nested child (stack pops back to top level) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Battery Development", x: 50 },
    { text: "Sub-team A", x: 65, weight: 700 },
    { text: "Owned cell chemistry selection.", type: "bullet", x: 85 },
    { text: "2. Manufacturing Technology", x: 50 },
    { text: "Implemented a new welding process.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("sibling-reset: 2 top-level nodes (not 1)", result.nodes.length, 2);
  check("sibling-reset: node0 (1. Battery Development) has 1 child (Sub-team A)", result.nodes[0]?.children.length, 1);
  check("sibling-reset: Sub-team A has 1 bullet child", result.nodes[0]?.children[0]?.children.length, 1);
  check("sibling-reset: node1 (2. Manufacturing) is top-level sibling, not nested under node0", result.nodes[1]?.text, "2. Manufacturing Technology");
}

// ==================== Mixed numbering within one entry (arabic then roman) - still recognized, shape-only, no cross-check required ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Field Operations", x: 50 },
    { text: "Managed a 40-person field crew.", type: "bullet", x: 70 },
    { text: "II. Safety Compliance", x: 50 },
    { text: "Achieved zero lost-time incidents for two years.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("mixed-numbering: hasHierarchy true", result.hasHierarchy, true);
  check("mixed-numbering: 2 top-level nodes", result.nodes.length, 2);
  check("mixed-numbering: node0 label", result.nodes[0]?.numberingLabel, "1.");
  check("mixed-numbering: node1 label", result.nodes[1]?.numberingLabel, "II.");
}

// ==================== Negative control: plain bullet list only ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "Managed a team of 8 engineers.", type: "bullet", x: 50 },
    { text: "Shipped the v2 platform on schedule.", type: "bullet", x: 50 },
    { text: "Reduced incident response time by 30%.", type: "bullet", x: 50 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("negative bullets-only: hasHierarchy false", result.hasHierarchy, false);
  check("negative bullets-only: empty nodes", result.nodes.length, 0);
}

// ==================== Negative control: bullet text that merely LOOKS numbered ("3 years managing...") ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "3 years managing a team of 12.", type: "bullet", x: 50 },
    { text: "5 direct reports across two offices.", type: "bullet", x: 50 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("negative numeric-looking bullets: hasHierarchy false (bullets never become subheadings)", result.hasHierarchy, false);
}

// ==================== Negative control: plain paragraphs (long sentences, no numbering/bold/short-shape) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "We are a leading provider of consulting services to enterprise clients across North America." },
    { text: "Our engagement model emphasizes measurable outcomes over lengthy status reporting." },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("negative long-paragraphs: hasHierarchy false", result.hasHierarchy, false);
}

// ==================== Negative control: date-only line ====================
{
  const { blocks, contentBlocks } = makeInputs([{ text: "2019 - 2021", x: 50 }, { text: "Delivered the annual audit on time.", type: "bullet", x: 50 }]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("negative date-only-line: hasHierarchy false", result.hasHierarchy, false);
}

// ==================== Negative control: single weak-signal line (indent+short-shape alone, no numbering/bold/next-bullet) ====================
{
  const { blocks, contentBlocks } = makeInputs([{ text: "Overview", x: 40 }]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("negative single-weak-signal: hasHierarchy false", result.hasHierarchy, false);
}

// ==================== Negative control: short bold line with NO other corroborating signal (no bbox, so no indent bonus; next is not a bullet) ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "Random Aside", weight: 700 },
    { text: "This is an ordinary paragraph that happens to follow it and is fairly long in total length." },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  // bold(+1) + short-header-shape(+1) only = 2, below threshold; no bbox on either line so indent never contributes; next block is not a bullet so no +2.
  check("negative bold-alone-no-other-signal: hasHierarchy false", result.hasHierarchy, false);
}

// ==================== Negative control: empty content ====================
{
  const result = buildHierarchicalContent([], []);
  check("negative empty-content: hasHierarchy false", result.hasHierarchy, false);
  check("negative empty-content: empty nodes", result.nodes.length, 0);
}

// ==================== Mismatched-length guard (internal invariant, should never happen from real callers) ====================
{
  const { blocks } = makeInputs([{ text: "1. Something", x: 50 }]);
  const result = buildHierarchicalContent(blocks, []);
  check("mismatched-length guard: hasHierarchy false", result.hasHierarchy, false);
}

// ==================== Source trace preserved on generated nodes ====================
{
  const { blocks, contentBlocks } = makeInputs([{ text: "1. Field Operations", x: 50 }, { text: "Managed a 40-person field crew.", type: "bullet", x: 70 }]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("source trace: subheading node id matches content block id", result.nodes[0]?.id, contentBlocks[0].id);
  check("source trace: subheading node source matches content block source", result.nodes[0]?.source, contentBlocks[0].source);
  check("source trace: bullet child id matches content block id", result.nodes[0]?.children[0]?.id, contentBlocks[1].id);
}

// ==================== verifyHierarchyOrderPreserved: positive cases across every hierarchy fixture built above ====================
{
  const shapes: { name: string; body: LineSpec[] }[] = [
    { name: "arabic", body: [{ text: "1. A", x: 50 }, { text: "b1", type: "bullet", x: 70 }, { text: "2. B", x: 50 }, { text: "b2", type: "bullet", x: 70 }] },
    { name: "nested-2-level", body: [{ text: "Programs", x: 40, weight: 700 }, { text: "1. Sub A", x: 60 }, { text: "b1", type: "bullet", x: 80 }, { text: "2. Sub B", x: 60 }, { text: "b2", type: "bullet", x: 80 }] },
    {
      name: "nested-3-level",
      body: [{ text: "Areas", x: 40, weight: 700 }, { text: "Sub Area", x: 55, weight: 700 }, { text: "1. Topic", x: 70 }, { text: "b1", type: "bullet", x: 90 }],
    },
  ];
  shapes.forEach((s) => {
    const { blocks, contentBlocks } = makeInputs(s.body);
    const result = buildHierarchicalContent(blocks, contentBlocks);
    const entry = { content: contentBlocks.map((c) => ({ id: c.id, kind: "bullet" as const, text: c.text, source: c.source })), hierarchicalContent: result.nodes, hasHierarchicalStructure: result.hasHierarchy };
    check(`order-verify ${s.name}: no violations`, verifyHierarchyOrderPreserved(entry), []);
  });
}

// ==================== verifyHierarchyOrderPreserved: flat (non-hierarchical) entry always passes trivially ====================
{
  check("order-verify flat entry: no violations (order doesn't apply)", verifyHierarchyOrderPreserved({ content: [], hierarchicalContent: [], hasHierarchicalStructure: false }), []);
}

// ==================== verifyHierarchyOrderPreserved: detects a hand-crafted violation (proves the check actually checks something) ====================
{
  const src = { sourceSectionId: "s1", sourceBlockIds: ["b0"], sourceElementIds: ["e0"] };
  const content = [
    { id: "c0", kind: "subheading" as const, text: "1. First", source: src },
    { id: "c1", kind: "bullet" as const, text: "bullet under first", source: src },
    { id: "c2", kind: "subheading" as const, text: "2. Second", source: src },
  ];
  // Hand-built tree that SWAPS the two subheadings relative to content[]'s own order - simulates a hypothetical
  // future bug in the tree-construction algorithm, not a real output of buildHierarchicalContent.
  const swappedTree: HierarchicalContentNode[] = [
    { id: "c2", kind: "subheading", text: "2. Second", depth: 0, children: [], source: src },
    { id: "c0", kind: "subheading", text: "1. First", depth: 0, children: [{ id: "c1", kind: "bullet", text: "bullet under first", depth: 1, children: [], source: src }], source: src },
  ];
  const violations = verifyHierarchyOrderPreserved({ content, hierarchicalContent: swappedTree, hasHierarchicalStructure: true });
  check("order-verify swapped tree: exactly 3 violations (one per mismatched position)", violations.length, 3);
}

/*
  ====================================================================
  Phase 2A - bullet-under-bullet nesting.

  Geometry model for these cases: subsection headings at x=50, first-
  level bullets at x=70, second-level bullets at x=90 (a 20pt outline
  level, comfortably past BULLET_CHILD_MIN_INDENT_DELTA), third level at
  x=110. Lines advance 20pt vertically with height 12 unless a case
  overrides `y` on purpose.
  ====================================================================
*/

function childTexts(node: HierarchicalContentNode | undefined): string[] {
  return (node?.children ?? []).map((c) => c.text);
}

// ==================== Phase 2A positive: parent bullet + 2 genuinely deeper bullets ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "5) FF-PCB Electrical Component Business", x: 50 },
    { text: "LGES xEV Toyota program sensing-cable order.", type: "bullet", x: 70 },
    { text: "Co-developed the ESS pilot program.", type: "bullet", x: 90 },
    { text: "Leading pilot development of a CCS assembly.", type: "bullet", x: 90 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  const subheading = result.nodes[0];
  check("2A nested: one subheading at top level", result.nodes.length, 1);
  check("2A nested: subheading has exactly ONE direct bullet child", subheading?.children.length, 1);
  check("2A nested: parent bullet text", subheading?.children[0]?.text, "LGES xEV Toyota program sensing-cable order.");
  check("2A nested: parent bullet has exactly 2 children", childTexts(subheading?.children[0]), [
    "Co-developed the ESS pilot program.",
    "Leading pilot development of a CCS assembly.",
  ]);
  check("2A nested: parent bullet depth", subheading?.children[0]?.depth, 1);
  check("2A nested: child bullet depth", subheading?.children[0]?.children[0]?.depth, 2);
  check("2A nested: order invariant holds", verifyHierarchyOrderPreserved({ content: contentBlocks.map((c, i) => ({ ...c, kind: blocks[i].blockType === "bullet" ? ("bullet" as const) : ("paragraph" as const) })), hierarchicalContent: result.nodes, hasHierarchicalStructure: result.hasHierarchy }), []);
}

// ==================== Phase 2A positive: nesting closes when a parent-level bullet returns ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    { text: "Parent bullet one.", type: "bullet", x: 70 },
    { text: "Child of parent one.", type: "bullet", x: 90 },
    { text: "Parent bullet two.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  const subheading = result.nodes[0];
  check("2A close: subheading has 2 parent-level bullets", childTexts(subheading), ["Parent bullet one.", "Parent bullet two."]);
  check("2A close: first parent keeps its single child", childTexts(subheading?.children[0]), ["Child of parent one."]);
  check("2A close: returning bullet has no children", subheading?.children[1]?.children.length, 0);
  check("2A close: returning bullet is back at depth 1", subheading?.children[1]?.depth, 1);
}

// ==================== Phase 2A positive: three bullet levels nest recursively ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    { text: "Level one.", type: "bullet", x: 70 },
    { text: "Level two.", type: "bullet", x: 90 },
    { text: "Level three.", type: "bullet", x: 110 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  const lvl1 = result.nodes[0]?.children[0];
  const lvl2 = lvl1?.children[0];
  const lvl3 = lvl2?.children[0];
  check("2A 3-level: depth sequence", [lvl1?.depth, lvl2?.depth, lvl3?.depth], [1, 2, 3]);
  check("2A 3-level: texts nest in order", [lvl1?.text, lvl2?.text, lvl3?.text], ["Level one.", "Level two.", "Level three."]);
}

// ==================== Phase 2A positive: a Phase 1 merged wrapped child stays ONE node at child depth ====================
{
  // Phase 1 has already rejoined the wrapped line, so this arrives as a
  // single bullet block whose text is the full rejoined sentence.
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    { text: "Parent bullet.", type: "bullet", x: 70 },
    { text: "Co-developed the ESS pilot and government-funded project management.", type: "bullet", x: 90 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  const parent = result.nodes[0]?.children[0];
  check("2A wrapped child: exactly one child node", parent?.children.length, 1);
  check("2A wrapped child: text is untouched by grouping", parent?.children[0]?.text, "Co-developed the ESS pilot and government-funded project management.");
  check("2A wrapped child: sits at child depth", parent?.children[0]?.depth, 2);
}

// ==================== Phase 2A negative: same-indent bullets stay siblings ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Battery Development", x: 50 },
    { text: "Led module design.", type: "bullet", x: 70 },
    { text: "Reduced unit cost.", type: "bullet", x: 70 },
    { text: "Owned supplier qualification.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A siblings: all three remain direct children", childTexts(result.nodes[0]).length, 3);
  check("2A siblings: none acquired children", result.nodes[0]?.children.map((c) => c.children.length), [0, 0, 0]);
  check("2A siblings: all at depth 1", result.nodes[0]?.children.map((c) => c.depth), [1, 1, 1]);
}

// ==================== Phase 2A negative: tiny x jitter must NOT nest ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Battery Development", x: 50 },
    { text: "First bullet.", type: "bullet", x: 70 },
    // +4pt: real PDF coordinate jitter / kerning, far below a real outline level.
    { text: "Second bullet, very slightly right.", type: "bullet", x: 74 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A jitter: both remain siblings", childTexts(result.nodes[0]).length, 2);
  check("2A jitter: first bullet acquired no child", result.nodes[0]?.children[0]?.children.length, 0);
}

// ==================== Phase 2A negative: same-Y column neighbour with a LARGE x delta must NOT nest ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Key Metrics", x: 50, y: 0 },
    // Both bullets share one visual row - a two-column/cell layout, not a list.
    { text: "Total addressable market", type: "bullet", x: 70, y: 20 },
    { text: "USD 4.2B", type: "bullet", x: 300, y: 20 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A same-Y: column neighbour is NOT nested", childTexts(result.nodes[0]).length, 2);
  check("2A same-Y: left cell acquired no child", result.nodes[0]?.children[0]?.children.length, 0);
  check("2A same-Y: both stay at depth 1", result.nodes[0]?.children.map((c) => c.depth), [1, 1]);
}

// ==================== Phase 2A negative: a new numbered subsection closes prior bullet nesting ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    { text: "Parent bullet.", type: "bullet", x: 70 },
    { text: "Child bullet.", type: "bullet", x: 90 },
    { text: "2. Operations", x: 50 },
    { text: "Bullet under the second subsection.", type: "bullet", x: 70 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A next-subsection: two top-level subheadings", result.nodes.length, 2);
  check("2A next-subsection: second subsection owns its own bullet", childTexts(result.nodes[1]), ["Bullet under the second subsection."]);
  check("2A next-subsection: second subheading back at depth 0", result.nodes[1]?.depth, 0);
  check("2A next-subsection: nested child stayed with the first parent", childTexts(result.nodes[0]?.children[0]), ["Child bullet."]);
}

// ==================== Phase 2A negative: a date-like row is not turned into bullet hierarchy ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    { text: "Parent bullet.", type: "bullet", x: 70 },
    { text: "2019 - 2021", x: 90 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  /*
    Catching case: the date line sits 20pt right of the bullet above it
    and one line below, so it satisfies BOTH the indent threshold and the
    vertical guard. The ONLY thing preventing it from becoming that
    bullet's child is the candidate-is-a-bullet gate.
  */
  check("2A date row: stays a direct child of the subheading", childTexts(result.nodes[0]), ["Parent bullet.", "2019 - 2021"]);
  check("2A date row: the bullet above it acquired no children", result.nodes[0]?.children[0]?.children.length, 0);
  check("2A date row: date line remains a paragraph node", result.nodes[0]?.children[1]?.kind, "paragraph");
  check("2A date row: date line stays at the subsection's own depth", result.nodes[0]?.children[1]?.depth, 1);
}

// ==================== Phase 2A negative: a paragraph never becomes a nesting parent ====================
{
  const { blocks, contentBlocks } = makeInputs([
    { text: "1. Programs", x: 50 },
    /*
      Deliberately longer than MAX_SUBHEADING_LINE_LENGTH (60). A SHORT
      unpunctuated line scores +1 for header shape and, together with
      the +2 "next line is a more-indented bullet" and +1 baseline-indent
      signals, would reach the pre-existing subheading threshold of 3 -
      making the fixture a subheading rather than the paragraph this case
      is about. Running past the length limit scores -1 instead, so this
      line is a genuine paragraph under the unchanged production rules.
    */
    { text: "A plain description paragraph that runs well past the short header length limit.", x: 70 },
    { text: "Bullet further right than the paragraph.", type: "bullet", x: 90 },
  ]);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A paragraph parent: both stay direct children of the subheading", childTexts(result.nodes[0]).length, 2);
  check("2A paragraph parent: paragraph acquired no children", result.nodes[0]?.children[0]?.children.length, 0);
}

// ==================== Phase 2A invariant: no text mutation anywhere in the tree ====================
{
  const lines: LineSpec[] = [
    { text: "5) FF-PCB Electrical Component Business", x: 50 },
    { text: "LGES xEV Toyota program sensing-cable order.", type: "bullet", x: 70 },
    { text: "Co-developed the government-funded ESS pilot.", type: "bullet", x: 90 },
    { text: "Leading pilot development of a CCS assembly.", type: "bullet", x: 90 },
  ];
  const { blocks, contentBlocks } = makeInputs(lines);
  const result = buildHierarchicalContent(blocks, contentBlocks);
  check("2A immutability: flattened texts equal input rawText in source order", flattenTexts(result.nodes), blocks.map((b) => b.rawText));
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
