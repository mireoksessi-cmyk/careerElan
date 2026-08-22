/*
  Inline language extraction for sections the classifier has already
  typed as `languages`. Purely structural: the section's own
  classification is the semantic gate, and nothing here knows what any
  particular language or proficiency word means.

  Known L2 limitation: within a Languages-classified section, terminal
  parenthetical metadata is stored as proficiency without a semantic
  dictionary, so a language-variety/qualifier form may be represented as
  proficiency. The original Languages custom section is preserved
  unchanged either way, so no source text depends on this reading.

  Extraction is all-or-nothing per section - one malformed or
  unsupported item returns [] for the whole section, and the caller's
  existing custom-section fallback keeps the content exactly as before.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock, traceFromBlocks } from "./sourceTrace";
import { normalizeBulletPresentation } from "./bulletPresentation";
import type { LanguageEntry } from "./types";

/* At most ONE terminator, at the very end of a block - a real form
   writes a language line as a sentence-terminated phrase. Anything
   beyond a single trailing terminator is left alone and will fail the
   item grammar below rather than being trimmed away. */
const TRAILING_TERMINATOR_RE = /[.!?]$/;

/* Label/value pairing written with a colon or a dash is a different
   syntax with no evidence behind it in this corpus. Rejected outright
   rather than guessed at. A spaced hyphen reads as a pairing dash; an
   unspaced one is left alone, since it occurs inside ordinary
   hyphenated names. */
const UNSUPPORTED_PAIR_FORM_RE = /[:–—]|\s-\s/;

type ParsedItem = { name: string; proficiency?: string };

