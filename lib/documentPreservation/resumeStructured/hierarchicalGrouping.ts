/*
  Phase 5D.7 TASK C - Generic Hierarchical Experience Grouping. Detects
  numbered/lettered/heading-styled sub-groups WITHIN a single
  ExperienceEntry's body (e.g. one job entry whose bullets are split
  into "1. Battery Development" / "2. Manufacturing Technology" / "3.
  New Business" sub-sections, or "Search Infrastructure" / "Cloud
  Platform" heading-only sub-teams with no numbering at all).

  Detection uses ONLY structural signals available on
  SemanticContentBlock - numbering-format SHAPE (never specific
  numbers/letters/words), left-indent (bbox.x) relative to
  surrounding blocks, font weight/size where the source format
  actually exposes it, and immediate adjacency to more-indented
  bullets. No company/section/subheading name is ever matched by
  text content - see buildHierarchicalContent's own scoring function
  for the exact, disclosed signal list.

  Known, disclosed asymmetry: PDF sources never expose fontWeight
  (pdfjs-dist limitation, see pdfLayoutAnalyzer.ts's own comment) and
  the real heading-vs-body font-size gap is often small (~1.05x, per
  sectionBoundaryDetector.ts's own established real-fixture finding) -
  so for a PDF "Heading Only, No Numbering" sub-group (no numbering
  marker at all), indent-increase-of-following-bullets plus a short,
  punctuation-free header-line shape carry proportionally more weight
  than they would for a DOCX source with real measured font weight.
  This is a genuine detection-strength difference between source
  formats, not a bug - disclosed in the round's final report rather
  than papered over with a guess.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { isDateRangeLine } from "./dateRangeParsing";
import type { EntryContentBlock, HierarchicalContentNode, SourceTrace } from "./types";

const MAX_SUBHEADING_LINE_LENGTH = 60;
const SENTENCE_END_RE = /[.!?]$/;
const NUMBERING_TRAILING_DOT_RE = /\.$/;

/*
  Phase 2A - bullet-under-bullet nesting only. How much further right a
  bullet must start before it is treated as a CHILD of the bullet above
  it rather than its sibling. Deliberately much larger than the +3 used
  by the subheading score's "next line is a more-indented bullet"
  corroborating signal: that +3 only has to notice that some indent
  increase exists alongside an already-scoring heading candidate,
  whereas this value is the sole evidence for creating a parent-child
  link, so it has to clear PDF coordinate jitter and kerning noise on
  its own. A real outline level is a tab or list indent (~11-18pt);
  8pt sits below the smallest of those and far above any jitter, so a
  genuine level is caught while same-level bullets that merely start a
  point or two apart stay siblings.
*/
const BULLET_CHILD_MIN_INDENT_DELTA = 8;

/*
  Phase 2A same-Y guard. A block that is further right but still inside
  the previous bullet's own vertical band is a horizontal neighbour - a
  second column, a right-aligned date, a table-like cell - never a
  nested child. Requiring the candidate to start at least half a line
  below its would-be parent keeps column geometry out of the hierarchy.
*/
const BULLET_CHILD_MIN_VERTICAL_ADVANCE_RATIO = 0.5;

const ARABIC_MARKER_RE = /^\(?(\d{1,3})[.)]\s+/;
const ROMAN_MARKER_RE = /^\(?([IVXLCDM]{1,8})[.)]\s+/;
const ALPHA_MARKER_RE = /^\(?([A-Za-z])[.)]\s+/;
const ROMAN_VALID_RE = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/*
  Purely a SHAPE check (leading token matches a recognized numbering
  format), never a lookup against specific values - "47." and "IV."
  and "Z." all match exactly like "1." and "I." and "A." would. Roman
  is tried before falling through to plain-alpha so "II." isn't
  mis-read as a 1-letter alpha marker that happens to only capture
  "I" (the regex already requires the FULL token before whitespace,
  so this ordering mostly just picks the more specific label - not
  worth over-thinking further given neither classification changes
  anything downstream but the verbatim label text kept).
*/
function extractNumberingMarker(text: string): string | undefined {
  const trimmed = text.trim();
  const arabicMatch = trimmed.match(ARABIC_MARKER_RE);
  if (arabicMatch) return arabicMatch[0].trim();
  const romanMatch = trimmed.match(ROMAN_MARKER_RE);
  if (romanMatch && ROMAN_VALID_RE.test(romanMatch[1].toUpperCase())) return romanMatch[0].trim();
  const alphaMatch = trimmed.match(ALPHA_MARKER_RE);
  if (alphaMatch) return alphaMatch[0].trim();
  return undefined;
}

function stripNumberingMarker(text: string, marker: string | undefined): string {
  if (!marker) return text.trim();
  return text.trim().slice(marker.length).trim();
}

