/*
  TASK 4 - Shared ordered/scoped fragment matching, generalizing the
  advancing-cursor pattern Phase 5B's docxParityValidator.ts already
  proved out (fixing a real naive-indexOf collision bug where two
  entries sharing a short generic marker like a bare "ON" province code
  made a later entry falsely "re-find" an earlier entry's already-
  claimed occurrence). This module is the single place that pattern
  lives now; format adapters and the cross-format validator both use
  it instead of each re-implementing their own indexOf search.
*/
import { normalizeForParity } from "./parityNormalization";
import type { CanonicalParityEntry } from "./types";

/* Spec section 7: short generic tokens (ON, CA, IT, HR, AI, 2024, ...)
   must never be used alone to decide order - they're only ever tried
   as part of a multi-fragment anchor, never as a lone anchor. */
const SHORT_GENERIC_TOKEN_MAX_LENGTH = 4;

export function isShortGenericToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= SHORT_GENERIC_TOKEN_MAX_LENGTH && /^[A-Za-z0-9]+$/.test(trimmed);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Word-boundary-aware match: only anchors \b on edges that are
   themselves alphanumeric, so fragments starting/ending in punctuation
   (dates like "2019-2021", phone numbers) still match correctly - same
   rationale as Phase 4/5A/5B's own local boundaryPattern helpers. */
function boundaryPattern(fragment: string): RegExp {
  const escaped = escapeRegExp(fragment);
  const startsAlnum = /^[A-Za-z0-9]/.test(fragment);
  const endsAlnum = /[A-Za-z0-9]$/.test(fragment);
  return new RegExp(`${startsAlnum ? "\\b" : ""}${escaped}${endsAlnum ? "\\b" : ""}`);
}

/* Phase 5C.1 - a long single-token fragment (URL, email, etc.) with no
   internal whitespace of its own can legitimately be split across two
   lines by Chromium's real print-to-PDF layout when the whole contact
   line doesn't fit on one line - the extracted native text then
   contains a real space at the wrap point even though the source
   value has none (confirmed via a direct pdfjs TextItem dump: the
   whole token is intact within a single TextItem up to the wrap, then
   continues in the next TextItem on the next line - not a rendering
   or extraction bug, just where the wrap fell). Gated to fragments
   >=20 chars with zero internal whitespace so it can only ever make
   matching MORE permissive about wrap-induced whitespace - it can
   never accept different or missing characters, and it's structurally
   unable to mask a genuinely missing word in ordinary multi-word
   prose (which never qualifies as a "long unbroken token" at all). */
const LONG_UNBROKEN_TOKEN_MIN_LENGTH = 20;

export function isLongUnbrokenToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= LONG_UNBROKEN_TOKEN_MIN_LENGTH && !/\s/.test(trimmed);
}

function whitespaceTolerantPattern(fragment: string, flags = ""): RegExp {
  const chars = [...fragment].map(escapeRegExp);
  return new RegExp(chars.join("\\s*"), flags);
}

/* Existence check used by the cross-format validator's missing-
   fragment and invented-fragment (removal) passes - literal boundary
   match for ordinary fragments, whitespace-tolerant for long unbroken
   tokens per the rationale above. */
export function fragmentSearchPattern(fragment: string, flags = ""): RegExp {
  if (isLongUnbrokenToken(fragment)) return whitespaceTolerantPattern(fragment, flags);
  const base = boundaryPattern(fragment);
  return new RegExp(base.source, flags);
}

/* Find `marker` in `text` starting no earlier than `cursor`. Returns
   -1 if not found. Never searches before `cursor` - this is what makes
   repeated short tokens resolve to their NEXT occurrence instead of
   re-matching an already-claimed earlier one. */
export function advancingIndexOf(text: string, marker: string, cursor: number): number {
  if (!marker) return -1;
  const pattern = boundaryPattern(marker);
  pattern.lastIndex = 0;
  const globalPattern = new RegExp(pattern.source, "g");
  globalPattern.lastIndex = cursor;
  const match = globalPattern.exec(text);
  return match ? match.index : -1;
}