/*
  Peer items separated at parenthesis depth 0 only, so a separator
  inside a parenthetical value never splits its own item. Returns null
  when the parentheses do not balance, which fails the whole section.
*/
function splitPeerItems(text: string): string[] | null {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth < 0) return null;
    }
    if (depth === 0 && (character === "," || character === ";")) {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (depth !== 0) return null;
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

/*
  One item is either a bare label, or a label followed by a single
  parenthetical group that ends the item. Every other shape - nested or
  repeated groups, a stray closing parenthesis, trailing text, an empty
  side - returns null and fails the section.
*/
function parseItem(raw: string): ParsedItem | null {
  const item = raw.trim();
  if (item.length === 0) return null;
  if (UNSUPPORTED_PAIR_FORM_RE.test(item)) return null;

  const open = item.indexOf("(");
  if (open === -1) {
    if (item.includes(")")) return null;
    return { name: item };
  }
  if (!item.endsWith(")")) return null;

  const name = item.slice(0, open).trim();
  const value = item.slice(open + 1, -1).trim();
  if (name.length === 0 || value.length === 0) return null;
  if (value.includes("(") || value.includes(")")) return null;
  return { name, proficiency: value };
}

/*
  Some sections lay their languages out as a grid rather than a list: a
  row of language names with a row of proficiencies beneath it, one
  language per column. Read as a flat list that becomes N language names
  followed by N more "names" that are really proficiencies, so the list
  grammar below cannot be allowed to see it.

  What makes the reading safe is that the whole lower row repeats one
  value. A column layout of independent languages has no reason to say
  the same thing twice, while a shared proficiency has every reason to.
  That is a judgement about how documents are written, not something the
  geometry proves - a grid whose lower row happens to repeat an
  independent language would still be paired, and no dictionary-free
  rule can tell the two apart. The original section survives untouched
  as a custom section either way, so the source text never depends on
  this reading.

  Everything else here is structural: rows come from real vertical
  overlap, columns from real horizontal overlap, and a column must claim
  exactly one cell in each row. There is no tolerance to tune and no
  lane count baked in - two columns and ten behave identically.
*/
type GridCell = { block: SemanticContentBlock; text: string; x: number; y: number; width: number; height: number };

/* Rows are groups of cells whose vertical extents actually overlap. */
function clusterRows(cells: GridCell[]): GridCell[][] {
  const rows: GridCell[][] = [];
  for (const cell of [...cells].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const current = rows[rows.length - 1];
    const anchor = current?.[0];
    const overlapsAnchor = anchor !== undefined && cell.y < anchor.y + anchor.height && anchor.y < cell.y + cell.height;
    if (overlapsAnchor) current.push(cell);
    else rows.push([cell]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

function horizontallyOverlaps(a: GridCell, b: GridCell): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

/*
  null  - not a grid at all; the caller's list grammar handles it.
  []    - a grid, but one this rule will not read; the caller must NOT
          fall through, because the list grammar would turn the lower
          row's values into language names.
  [...] - one entry per column.
*/
function extractLanguageGrid(sectionId: string, blocks: SemanticContentBlock[]): LanguageEntry[] | null {
  if (blocks.length < 4) return null;
  if (blocks.some((b) => !b.bbox)) return null;
  if (blocks.some((b) => b.pageIndex !== blocks[0].pageIndex)) return null;

  const cells: GridCell[] = blocks.map((block) => ({
    block,
    text: normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText.trim(),
    x: block.bbox!.x,
    y: block.bbox!.y,
    width: block.bbox!.width,
    height: block.bbox!.height,
  }));

  const rows = clusterRows(cells);
  /* A plain vertical list is every row holding a single cell - not a
     grid, and nothing below should run on it. */
  if (rows.length < 2 || !rows.some((row) => row.length >= 2)) return null;

  /* Past here the section IS a grid, so every remaining check fails
     closed rather than handing the cells back to the list grammar. */
  if (rows.length !== 2) return [];

  const [upperRow, lowerRow] = rows;
  if (upperRow.length !== lowerRow.length) return [];
  if (upperRow.length < 2) return [];

  for (const row of rows) {
    for (let i = 0; i + 1 < row.length; i++) {
      if (row[i].x + row[i].width > row[i + 1].x) return [];
    }
  }

  const partners: GridCell[] = [];
  const claimed = new Set<GridCell>();
  for (const upper of upperRow) {
    const matches = lowerRow.filter((lower) => horizontallyOverlaps(upper, lower));
    if (matches.length !== 1) return [];
    if (claimed.has(matches[0])) return [];
    claimed.add(matches[0]);
    partners.push(matches[0]);
  }
  if (claimed.size !== lowerRow.length) return [];
  for (let i = 0; i + 1 < partners.length; i++) {
    if (partners[i].x > partners[i + 1].x) return [];
  }

  const names = upperRow.map((cell) => cell.text);
  const values = partners.map((cell) => cell.text);
  if (names.some((n) => n.length === 0) || values.some((v) => v.length === 0)) return [];
  if (new Set(names).size !== names.length) return [];
  if (new Set(values).size !== 1) return [];
  if (names.includes(values[0])) return [];

  return upperRow.map((upper, index) => ({
    name: upper.text,
    proficiency: partners[index].text,
    source: traceFromBlocks(sectionId, [upper.block, partners[index].block]),
  }));
}

export function extractLanguageEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): LanguageEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);
  if (relevant.length === 0) return [];

  const grid = extractLanguageGrid(sectionId, relevant);
  if (grid !== null) return grid;

  const entries: LanguageEntry[] = [];
  for (const block of relevant) {
    const displayText = normalizeBulletPresentation(block.rawText, { blockType: block.blockType }).displayText;
    const text = displayText.trim().replace(TRAILING_TERMINATOR_RE, "").trim();
    if (text.length === 0) return [];

    const items = splitPeerItems(text);
    if (items === null || items.length === 0) return [];

    for (const item of items) {
      const parsed = parseItem(item);
      if (parsed === null) return [];
      const source = traceFromBlock(sectionId, block);
      entries.push(parsed.proficiency === undefined ? { name: parsed.name, source } : { name: parsed.name, proficiency: parsed.proficiency, source });
    }
  }

  if (entries.length === 0) return [];

  /*
    A bare label carries no structural marker of its own, so a lone one
    is indistinguishable from an ordinary line of text that happens to
    sit under this heading. Peer items are the only evidence available
    without a dictionary, so bare labels are accepted only when the
    section actually reads as a list.
  */
  if (entries.some((entry) => entry.proficiency === undefined) && entries.length < 2) return [];

  return entries;
}
