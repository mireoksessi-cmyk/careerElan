/*
  Phase 5D.2B - Metric Grid / KPI Card Semantic Recovery. A single,
  general-purpose detector that finds Value/Label pairs (a currency
  figure sitting directly above a short caption, and siblings like it
  in adjacent columns) ANYWHERE in the document, using ONLY geometry
  (bbox) and text shape already present on Phase 1's own
  SemanticContentBlock - no new OCR, no new AI, no resume-specific
  strings/companies/numbers.

  Real evidence (Phase 5D.0's private-resume audit, re-confirmed here,
  never quoted verbatim in this codebase per this engagement's own PII
  discipline - see fixtures/scripts/generatePhase5D2BSyntheticFixtures.mts
  for the anonymized shape this module was actually built and tested
  against): a 4-column stat-card row (a currency-with-suffix value, a
  currency-with-parenthetical-qualifier value, a short date, and an
  arrow/ratio value, each with a small-caps caption directly beneath
  it) is a single visual "KPI band," but Phase 1's own
  sectionBoundaryDetector.ts has a known, disclosed bug (documented in
  Phase 5D.0's report) that mis-promotes 2 of those 4 value cells into
  section headings purely because they lack an embedded year -
  splitting the band across TWO Phase 1 sections and scattering all 8
  blocks across "custom" sections that would otherwise render as
  nonsense text. This module does not touch that Phase 1 bug (out of
  scope this round, and Phase 1's own section-boundary logic is
  explicitly off-limits per prior rounds) - it re-derives the correct
  Value<->Label relationship independently, by geometry, regardless of
  which Phase 1 section each block ended up in.

  Detection is a plain 3-step pipeline, entirely in terms of (x, y,
  width, height) already on every block's `bbox`:
    1. Cluster same-page blocks into geometric ROWS (blocks sharing a
       close y).
    2. For each pair of directly-adjacent rows (no other row in
       between), match blocks by column (close center-x) and require
       the upper block to be VALUE-shaped and the lower to be
       LABEL-shaped.
    3. Merge row-pairs that immediately follow one another (a
       "vertical stack" of stat cards, e.g. a Score Panel with one
       Value/Label pair per line) into a single MetricGrid, and require
       the merged grid to carry at least 2 entries total - this is what
       keeps an isolated, incidental "short number above short text"
       elsewhere in an ordinary resume from ever being mistaken for a
       real grid; a real KPI/metric structure always repeats (multiple
       columns, or multiple stacked rows, or both).
*/
import type { LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, mergeTraces } from "./sourceTrace";
import type { MetricEntry, MetricGrid, StructuredTextValue } from "./types";

/* Any bare, optionally-prefixed/suffixed number - the same general
   "shape, not vocabulary" approach used elsewhere in this pipeline
   (see splitOrganizationLocation.ts's REGION_CODE_RE). Deliberately
   generic: covers "$212M+", "92%", "4.1M", "~$109.0M", "€2.5B",
   "£450K", "+15%", "-3.2%", with no resume/company/number hardcoded. */
const VALUE_CORE_RE = /^~?[+-]?[$€£]?\s*\d[\d,]*(\.\d+)?\s*(%|[kKmMbB]\+?|\+)?$/;

/* A bare arrow/ratio/score shape - "3 -> 11", "3 → 11", "4:15",
   "4/15", "8.5/10" - never a specific pair of numbers, just the shape. */
const ARROW_RATIO_RE = /^\d+(\.\d+)?\s*(→|->|to|:|\/)\s*\d+(\.\d+)?$/i;

/* A single short date/year - "Mar 2024", "2024", "04/2026" - distinct
   from a date RANGE (dateRangeParsing.ts's own domain), which always
   has two dates separated by a dash/"to" and is therefore never
   mistaken for a single metric value by this regex. */
const MONTH_ABBR_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const SHORT_DATE_VALUE_RE = new RegExp(`^(?:${MONTH_ABBR_RE}\\s+)?(?:19|20)\\d{2}$|^\\d{1,2}[/-](?:19|20)\\d{2}$`, "i");