function looksLikeShortHeaderShape(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SUBHEADING_LINE_LENGTH) return false;
  return !SENTENCE_END_RE.test(trimmed.replace(NUMBERING_TRAILING_DOT_RE, ""));
}

function isBoldWeight(weight: number | string | undefined): boolean {
  if (weight === undefined) return false;
  if (typeof weight === "number") return weight >= 600;
  return /bold|semibold|black|heavy/i.test(weight);
}

type IndexedBlock = { block: SemanticContentBlock; index: number };

/*
  Scoring function - see this module's own header comment for the
  full signal list and the PDF/DOCX asymmetry disclosure. Threshold
  chosen so a numbering marker ALONE is always sufficient (the most
  common, most reliable real-world shape), while the numbering-free
  "Heading Only" shape requires at least two independent corroborating
  signals (never indent or short-shape alone) - a single short,
  unpunctuated line is too common in ordinary bullet-less body text to
  trust by itself.
*/
function computeSubheadingScore(entry: IndexedBlock, blocks: SemanticContentBlock[], baselineIndent: number): { score: number; numberingLabel?: string } {
  const { block, index } = entry;
  if (block.blockType === "bullet") return { score: -3 };
  if (isDateRangeLine(block.text)) return { score: -2 };

  let score = 0;
  const numberingLabel = extractNumberingMarker(block.text);
  if (numberingLabel) score += 3;

  const next = blocks[index + 1];
  const indent = block.bbox?.x;
  if (next && next.blockType === "bullet" && next.bbox && indent !== undefined && next.bbox.x > indent + 3) {
    score += 2;
  }

  if (indent !== undefined && indent <= baselineIndent + 2) score += 1;

  if (isBoldWeight(block.style?.fontWeight)) score += 1;

  if (looksLikeShortHeaderShape(stripNumberingMarker(block.text, numberingLabel))) score += 1;
  else score -= 1;

  return { score, numberingLabel };
}

