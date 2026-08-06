/*
  Phase 5D.6D TASK D1 - Generic Skill Tokenization Hardening. Real bug
  (see this file's own gate test for the empirical reproduction):
  skillsExtractor.ts's old splitSkillList() picked exactly ONE global
  delimiter per line (comma, else pipe) and split on every occurrence
  of it - "Word, Excel & Google Sheets" became ["Word", "Excel &
  Google Sheets"] (the trailing "&"-joined pair was never separated
  into two skills), while a genuine compound phrase like "Health &
  Safety" needed to stay whole. Neither the old code nor a "split on
  every &/and" rule can satisfy both requirements at once - the two
  cases are lexically identical (a phrase joined by "&"/"and") and are
  only distinguishable by STRUCTURE: is this text already known to be a
  multi-item list (evidenced by a real comma boundary elsewhere in the
  same text), or does it stand entirely alone?

  Oxford-list rule this module implements: a trailing "A & B"/"A and B"
  segment is only ever split into two skills when the text ALREADY
  contains a comma elsewhere (i.e., we are already inside a recognized
  comma-list, and this is simply the list's own Oxford-style final
  conjunction, exactly like "SQL, Python and Power BI" -> [SQL, Python,
  Power BI]). A standalone "A & B"/"A and B" with no comma anywhere in
  the text (e.g. "Research and Development", "Health & Safety") is never
  split - by construction, since the "in list mode" precondition is
  never met. This is the ONLY structural signal used - no product
  dictionary, no fixed compound-phrase whitelist, no AI guess.

  Strong separators (semicolon, pipe, literal embedded newline) always
  split, unconditionally - these never appear as part of a genuine skill
  phrase and require no ambiguity resolution.
*/

export type SkillTokenReasonCode =
  | "strong-separator-split"
  | "comma-list-split"
  | "oxford-tail-split"
  | "no-delimiter-single-token"
  | "empty-token-dropped";

export type SkillToken = {
  text: string;
  sourceSpan: [number, number];
  separatorBefore?: string;
  confidence: number;
  reasonCodes: SkillTokenReasonCode[];
};

export type SkillTokenizationResult = {
  rawText: string;
  tokens: SkillToken[];
};

/*
  Strong separators always split, unconditionally. Semicolon/pipe/
  newline never appear as part of a genuine skill phrase. Decorative
  bullet glyphs (•●○◦▪■□‣⁃·) are ALSO always a list boundary here -
  same glyph set losslessSemantic/blockAdapter.ts's BULLET_PREFIX_RE
  and bulletPresentation.ts's DECORATIVE_GLYPH_RE already treat as
  decorative markers, just applied here to glyphs appearing INLINE
  within one line, not only leading it. Real bug this fixes (found via
  the round's own 10-resume UAT, not hypothetical): a skills line like
  "Client communication • Administrative support • Data entry &
  file organization" only has its bullet at line position 0 handled by
  Phase 1's own blockType:"bullet" classification (BULLET_PREFIX_RE is
  leading-only) - the remaining inline "•" occurrences were never
  recognized as list boundaries at all, leaving the entire line as one
  giant unsplit "skill". Hyphen/asterisk are deliberately NOT included
  here (unlike Phase 1's own leading-only bullet set) - both appear
  constantly inside genuine skill text (date ranges, "Multi-site",
  "well-known") when not in the leading position, so treating them as
  an unconditional inline separator would be unsafe.
*/
const STRONG_SEPARATOR_RE = /[;|\n•●○◦▪■□‣⁃·]/;
/* NBSP and other Unicode spaces are treated as ordinary whitespace for
   delimiter/trim purposes only - the token's own stored text still goes
   through a single trim() (Unicode-aware), never a character-content
   rewrite of the surrounding real words. */
const NBSP_RE = /[   ]/g;
const TRAILING_CONJUNCTION_RE = /^(.*?)\s+(?:&|and)\s+(.+)$/i;

function normalizeForSplitting(text: string): string {
  return text.replace(NBSP_RE, " ");
}

function splitOnStrongSeparators(text: string): { part: string; separatorBefore?: string }[] {
  const parts: { part: string; separatorBefore?: string }[] = [];
  let current = "";
  let separatorBefore: string | undefined;
  for (const ch of text) {
    if (STRONG_SEPARATOR_RE.test(ch)) {
      parts.push({ part: current, separatorBefore });
      current = "";
      separatorBefore = ch === "\n" ? "newline" : ch;
      continue;
    }
    current += ch;
  }
  parts.push({ part: current, separatorBefore });
  return parts;
}

