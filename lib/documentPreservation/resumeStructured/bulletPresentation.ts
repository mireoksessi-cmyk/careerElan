/*
  Phase 5D.6 TASK B - Generic Bullet Marker Ownership Hardening. Real
  bug: every extractor that builds a bullet's/content-block's DISPLAY
  text (StructuredBullet.text, EntryContentBlock.text) used
  block.rawText verbatim. rawText is Phase 1's byte-invariant field
  (must stay exactly what the source contained, for the Lossless
  validator's own text-preservation check) and Phase 1 deliberately
  never strips a leading bullet glyph from it - it only CLASSIFIES the
  block as blockType:"bullet" when losslessSemantic/blockAdapter.ts's
  own BULLET_PREFIX_RE matches (see that file). Every renderer (HTML
  <ul>/<li>, DOCX's real `bullet: {level: 0}` Word numbering - see
  professionalAtsDocx/docxRenderer.ts's own header comment) then adds
  ITS OWN visual marker on top of that still-glyph-prefixed text,
  producing "• •" in both formats simultaneously (confirmed: neither
  renderer needs a code change, since both consume the same text this
  module now corrects upstream).

  This module owns exactly one decision, made ONCE per content block,
  reused by every extractor that builds bullets[]/content[]:
  displayText is bullet-marker-free text that is safe to hand a
  renderer which will supply its OWN marker glyph. rawText/sourceText
  (and therefore the Lossless validator's text-preservation check,
  which never reads displayText) is completely untouched - this module
  reads block.rawText, never writes it.

  markerKind classification uses ONLY block.blockType (an existing,
  already-computed, already-tested Phase 1 signal - not a new semantic
  guess) as the primary disambiguator between "this IS the source's own
  decorative bullet glyph, already accounted for by blockType:'bullet'"
  and "this is a numbered/lettered line Phase 1 did NOT classify as a
  bullet at all" (Phase 1's BULLET_PREFIX_RE is glyph-only, never
  matches digits/letters - see blockAdapter.ts). A numbered/lettered
  line on a non-bullet block is exactly the round's own named case
  ("1) xEV Battery Development Leadership" as a meaningful subheading
  inside a long-tenure entry, Phase 5D.5 UAT finding) - the safe
  default is to NEVER strip its number (semantic-numbered-heading),
  since losing that number is a genuine, disclosed regression risk this
  round explicitly forbids ("절대 허용하지 않을 출력: ... broken parenthetical").
*/

export type BulletMarkerKind = "unordered" | "ordered" | "checkbox" | "semantic-numbered-heading" | "none";

export type NormalizedBulletPresentation = {
  /* Marker-free (for unordered/ordered/checkbox) or unchanged (for
     semantic-numbered-heading/none) text, safe to hand directly to a
     renderer that supplies its own visual marker. */
  displayText: string;
  markerKind: BulletMarkerKind;
  /* The literal marker text that was recognized, trimmed - undefined
     when markerKind is "none". */
  originalMarker?: string;
  /* Echo of the input, for callers that want both without re-reading
     block.rawText themselves. */
  sourceText: string;
};

/* Every decorative bullet glyph this module recognizes as a candidate
   marker - a superset of losslessSemantic/blockAdapter.ts's own
   BULLET_PREFIX_RE (•\-*◦▪·‣⁃) plus the additional shapes this round's
   spec explicitly lists (●○■□). Deliberately excludes em/en dash and
   ASCII hyphen from THIS regex - those are handled by DASH_MARKER_RE
   below only when the line is a genuine dash-led bullet, never when a
   dash merely starts a date range or a compound word (see
   experienceExtractor.ts's own dateRangeParsing.ts, unaffected by this
   module - this module only ever runs on blockType:"bullet" content,
   never on date/header lines). */
const DECORATIVE_GLYPH_RE = /^[•●○◦▪■□‣⁃·*]\s+/;
const DASH_MARKER_RE = /^[-–—]\s+/;
const CHECKBOX_RE = /^(\[\s?\]|\[[xX]\]|☐|☑)\s+/;
const NUMBERED_MARKER_RE = /^\(?(\d+)[.)]\s+/;
const LETTERED_MARKER_RE = /^\(?([a-zA-Z])[.)]\s+/;

/* Accepts any of Phase 1's SemanticBlockType values (not re-imported
   here to avoid a cross-module type dependency this file doesn't
   otherwise need) - only blockType === "bullet" changes behavior;
   every other value ("paragraph", "heading", "entry-header",
   "metadata", "unknown") is treated identically (non-bullet), since
   the sole question this function answers is "did Phase 1 already
   account for a decorative marker on this exact block via its own
   blockType:'bullet' classification, or not". */
export function normalizeBulletPresentation(text: string, context: { blockType: string }): NormalizedBulletPresentation {
  const sourceText = text;

  // Checkbox markers are always decorative regardless of Phase 1's
  // blockType classification (Phase 1's BULLET_PREFIX_RE does not
  // recognize "[ ]"/"[x]"/checkbox glyphs at all, so these arrive as
  // blockType:"paragraph" today - still safe to strip: a checkbox
  // glyph is never meaningful heading text).
  const checkboxMatch = sourceText.match(CHECKBOX_RE);
  if (checkboxMatch) {
    return { displayText: sourceText.slice(checkboxMatch[0].length), markerKind: "checkbox", originalMarker: checkboxMatch[0].trim(), sourceText };
  }

  if (context.blockType === "bullet") {
    // Phase 1 already decided this line IS the source's own decorative
    // bullet (glyph-only match) - de-duplicate exactly once here.
    const decorativeMatch = sourceText.match(DECORATIVE_GLYPH_RE) ?? sourceText.match(DASH_MARKER_RE);
    if (decorativeMatch) {
      return { displayText: sourceText.slice(decorativeMatch[0].length), markerKind: "unordered", originalMarker: decorativeMatch[0].trim(), sourceText };
    }
    // Defensive only (not reachable against the current BULLET_PREFIX_RE,
    // kept for forward-compat if that set ever grows to include digits):
    // a bullet-classified line led by a number/letter is a genuine
    // ordered-list item, not a subheading - still safe to strip since
    // Phase 1 already committed to "this is a bullet".
    const numberedMatch = sourceText.match(NUMBERED_MARKER_RE) ?? sourceText.match(LETTERED_MARKER_RE);
    if (numberedMatch) {
      return { displayText: sourceText.slice(numberedMatch[0].length), markerKind: "ordered", originalMarker: numberedMatch[0].trim(), sourceText };
    }
    // blockType said bullet but no marker shape here matched - never
    // invent a strip on a guess, return the text untouched.
    return { displayText: sourceText, markerKind: "none", sourceText };
  }

  // NOT Phase-1-flagged as a bullet. A leading numbered/lettered marker
  // here is the round's own named "semantic numbered subheading" shape
  // ("1) xEV Battery Development Leadership") - the number is real
  // content, not a decorative marker a renderer will re-supply, so it
  // is NEVER stripped; render as an ordinary paragraph/subheading.
  const numberedMatch = sourceText.match(NUMBERED_MARKER_RE);
  if (numberedMatch) {
    return { displayText: sourceText, markerKind: "semantic-numbered-heading", originalMarker: numberedMatch[0].trim(), sourceText };
  }
  const letteredMatch = sourceText.match(LETTERED_MARKER_RE);
  if (letteredMatch) {
    return { displayText: sourceText, markerKind: "semantic-numbered-heading", originalMarker: letteredMatch[0].trim(), sourceText };
  }

  return { displayText: sourceText, markerKind: "none", sourceText };
}
