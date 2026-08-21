/*
  Phase 1 - wrapped physical-line -> semantic-unit reconstruction.

  THE DEFECT THIS CLOSES
    blockAdapter.ts's groupIntoLines() answers exactly one question -
    "which text runs share a visual line" - and it answers it correctly.
    Nothing afterwards answers the SECOND question: "do two adjacent
    visual lines belong to one semantic unit". So a bullet that wraps at
    the column edge arrives at resumeStructured as two blocks: the first
    keeps blockType "bullet" (it carries the glyph), the continuation is
    a plain "paragraph". experienceExtractor.ts then files them
    separately - bullets come from `blockType === "bullet"`, everything
    else becomes a description line - producing a truncated bullet plus
    an orphan paragraph. Same mechanism for "government-" / "funded
    project", "factory" / "solutions", "software &" / "algorithms".

  WHY THIS RUNS AFTER LOSSLESS VALIDATION, NOT INSIDE THE PIPELINE
    validator.ts re-derives every block's expected text from its
    sourceElementIds using blockAdapter's shouldInsertSpaceBetween(),
    which joins on a HORIZONTAL gap: `next.x - (prev.x + prev.width)`.
    Across a wrap the next run starts at the LEFT margin while the
    previous ends at the RIGHT one, so that gap is large and negative
    and the predicate returns false - i.e. the validator expects
    "factorysolutions", with no space. Any correctly-spaced merge would
    therefore be reported as a missing text span, and validator.ts's own
    gate rule ("even ONE missing element ... or ANY invented text is an
    automatic FAIL") would flip validation.passed to false, which
    canonicalResumeImportService.ts treats as a hard error. Merging
    before validation would turn every complex resume from "renders
    imperfectly" into "fails to import".

    So this layer deliberately runs on an ALREADY-VALIDATED document,
    after that gate has passed. validator.ts, blockAdapter.ts and
    buildLosslessDocument.ts are untouched, and the safety gate keeps
    exactly the strength it has today. The structured validator
    downstream checks coverage against whatever document it is handed
    (see structuredValidator.ts's own sourceBlockIds derivation), so a
    document whose blocks were merged - keeping every sourceElementId
    and one deterministic block id per merge - stays self-consistent.

  CONSERVATISM
    Every threshold below is tuned so that UNCERTAIN MEANS SEPARATE. A
    false split loses a join that the original pipeline was losing
    anyway; a false merge fuses two real facts into one and is
    unrecoverable downstream. The load-bearing gate is the right-edge
    test: text only wraps when it has run out of column, so a line that
    ended well short of the widest right edge in its own section did not
    wrap and is never a merge candidate. That single rule is what keeps
    short independent bullets, headings, company lines and complete
    compound words like "mass-production" untouched.

  SCOPE
    Wrapped prose, wrapped bullets, continuation lines and strongly
    evidenced soft-wrap hyphenation ONLY. No tables, no grids, no
    two-column reconstruction, no nested-bullet schema, no numbered
    subsection redesign, no heading changes, no schema changes.
*/
import type {
  LosslessResumeDocument,
  LosslessResumeSection,
  SemanticBlockBBox,
  SemanticContentBlock,
} from "./types";

/*
  A continuation is only plausible when the previous line actually ran
  out of horizontal room. Measured against the widest right edge in the
  same block run rather than a page constant, so a narrower column (a
  sidebar, an indented sub-list) is judged against its OWN edge. The
  tolerance is a fraction of that run's content width: ragged-right text
  routinely stops a word short of the margin, but a genuinely short,
  self-contained line stops far earlier.
*/
const RIGHT_EDGE_TOLERANCE_RATIO = 0.1;

/*
  The right-edge test is only meaningful when the run is wide enough to
  BE a text column. Caught by this file's own case 7: two short,
  unrelated lines ("Secured mass-production" / "Improved first-pass
  yield") make the run's widest right edge equal to one of them, so
  every line trivially "reaches the edge" and they falsely merged. A run
  narrower than a plausible column carries no wrap evidence at all, so
  it is left alone entirely. Deliberately generous - a genuinely wrapped
  narrow sidebar loses a join it was already losing, which is the safe
  direction, while no false merge can survive.
*/
const MIN_TRUSTED_COLUMN_WIDTH = 200;

/*
  Vertical gap between two lines of one wrapped unit, as a multiple of
  the previous line's own height. Above this the gap reads as paragraph
  or entry spacing, not leading.
*/
const MAX_LEADING_RATIO = 1.8;

/*
  The next line must sit genuinely BELOW the previous one. A block whose
  top is still inside the previous line's vertical span is a horizontal
  neighbour - the second column of a two-column row, a KPI cell, a
  right-aligned date - never a continuation. This is the same
  same-Y hazard blockAdapter.ts's own header documents for 2-column
  pages, applied here to the second-stage decision.
*/
const MIN_VERTICAL_ADVANCE_RATIO = 0.5;