export type OrderedMatchResult = {
  indices: number[];
  allFound: boolean;
  inOrder: boolean;
};

/* Sequential ordered search: each marker is searched starting from
   where the previous SUCCESSFUL match ended (cursor only advances on a
   found match, mirroring docxParityValidator.ts's proven fix). Returns
   per-marker indices (-1 for not-found) plus whether every marker was
   found and whether the found ones are monotonically non-decreasing. */
export function computeOrderedIndices(text: string, markers: string[]): OrderedMatchResult {
  const indices: number[] = [];
  let cursor = 0;
  let lastFound = -1;
  let inOrder = true;
  for (const marker of markers) {
    const normalizedMarker = normalizeForParity(marker);
    const index = normalizedMarker ? advancingIndexOf(text, normalizedMarker, cursor) : -1;
    indices.push(index);
    if (index >= 0) {
      if (index < lastFound) inOrder = false;
      lastFound = index;
      cursor = index + normalizedMarker.length;
    }
  }
  const allFound = indices.every((i) => i >= 0);
  return { indices, allFound, inOrder };
}

/* Tiered anchor candidates for one entry, in priority order (spec
   section 7): [organization+role+date] > [organization+role] >
   [role+date] > [longest single fragment]. sourceEntryId-based
   identification (tier "4" in the spec) is handled by format adapters
   directly from their own structural mapping (sourceMapping/
   sourcePagePlan/DOM markers) - not a text search, so it has no
   representation here. Each tier is an ordered list of sub-fragments
   that must ALL be found in sequence for that tier to count; tiers
   that reference an absent field are skipped entirely (not attempted
   with an empty string). */
export function selectEntryAnchorTiers(entry: CanonicalParityEntry): string[][] {
  const tiers: string[][] = [];
  const { organization, role, date } = entry;

  if (organization && role && date) tiers.push([organization, role, date]);
  if (organization && role) tiers.push([organization, role]);
  if (role && date) tiers.push([role, date]);

  const longestFragment = [...entry.paragraphs, ...entry.bullets].filter((f) => !isShortGenericToken(f)).sort((a, b) => b.length - a.length)[0];
  if (longestFragment) tiers.push([longestFragment]);

  return tiers;
}

export type EntryAnchorMatch = {
  found: boolean;
  startIndex: number;
  endIndex: number;
  tierUsed: number;
};

/* Tries each tier in priority order; the first tier whose every
   sub-fragment is found, in order, starting at-or-after `cursor` wins.
   Returns the anchor's own start (for ordering) and end (for advancing
   a caller's own cursor past this entry). */
export function findEntryAnchor(text: string, entry: CanonicalParityEntry, cursor: number): EntryAnchorMatch {
  const tiers = selectEntryAnchorTiers(entry);
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const result = computeOrderedIndices(text, tiers[tierIndex]);
    if (result.allFound && result.inOrder) {
      const firstIndex = result.indices[0];
      const lastMarker = normalizeForParity(tiers[tierIndex][tiers[tierIndex].length - 1]);
      const lastIndex = result.indices[result.indices.length - 1] + lastMarker.length;
      return { found: true, startIndex: firstIndex, endIndex: lastIndex, tierUsed: tierIndex };
    }
  }
  return { found: false, startIndex: -1, endIndex: -1, tierUsed: -1 };
}

/* Ordered anchor search across all of a section's entries, advancing
   the cursor only past a successfully-found entry - the same pattern
   as findEntryAnchor but for a whole ordered list of entries, used to
   determine entry order within one section from a format's own native
   text. */
export function computeEntryOrderFromText(text: string, entries: CanonicalParityEntry[]): { entryId: string; anchor: EntryAnchorMatch }[] {
  const results: { entryId: string; anchor: EntryAnchorMatch }[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const anchor = findEntryAnchor(text, entry, cursor);
    if (anchor.found) cursor = anchor.endIndex;
    results.push({ entryId: entry.entryId, anchor });
  }
  return results;
}