const TRAILING_PARENTHETICAL_RE = /\s*\([^)]{1,24}\)\s*$/;
const SENTENCE_END_RE = /[.!?]$/;

const MAX_VALUE_LENGTH = 32;
const MAX_LABEL_LENGTH = 90;

/* A metric VALUE is a short, standalone number/percent/currency/ratio/
   date - optionally with one trailing parenthetical qualifier
   ("(FY2026E)", "(est.)"). Never matched against a substring - the
   WHOLE block text must be this shape, which is what keeps ordinary
   prose/bullets (which only ever CONTAIN a number, never consist of
   nothing else) from ever qualifying. */
export function looksLikeMetricValue(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) return false;
  const withoutParen = trimmed.replace(TRAILING_PARENTHETICAL_RE, "").trim();
  if (withoutParen.length === 0) return false;
  if (VALUE_CORE_RE.test(withoutParen)) return true;
  if (ARROW_RATIO_RE.test(withoutParen)) return true;
  if (SHORT_DATE_VALUE_RE.test(withoutParen)) return true;
  return false;
}

/* A metric LABEL is short descriptive text - never itself value-shaped,
   never a full sentence (bullets/paragraphs end in terminal
   punctuation far more often than a terse caption does), and must
   contain at least one letter (so a lone divider glyph can never
   qualify). */
export function looksLikeMetricLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) return false;
  if (looksLikeMetricValue(trimmed)) return false;
  if (SENTENCE_END_RE.test(trimmed)) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  return true;
}

type PositionedBlock = {
  block: SemanticContentBlock;
  sourceSectionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
};

type Row = { y: number; height: number; blocks: PositionedBlock[] };

function collectPositionedBlocks(sections: LosslessResumeSection[]): PositionedBlock[] {
  const out: PositionedBlock[] = [];
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.blockType === "bullet") continue;
      if (!block.bbox || block.rawText.trim().length === 0) continue;
      const { x, y, width, height } = block.bbox;
      out.push({ block, sourceSectionId: section.id, x, y, width, height, centerX: x + width / 2 });
    }
  }
  return out;
}

/* Clusters same-page blocks into rows by close y - tolerant enough to
   absorb ordinary sub-pixel/rounding differences between blocks that
   are visually on the same baseline, tight enough to never merge two
   genuinely different lines (a resume's own line-height is always
   comfortably larger than this). */
function clusterRows(blocks: PositionedBlock[], pageIndex: number): Row[] {
  const onPage = blocks
    .filter((b) => b.block.pageIndex === pageIndex)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Row[] = [];
  for (const b of onPage) {
    const last = rows[rows.length - 1];
    const tolerance = Math.max(3, Math.min(b.height, last?.height ?? b.height) * 0.6);
    if (last && Math.abs(b.y - last.y) <= tolerance) {
      last.blocks.push(b);
      last.height = Math.max(last.height, b.height);
    } else {
      rows.push({ y: b.y, height: b.height, blocks: [b] });
    }
  }
  return rows;
}

/* Two rows are "directly adjacent" (candidate value-row -> label-row)
   when the gap between them is small relative to their own height -
   generous enough for normal card padding, bounded enough that a
   date sitting far above an unrelated paragraph elsewhere on the page
   is never mistaken for this row's label. */
function rowsAreAdjacent(upper: Row, lower: Row): boolean {
  const gap = lower.y - (upper.y + upper.height);
  const bound = Math.max(18, Math.max(upper.height, lower.height) * 3);
  return gap <= bound;
}

function columnsAlign(a: PositionedBlock, b: PositionedBlock): boolean {
  const tolerance = Math.max(20, Math.max(a.width, b.width) * 0.5);
  return Math.abs(a.centerX - b.centerX) <= tolerance;
}

function makeValue(sectionId: string, block: SemanticContentBlock): StructuredTextValue {
  return { value: block.rawText.trim(), confidence: 0.75, extractionMethod: "layout-rule", source: traceFromBlock(sectionId, block) };
}

type RowPairMatch = { valueRow: Row; labelRow: Row; entries: { value: PositionedBlock; label: PositionedBlock }[] };