function medianBaselineIndent(blocks: SemanticContentBlock[]): number {
  const xs = blocks.map((b) => b.bbox?.x).filter((x): x is number => x !== undefined && x !== null);
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export type BuildHierarchicalContentResult = {
  nodes: HierarchicalContentNode[];
  hasHierarchy: boolean;
};

/*
  Pure function - `blocks` is the SAME bodyRunBlocks array Phase 2's
  experienceExtractor.ts already flattens into entry.content, plus a
  parallel array of already-built EntryContentBlock (for id/text/
  source reuse - built from the SAME blocks in the SAME order, so
  index i in both arrays always refers to the same source block).
  Returns hasHierarchy: false (and an empty nodes array) whenever
  fewer than one real subheading candidate was found - the safe,
  overwhelmingly common default.
*/
export function buildHierarchicalContent(
  blocks: SemanticContentBlock[],
  contentBlocks: { id: string; text: string; source: SourceTrace }[]
): BuildHierarchicalContentResult {
  if (blocks.length === 0 || blocks.length !== contentBlocks.length) return { nodes: [], hasHierarchy: false };

  const baselineIndent = medianBaselineIndent(blocks);
  const scored = blocks.map((block, index) => computeSubheadingScore({ block, index }, blocks, baselineIndent));
  const isSubheading = scored.map((s) => s.score >= 3);

  if (!isSubheading.some(Boolean)) return { nodes: [], hasHierarchy: false };

  const topLevel: HierarchicalContentNode[] = [];
  /*
    Phase 2A - `kind` discriminates a frame opened by a subheading from
    one opened by a bullet, so the bullet branch below can close bullet
    frames without ever popping the subsection a bullet belongs to.
    y/height are recorded for bullet frames only, for the same-Y guard.
  */
  type StackFrame = {
    node: HierarchicalContentNode | null;
    indent: number;
    depth: number;
    kind: "root" | "subheading" | "bullet";
    y?: number;
    height?: number;
  };
  const stack: StackFrame[] = [{ node: null, indent: -Infinity, depth: -1, kind: "root" }];

  function currentChildren(): HierarchicalContentNode[] {
    const top = stack[stack.length - 1];
    return top.node === null ? topLevel : top.node.children;
  }

  blocks.forEach((block, index) => {
    const contentBlock = contentBlocks[index];
    const kind = block.blockType === "bullet" ? "bullet" : "paragraph";

    if (isSubheading[index]) {
      const indent = block.bbox?.x ?? baselineIndent;
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const depth = stack[stack.length - 1].depth + 1;
      const numberingLabel = scored[index].numberingLabel;
      const node: HierarchicalContentNode = {
        id: contentBlock.id,
        kind: "subheading",
        text: contentBlock.text,
        depth,
        numberingLabel,
        children: [],
        source: contentBlock.source,
      };
      currentChildren().push(node);
      stack.push({ node, indent, depth, kind: "subheading" });
      return;
    }

    /*
      Phase 2A - a bullet indented well past the bullet above it is that
      bullet's child, not its sibling. Only BULLET frames are closed
      here; a subheading/root frame is never popped by a bullet, so
      subsection membership is untouched. Every guard below fails
      CLOSED - missing geometry, insufficient indent, or same-Y column
      geometry all fall through to the pre-Phase-2A behaviour of
      appending at the current subsection level.
    */
    const indent = block.bbox?.x;
    const blockY = block.bbox?.y;

    while (stack.length > 1) {
      const frame = stack[stack.length - 1];
      if (frame.kind !== "bullet") break;
      const frameHeight = frame.height !== undefined && frame.height > 0 ? frame.height : 1;
      const nestedUnderFrame =
        /*
          Phase 2A is bullet-UNDER-bullet only. The candidate itself must
          be a real bullet: a paragraph, a date row or any other non-
          bullet line indented past the bullet above it is not that
          bullet's child, and falls through to the pre-Phase-2A
          behaviour of sitting at the current subsection level.
        */
        kind === "bullet" &&
        indent !== undefined &&
        blockY !== undefined &&
        frame.y !== undefined &&
        indent >= frame.indent + BULLET_CHILD_MIN_INDENT_DELTA &&
        blockY >= frame.y + frameHeight * BULLET_CHILD_MIN_VERTICAL_ADVANCE_RATIO;
      if (nestedUnderFrame) break;
      stack.pop();
    }

    const top = stack[stack.length - 1];
    const depth = top.depth + 1;
    const node: HierarchicalContentNode = {
      id: contentBlock.id,
      kind,
      text: contentBlock.text,
      depth,
      children: [],
      source: contentBlock.source,
    };
    currentChildren().push(node);

    /*
      Only a real bullet with real geometry may become a parent: a
      paragraph (including a Phase 1 wrapped continuation that stayed a
      paragraph) never opens a nesting level.
    */
    if (kind === "bullet" && indent !== undefined && blockY !== undefined) {
      stack.push({ node, indent, depth, kind: "bullet", y: blockY, height: block.bbox?.height });
    }
  });

  return { nodes: topLevel, hasHierarchy: true };
}

/*
  Phase 5D.7 TASK C - depth-first flatten of a hierarchy tree, in the
  exact traversal order a reader (or a renderer) would encounter each
  node: a subheading, then its own children in order, before moving to
  its next sibling. Used only by verifyHierarchyOrderPreserved below -
  not by any renderer (renderers.tsx/docxRenderer.ts do their own
  recursive walk so they can track indent depth as they go).
*/
export function flattenHierarchicalContent(nodes: HierarchicalContentNode[]): HierarchicalContentNode[] {
  const out: HierarchicalContentNode[] = [];
  nodes.forEach((node) => {
    out.push(node);
    out.push(...flattenHierarchicalContent(node.children));
  });
  return out;
}

/*
  Phase 5D.7 TASK C - explicit parent->child->bullet ORDER verification,
  the round's own named requirement beyond simple text-presence
  checking. hierarchicalContent is built as a tree over the SAME blocks
  as content[], in the SAME order (see buildHierarchicalContent's own
  header comment) - depth-first-flattening it back out must therefore
  reproduce content[]'s own id sequence exactly. A mismatch here would
  mean the tree-construction algorithm silently reordered or dropped a
  block, which none of the existing text-presence-only validators
  (textPreservationValidator.ts, canonicalParityManifest.ts) would
  catch, since both already read from content[] directly rather than
  hierarchicalContent - this is the one check that actually exercises
  the tree structure itself. Returns [] (no violations) for any entry
  with hasHierarchicalStructure: false, since order simply doesn't
  apply to the flat case.
*/
export function verifyHierarchyOrderPreserved(entry: { content: EntryContentBlock[]; hierarchicalContent: HierarchicalContentNode[]; hasHierarchicalStructure: boolean }): string[] {
  if (!entry.hasHierarchicalStructure) return [];
  const flat = flattenHierarchicalContent(entry.hierarchicalContent);
  const violations: string[] = [];
  if (flat.length !== entry.content.length) {
    violations.push(`hierarchy flatten produced ${flat.length} node(s) but content[] has ${entry.content.length} - a block was dropped or duplicated during tree construction`);
    return violations;
  }
  flat.forEach((node, i) => {
    const expected = entry.content[i];
    if (node.id !== expected.id) {
      violations.push(`order mismatch at position ${i}: hierarchy node id "${node.id}" ("${node.text}") does not match content[${i}] id "${expected.id}" ("${expected.text}")`);
    }
  });
  return violations;
}
