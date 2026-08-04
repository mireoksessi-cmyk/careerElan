/*
  TASK 3/9 - Text preservation validator. Compares each visible
  AssemblyBlock's own payload text (via textExtraction.ts, the single
  source of truth for "what text SHOULD render") against that SAME
  block's own rendered HTML text content.

  Design note - checks are deliberately SCOPED PER BLOCK, not run
  against the whole document's flattened text. An earlier whole-
  document version of this validator produced false "duplicate text"
  and false "invented text" results on real fixtures: a real resume
  legitimately repeats a city name, employer name, or skill word across
  multiple unrelated fields (e.g. bench/resume-B-junior-canva.pdf
  mentions "Toronto Metropolitan University" once as an education
  institution AND once inside an unrelated volunteer bullet's prose -
  two genuinely different real facts that happen to share a substring,
  not a duplication bug). Checking containment per-block instead of
  globally makes that kind of coincidental cross-block text overlap
  structurally impossible to trigger a false positive, since each
  block's fragments are only ever compared against that same block's
  own isolated rendered text.

  "Invented text" detection: the renderer (renderers.tsx) only ever
  interpolates StructuredTextValue.value strings plus a small fixed set
  of formatting tokens (" · ", ", ", " — ", "GPA: ") - there is no
  free-text generation path. So after removing a block's own expected
  fragments once each from that block's own rendered text, whatever
  remains must reduce to only those known-safe tokens; anything else
  surviving is invented text.

  "Duplicate BLOCK" detection (distinct from duplicate text - see
  above) is a structural DOM check: the same data-block-id must never
  appear more than once across a fully rendered multi-page document -
  see duplicateBlockIds() below, used by htmlValidator.ts once real
  pagination exists (TASK 9).
*/
import type { AssemblyBlock } from "../professionalAtsAssembly/types";
import { extractPayloadFragments } from "./textExtraction";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const SAFE_LEFTOVER_TOKENS = [...new Set(Object.values(PROFESSIONAL_ATS_SECTION_LABELS).filter((l): l is string => l !== null))];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
  \b anchors only where the fragment's OWN edge character is
  alphanumeric - a plain `\b` on every fragment breaks matching for
  anything starting/ending in punctuation (phone numbers like
  "(204) 555-0139", bullet text ending in a period), since \b requires
  a word/non-word transition and punctuation-to-space is a non-word-to-
  non-word transition (no boundary). Anchoring is only needed on
  alphanumeric edges anyway - that's the only case where a short
  fragment (e.g. "ON", a province code) could otherwise match as a
  substring inside an unrelated longer word ("ADDITIONAL", "INFORMATION").
*/
function boundaryPattern(fragment: string): RegExp {
  const escaped = escapeRegExp(fragment);
  const startsAlnum = /^[A-Za-z0-9]/.test(fragment);
  const endsAlnum = /[A-Za-z0-9]$/.test(fragment);
  return new RegExp(`${startsAlnum ? "\\b" : ""}${escaped}${endsAlnum ? "\\b" : ""}`, "g");
}

export type BlockTextPreservationResult = {
  blockId: string;
  missing: string[];
  leftoverAfterRemoval: string;
  inventedSuspected: boolean;
};

export function expectedBlockFragments(block: AssemblyBlock): string[] {
  return extractPayloadFragments(block.kind, block.payload).map(normalize).filter((f) => f.length > 0);
}

export function validateBlockTextPreservation(block: AssemblyBlock, renderedBlockText: string): BlockTextPreservationResult {
  const expected = expectedBlockFragments(block);
  let leftover = normalize(renderedBlockText);
  const missing: string[] = [];

  for (const fragment of expected) {
    if (!boundaryPattern(fragment).test(renderedBlockText)) missing.push(fragment);
  }

  /*
    Leftover removal must consume LONGEST fragments first. A block can
    legitimately contain one fragment that is itself a substring of
    another fragment in the same block (e.g. entry.location "Toronto"
    plus a detail line "Toronto Metropolitan University", or a skill
    "Google Analytics" plus a longer skill sentence that also mentions
    "Google Analytics"). Removing the shorter fragment first (a global
    regex) also strips that same text out of the longer fragment's own
    occurrence, corrupting the leftover computation and producing a
    false "invented text" result. Removing longest-first means the
    longer fragment is consumed whole before any shorter substring
    fragment gets a chance to eat into it.
  */
  const byLengthDesc = [...expected].sort((a, b) => b.length - a.length);
  for (const fragment of byLengthDesc) {
    leftover = leftover.replace(boundaryPattern(fragment), " ");
  }

  for (const safe of SAFE_LEFTOVER_TOKENS) leftover = leftover.split(safe).join(" ");
  leftover = leftover.replace(/[·,\-—:]/g, " ").replace(/\s+/g, " ").trim();

  return { blockId: block.id, missing, leftoverAfterRemoval: leftover, inventedSuspected: leftover.length > 0 };
}

/* Structural (not text-content) duplicate check: the same block should
   never be placed twice across a rendered set of pages. */
export function findDuplicateBlockIds(renderedHtml: string): string[] {
  const counts = new Map<string, number>();
  for (const match of renderedHtml.matchAll(/data-block-id="([^"]+)"/g)) {
    const id = match[1];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}
