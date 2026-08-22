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
import { traceFromBlock } from "./sourceTrace";
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

export function extractLanguageEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): LanguageEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);
  if (relevant.length === 0) return [];

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