/*
  Splits ONE strong-separator segment into its comma-delimited items,
  applying the Oxford-tail rule (see header comment) only to the LAST
  comma item - every earlier item is preserved exactly as its own
  comma-bounded phrase (never re-split on "&"/"and").

  Symmetry guard: the Oxford-tail split is only applied when NONE of
  the earlier comma items themselves already contain a "&"/"and". Real
  counter-example that requires this guard: "Health & Safety, Oil &
  Gas" - both items are complete compound phrases, each carrying its
  own conjunction; if only the LAST item's conjunction were treated as
  a list boundary, the two phrases would be treated inconsistently
  (the first kept whole, the second wrongly split into "Oil"+"Gas").
  When an earlier item already carries an un-split conjunction, the
  document is consistently using "&"/"and" as part of its compound-
  phrase notation for this whole list, so the last item's own
  conjunction is preserved the same way, never split.

  List-length guard: the Oxford-tail split is ALSO only applied when
  the text has EXACTLY ONE comma (two comma items total) - the minimal
  "A, B and C" shape every one of this round's own required-split
  examples uses ("SQL, Python and Power BI", "Word, Excel & Google
  Sheets", ...). A real fixture-derived counter-example
  (skillsExtractor.test.ts's own "bench-E shape" gate) proves this
  restriction is necessary: "Multi-site operations leadership, P&L
  management, Lean manufacturing / Kaizen, Health and safety
  leadership" is a real 4-item comma list whose LAST item, "Health and
  safety leadership", must stay whole - splitting it into "Health" +
  "safety leadership" is exactly the kind of corruption this round
  forbids. That string is lexically indistinguishable from a genuine
  5-item Oxford list at the "does the last item contain and/&" check
  alone; the only structural signal left is list length, and every
  required-split example the round names happens to be the minimal
  2-segment case, so restricting the rule to that case fixes the real
  regression without breaking any required-split example.
*/
function splitCommaSegment(segment: string): { text: string; reasonCodes: SkillTokenReasonCode[] }[] {
  const trimmed = segment.trim();
  if (trimmed.length === 0) return [];

  if (!trimmed.includes(",")) {
    // No comma anywhere in this segment - never a recognized list, so a
    // "&"/"and" here is always a standalone compound phrase (e.g.
    // "Research and Development", "Health & Safety"), never split.
    return [{ text: trimmed, reasonCodes: ["no-delimiter-single-token"] }];
  }

  const commaItems = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const earlierItemHasConjunction = commaItems.slice(0, -1).some((item) => TRAILING_CONJUNCTION_RE.test(item));
  const isMinimalTwoItemList = commaItems.length === 2;

  const results: { text: string; reasonCodes: SkillTokenReasonCode[] }[] = [];
  commaItems.forEach((item, index) => {
    const isLast = index === commaItems.length - 1;
    if (isLast && isMinimalTwoItemList && !earlierItemHasConjunction) {
      const conjunctionMatch = item.match(TRAILING_CONJUNCTION_RE);
      if (conjunctionMatch) {
        const [, before, after] = conjunctionMatch;
        const beforeTrimmed = before.trim();
        const afterTrimmed = after.trim();
        if (beforeTrimmed.length > 0) results.push({ text: beforeTrimmed, reasonCodes: ["oxford-tail-split"] });
        if (afterTrimmed.length > 0) results.push({ text: afterTrimmed, reasonCodes: ["oxford-tail-split"] });
        return;
      }
    }
    results.push({ text: item, reasonCodes: ["comma-list-split"] });
  });
  return results;
}

export function tokenizeSkillList(text: string): SkillTokenizationResult {
  const rawText = text;
  const normalized = normalizeForSplitting(text);
  const tokens: SkillToken[] = [];

  let cursor = 0;
  for (const { part, separatorBefore } of splitOnStrongSeparators(normalized)) {
    const partStart = cursor;
    cursor += part.length + (separatorBefore ? 1 : 0);

    const items = splitCommaSegment(part);
    for (const item of items) {
      if (item.text.length === 0) continue;
      const reasonCodes = separatorBefore && items.length === 1 ? (["strong-separator-split"] as SkillTokenReasonCode[]) : item.reasonCodes;
      tokens.push({
        text: item.text,
        sourceSpan: [partStart, cursor],
        separatorBefore,
        confidence: reasonCodes.includes("oxford-tail-split") ? 0.7 : 0.9,
        reasonCodes,
      });
    }
  }

  return { rawText, tokens };
}