function matchRowPair(valueRow: Row, labelRow: Row): RowPairMatch | null {
  const entries: { value: PositionedBlock; label: PositionedBlock }[] = [];
  const usedLabels = new Set<PositionedBlock>();

  for (const candidateValue of valueRow.blocks) {
    if (!looksLikeMetricValue(candidateValue.block.text)) continue;
    let best: PositionedBlock | null = null;
    let bestDelta = Infinity;
    for (const candidateLabel of labelRow.blocks) {
      if (usedLabels.has(candidateLabel)) continue;
      if (!looksLikeMetricLabel(candidateLabel.block.text)) continue;
      if (!columnsAlign(candidateValue, candidateLabel)) continue;
      const delta = Math.abs(candidateValue.centerX - candidateLabel.centerX);
      if (delta < bestDelta) {
        best = candidateLabel;
        bestDelta = delta;
      }
    }
    if (best) {
      usedLabels.add(best);
      entries.push({ value: candidateValue, label: best });
    }
  }

  if (entries.length === 0) return null;
  entries.sort((a, b) => a.value.centerX - b.value.centerX);
  return { valueRow, labelRow, entries };
}

/*
  Merges row-pair matches that immediately follow one another (no
  unrelated row sitting between one pair's label row and the next
  pair's value row) into a single grid - this is what recovers a
  vertically-stacked "Score Panel"/"Project Summary Card" list (one
  Value/Label pair per line) as ONE grid instead of many singletons,
  without ever merging two genuinely unrelated pairs that happen to
  exist far apart on the same page.
*/
function mergeAdjacentRowPairMatches(matches: RowPairMatch[], allRows: Row[]): RowPairMatch[][] {
  const rowIndex = new Map<Row, number>();
  allRows.forEach((r, i) => rowIndex.set(r, i));
  const sorted = [...matches].sort((a, b) => (rowIndex.get(a.valueRow)! - rowIndex.get(b.valueRow)!));

  const groups: RowPairMatch[][] = [];
  for (const match of sorted) {
    const currentGroup = groups[groups.length - 1];
    const prev = currentGroup?.[currentGroup.length - 1];
    if (prev && rowIndex.get(prev.labelRow)! + 1 === rowIndex.get(match.valueRow)!) {
      currentGroup!.push(match);
    } else {
      groups.push([match]);
    }
  }
  return groups;
}

const MIN_ENTRIES_PER_GRID = 2;

export function detectMetricGrids(sections: LosslessResumeSection[]): { grids: MetricGrid[]; consumedBlockIds: Set<string> } {
  const positioned = collectPositionedBlocks(sections);
  const pageIndices = [...new Set(positioned.map((b) => b.block.pageIndex))].sort((a, b) => a - b);

  const grids: MetricGrid[] = [];
  const consumedBlockIds = new Set<string>();
  let gridCounter = 0;

  for (const pageIndex of pageIndices) {
    const rows = clusterRows(positioned, pageIndex);
    const matches: RowPairMatch[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      if (!rowsAreAdjacent(rows[i], rows[i + 1])) continue;
      const match = matchRowPair(rows[i], rows[i + 1]);
      if (match) matches.push(match);
    }

    for (const group of mergeAdjacentRowPairMatches(matches, rows)) {
      const flatEntries = group.flatMap((m) => m.entries);
      if (flatEntries.length < MIN_ENTRIES_PER_GRID) continue;

      const gridId = `metric-grid-${gridCounter++}`;
      const entries: MetricEntry[] = flatEntries.map((e, i) => {
        e.value.block.id && consumedBlockIds.add(e.value.block.id);
        consumedBlockIds.add(e.label.block.id);
        return {
          id: `${gridId}-entry-${i}`,
          value: makeValue(e.value.sourceSectionId, e.value.block),
          label: makeValue(e.label.sourceSectionId, e.label.block),
        };
      });
      const columns = group[0]?.entries.length ?? entries.length;
      grids.push({
        id: gridId,
        entries,
        columns,
        source: mergeTraces(...entries.map((e) => e.value.source), ...entries.map((e) => e.label.source)),
      });
    }
  }

  return { grids, consumedBlockIds };
}