/*
  A continuation may be indented relative to its first line (a hanging
  indent) but never OUT-dented, and never so far right that it is really
  a separate column. Expressed against line height so it scales with
  font size.
*/
const MAX_OUTDENT_PX = 2;
const MAX_CONTINUATION_INDENT_RATIO = 3;

/* Wrapped text keeps its type size; a size change signals a new unit. */
const MIN_FONT_SIZE_RATIO = 0.9;
const MAX_FONT_SIZE_RATIO = 1.1;

/*
  Local copies on purpose. blockAdapter.ts's BULLET_PREFIX_RE is private
  and that file is frozen for this phase, so nothing here imports or
  edits it. These are used ONLY as veto signals - widening them can just
  prevent a merge, never cause one - which is why the set below is
  allowed to be broader than blockAdapter's own (it includes the
  Korean-résumé reference mark U+203B, which starts a new note rather
  than continuing a sentence).
*/
const BULLET_LIKE_RE = /^[•◦▪·‣⁃※*\-]\s+/;
const NUMBERED_HEADING_RE = /^\(?\d{1,2}[).\]]\s+/;
const DATE_RANGE_RE =
  /\b(19|20)\d{2}\b\s*[-–—]\s*((19|20)\d{2}\b|present|current)\b|^\s*\(?(19|20)\d{2}\)?\s*[-–—]/i;
const ALL_CAPS_HEADING_RE = /^[A-Z0-9 &/,'’.\-]{2,60}$/;
const SENTENCE_END_RE = /[.!?][)"'”’]?$/;

/*
  A trailing hyphen only counts as a soft wrap when it terminates a real
  word - "high-" at a column edge - never for a bare dash or a bullet
  marker that happens to sit last.
*/
const SOFT_WRAP_HYPHEN_RE = /[A-Za-z0-9]-$/;

function looksLikeNewUnit(text: string): boolean {
  if (BULLET_LIKE_RE.test(text)) return true;
  if (NUMBERED_HEADING_RE.test(text)) return true;
  if (DATE_RANGE_RE.test(text)) return true;
  /*
    An ALL-CAPS run is a heading only when it also carries letters -
    "2019 - 2021" matches the character class but is handled by the date
    rule above, and a bare "(A)" is too short to be meaningful.
  */
  if (ALL_CAPS_HEADING_RE.test(text) && /[A-Z]{2}/.test(text)) return true;
  return false;
}

function unionBBox(a: SemanticBlockBBox, b: SemanticBlockBBox): SemanticBlockBBox {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/*
  The widest right edge across a block run. Deliberately a MAXIMUM: a
  larger value makes the right-edge gate harder to satisfy, so an
  unusual wide line in the run biases the whole run toward NOT merging,
  which is the safe direction.
*/
function effectiveRightEdge(blocks: SemanticContentBlock[]): number | null {
  let edge: number | null = null;
  for (const block of blocks) {
    if (!block.bbox) continue;
    const right = block.bbox.x + block.bbox.width;
    if (edge === null || right > edge) edge = right;
  }
  return edge;
}

function contentWidth(blocks: SemanticContentBlock[]): number | null {
  let left: number | null = null;
  let right: number | null = null;
  for (const block of blocks) {
    if (!block.bbox) continue;
    if (left === null || block.bbox.x < left) left = block.bbox.x;
    const blockRight = block.bbox.x + block.bbox.width;
    if (right === null || blockRight > right) right = blockRight;
  }
  if (left === null || right === null) return null;
  const width = right - left;
  return width > 0 ? width : null;
}

/*
  `tail` is the last ORIGINAL block folded into the run so far, never the
  accumulated block: geometry decisions must compare against the real
  last physical line, not a union box that has already grown downward.
*/
function isContinuationOf(
  tail: SemanticContentBlock,
  next: SemanticContentBlock,
  rightEdge: number,
  runWidth: number
): boolean {
  // --- required evidence -------------------------------------------
  const tailBox = tail.bbox;
  const nextBox = next.bbox;
  if (!tailBox || !nextBox) return false;
  if (tail.pageIndex !== next.pageIndex) return false;
  /*
    Adjacency is the caller's, not sourceOrder's. reconstructBlockRun walks one
    section's blocks in order and re-points `tail` at every step, so these two
    are already neighbours in that array - and that array is a contiguous slice
    of the stream preSectionRegionOrdering produced, so nothing from another
    section, column or region can sit between them.

    sourceOrder answers a different question: it is the pre-ordering, page-local
    row-major position, and it is deliberately never rewritten when a page is
    re-read column-major. On a two-column page the opposite column still counts
    up through it, so the two halves of one wrapped line land two or three apart
    and a "+1" test rejects them - not because anything separates them, but
    because a line from the other column happens to number in between. That test
    is asking about the layout the reader never sees.
  */
  if (next.rawText.length === 0 || tail.rawText.length === 0) return false;

  // --- vetoes on the previous line ---------------------------------
  if (tail.blockType === "heading" || tail.blockType === "entry-header") return false;
  if (SENTENCE_END_RE.test(tail.text)) return false;

  // --- vetoes on the next line -------------------------------------
  if (
    next.blockType === "heading" ||
    next.blockType === "entry-header" ||
    next.blockType === "bullet"
  ) {
    return false;
  }
  if (looksLikeNewUnit(next.text)) return false;

  // --- the load-bearing gate: did the previous line run out of room?
  const tailRight = tailBox.x + tailBox.width;
  if (tailRight < rightEdge - runWidth * RIGHT_EDGE_TOLERANCE_RATIO) return false;

  // --- geometry: genuinely the next line down, not a column neighbour
  const lineHeight = tailBox.height > 0 ? tailBox.height : 1;
  if (nextBox.y < tailBox.y + lineHeight * MIN_VERTICAL_ADVANCE_RATIO) return false;
  const verticalGap = nextBox.y - (tailBox.y + lineHeight);
  if (verticalGap > lineHeight * MAX_LEADING_RATIO) return false;

  // --- geometry: continuation indent --------------------------------
  if (nextBox.x < tailBox.x - MAX_OUTDENT_PX) return false;
  if (nextBox.x > tailBox.x + lineHeight * MAX_CONTINUATION_INDENT_RATIO) return false;

  // --- style compatibility ------------------------------------------
  const tailSize = tail.style?.fontSize;
  const nextSize = next.style?.fontSize;
  if (typeof tailSize === "number" && typeof nextSize === "number" && tailSize > 0) {
    const ratio = nextSize / tailSize;
    if (ratio < MIN_FONT_SIZE_RATIO || ratio > MAX_FONT_SIZE_RATIO) return false;
  }

  return true;
}

/*
  Soft-wrap hyphenation. "government-" + "funded project" becomes
  "government-funded project": the hyphen is KEPT and no space is added,
  because the compound is what the author wrote - the line break is the
  artefact, not the hyphen. The hyphen is never stripped, so a genuine
  compound cannot be silently turned into two words, and a complete
  "mass-production" sitting mid-line is never a merge candidate at all
  (it fails the right-edge gate long before this runs).
*/
function joinContinuation(previous: string, next: string): string {
  if (SOFT_WRAP_HYPHEN_RE.test(previous)) return previous + next;
  return previous + " " + next;
}

function mergeBlocks(
  accumulated: SemanticContentBlock,
  next: SemanticContentBlock
): SemanticContentBlock {
  /*
    id, pageIndex, sourceOrder, blockType and style all come from the
    FIRST line: keeping blockType is what makes a wrapped bullet stay one
    bullet for experienceExtractor.ts, and keeping the id/order keeps the
    document deterministic and in source order for the downstream
    structured validator.
  */
  const merged: SemanticContentBlock = {
    ...accumulated,
    sourceElementIds: [...accumulated.sourceElementIds, ...next.sourceElementIds],
    text: joinContinuation(accumulated.text, next.text),
    rawText: joinContinuation(accumulated.rawText, next.rawText),
  };
  if (accumulated.bbox && next.bbox) merged.bbox = unionBBox(accumulated.bbox, next.bbox);
  return merged;
}

/*
  Reconstructs ONE run of blocks (a single section's body, or the
  identity block run). Exported for direct unit testing.
*/
export function reconstructBlockRun(blocks: SemanticContentBlock[]): SemanticContentBlock[] {
  if (blocks.length < 2) return blocks;

  const rightEdge = effectiveRightEdge(blocks);
  const runWidth = contentWidth(blocks);
  if (rightEdge === null || runWidth === null) return blocks;
  if (runWidth < MIN_TRUSTED_COLUMN_WIDTH) return blocks;

  const output: SemanticContentBlock[] = [];
  let accumulated: SemanticContentBlock | null = null;
  let tail: SemanticContentBlock | null = null;

  for (const block of blocks) {
    if (accumulated === null || tail === null) {
      accumulated = block;
      tail = block;
      continue;
    }

    if (isContinuationOf(tail, block, rightEdge, runWidth)) {
      accumulated = mergeBlocks(accumulated, block);
      tail = block;
      continue;
    }

    output.push(accumulated);
    accumulated = block;
    tail = block;
  }

  if (accumulated !== null) output.push(accumulated);
  return output;
}

/*
  Document-level entry point. Returns a NEW document; the input and every
  block object it holds are left untouched, so a caller that still needs
  the pre-reconstruction document (or its already-computed validation
  report) keeps it intact.

  identityBlocks are deliberately NOT reconstructed: that run is where a
  two-column "Personal Information" header lives, and column geometry is
  exactly the case this phase is not allowed to interpret.
*/
export function reconstructWrappedLines(
  document: LosslessResumeDocument
): LosslessResumeDocument {
  const sections: LosslessResumeSection[] = document.sections.map((section) => {
    const reconstructed = reconstructBlockRun(section.blocks);
    if (reconstructed === section.blocks) return section;
    return { ...section, blocks: reconstructed };
  });

  return { ...document, sections };
}
