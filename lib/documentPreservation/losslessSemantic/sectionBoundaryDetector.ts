/*
  TASK 4 - Section Boundary Detection. Consumes SemanticContentBlock[]
  from blockAdapter.ts (line granularity - see that file's header
  comment for why ContentBox-level granularity was rejected). Produces
  raw boundaries only (which block starts a new section, and the exact
  block-index range it owns) - NOT section type classification. That is
  classifier.ts's job (TASK 5), consuming this file's output.

  Section 5 of the spec: score each heading CANDIDATE from multiple
  independent signals, never confirm on a single condition alone (a
  bold job title, an ALL CAPS company name, and a date-range line must
  all fail to become false-positive headings - see the disqualifying
  DATE_RANGE_HINT_RE check below, and the >=2-signal threshold).
*/
import type { SemanticContentBlock } from "./types";
import { matchAlias } from "./aliasDictionary";
import { normalizeHeadingForMatching } from "./textNormalize";

const MAX_HEADING_TEXT_LENGTH = 40;
const HEADING_SCORE_THRESHOLD = 2;
// Point sizes arrive as floats from the PDF/DOCX layer, so "the same size
// as the section headings" is compared with a hair of slack rather than by
// exact equality - a heading set in the very same size must not be demoted
// by a rounding artefact. Not a size threshold: no point size is assumed.
const FONT_SIZE_MATCH_TOLERANCE = 0.01;

// Same conservative date-range signal blockAdapter.ts documents - a line
// with a 4-digit year (or "present") is treated as very unlikely to be a
// real section heading, even if it happens to be short/bold/capitalized
// (a job title line like "Senior Developer, 2020 - Present" must not be
// mistaken for a heading).
const DATE_RANGE_HINT_RE = /(19|20)\d{2}|\bpresent\b/i;
const ALL_CAPS_RE = /^[A-Z0-9 &/,'-]+$/;
// Title Case: every word starts uppercase, at most 5 words - mirrors the
// same "short phrase" shape real section headings take (matchHeading()
// in lib/brand/sectionParser.ts imposes the same <=40-char / short-line
// assumption for the same reason).
const TITLE_CASE_RE = /^([A-Z][a-zA-Z]*\s*){1,5}$/;

function isBoldWeight(weight: string | number | undefined): boolean {
  if (weight === undefined) return false;
  if (typeof weight === "number") return weight >= 600;
  const numeric = Number(weight);
  if (!Number.isNaN(numeric)) return numeric >= 600;
  return /bold|semibold|black|heavy/i.test(String(weight));
}

function medianBodyFontSize(blocks: SemanticContentBlock[]): number | null {
  const sizes = blocks
    .filter((b) => b.blockType === "paragraph" || b.blockType === "bullet")
    .map((b) => b.style?.fontSize)
    .filter((s): s is number => typeof s === "number");
  if (sizes.length === 0) return null;
  const sorted = [...sizes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/*
  A "vertical spacing before" signal (median-line-gap baseline, flagging
  candidates with an outsized gap above them) was implemented and tested
  here, then REVERTED - real-fixture testing (TASK 7's dev inspection UI
  against bench/resume-E-senior-ats.pdf) showed it correctly caught one
  genuine custom heading ("Board & Leadership Activities") but ALSO
  false-triggered on ordinary entry-header spacing within
  "Professional Experience" itself (e.g. "Vice President of Operations",
  "Board Director"), fragmenting a real, correctly-classified section
  into several wrong custom ones - a strictly worse failure than the one
  it fixed. Per this round's own priority (never force a wrong split;
  absorbing an unknown heading as body text of the wrong section is a
  soft, no-data-loss failure, while shattering a real section is not),
  the signal was removed rather than tuned blindly. See the final
  report's "Files Added/Modified" / known-limitations section - this is
  a disclosed limitation, not a silent gap.
*/

export type HeadingCandidate = {
  blockIndex: number;
  score: number;
  reasonCodes: string[];
};

/*
  Scores every block in FLAT DOCUMENT ORDER (the same order blockAdapter
  already produced - page, then line sourceOrder - never re-sorted
  here). Only "paragraph" and "entry-header"-shaped lines are even
  considered; "bullet"/"unknown" blocks can never become heading
  candidates (a bullet glyph or an empty/non-text block is never a
  section title).
*/
export function scoreHeadingCandidates(blocks: SemanticContentBlock[]): HeadingCandidate[] {
  const bodyFontSize = medianBodyFontSize(blocks);
  const candidates: HeadingCandidate[] = [];

  blocks.forEach((block, index) => {
    if (block.blockType === "bullet" || block.blockType === "unknown") return;
    const text = block.text;
    if (text.length === 0) return;

    const reasonCodes: string[] = [];
    let score = 0;

    const aliasHit = matchAlias(normalizeHeadingForMatching(text)) !== null;
    if (aliasHit) {
      score += 3;
      reasonCodes.push("known-heading-alias");
    }

    if (text.length <= MAX_HEADING_TEXT_LENGTH) {
      score += 1;
      reasonCodes.push("short-text-length");
    }

    if (ALL_CAPS_RE.test(text) && /[A-Z]/.test(text)) {
      score += 1;
      reasonCodes.push("all-caps");
    } else if (TITLE_CASE_RE.test(text)) {
      score += 1;
      reasonCodes.push("title-case-short-phrase");
    }

    if (bodyFontSize !== null && block.style?.fontSize && block.style.fontSize > bodyFontSize * 1.05) {
      score += 1;
      reasonCodes.push("larger-than-body-font-size");
    }

    if (isBoldWeight(block.style?.fontWeight)) {
      score += 1;
      reasonCodes.push("bold-weight");
    }

    // Disqualifying signal - checked LAST so it can veto an otherwise
    // high score (e.g. a bold, short, title-case "Senior Developer,
    // 2020 - Present" entry-header line) rather than just failing to
    // add points.
    if (DATE_RANGE_HINT_RE.test(text) && !aliasHit) {
      score -= 3;
      reasonCodes.push("date-range-disqualifier");
    }

    // Confirmation gate - verified against a real fixture
    // (standard-pdf-resume.pdf): its real section headings ("Summary",
    // "Experience", ...) sit at a measurably larger font size than body
    // text (~13.0 vs ~12.0), while entry-header job-title lines like
    // "Operations Analyst" share the EXACT body font size (PDF carries
    // no fontWeight here - a known pdfjs-dist limitation, see
    // layoutAnalysis/types.ts). "short-text-length" + "title-case" are
    // shape-only signals that a plain job title satisfies just as
    // easily as a real heading - stacking two shape-only signals must
    // never be enough on its own (this is exactly the "not bold-alone,
    // not ALL-CAPS-alone" principle from spec section 5, extended to
    // shape signals). A candidate is confirmed only via a known-alias
    // lexical match, or a genuine typographic break from body text
    // (larger font size or bold weight) - never from shape alone. (A
    // vertical-spacing-before signal was also tried and reverted - see
    // this file's earlier header comment for the real-fixture evidence
    // of why it caused a worse regression than it fixed.)
    const hasStructuralSignal = reasonCodes.includes("larger-than-body-font-size") || reasonCodes.includes("bold-weight");
    if (score >= HEADING_SCORE_THRESHOLD && (aliasHit || hasStructuralSignal)) {
      candidates.push({ blockIndex: index, score, reasonCodes });
    }
  });

  /*
    "Larger than body text" is one signal covering two different things.
    A resume sets its section titles at one size and the entry titles
    inside them - the job title above a company and a date, the degree
    above a school - at another, smaller one; both clear the body-text
    comparison above, so both were being confirmed and every entry title
    started a top-level section of its own, shattering the very section
    it belonged to.

    What separates them is not wording but typography, and the document
    states its own convention: the headings a known alias already
    confirmed ARE its section tier. So the smallest of those sets a
    floor, and a candidate with no alias has to reach it to be read as a
    section rather than as an entry inside one. Nothing is assumed about
    what a resume looks like - no point size, no title vocabulary - and
    the evidence is only the document's own.

    Alias-confirmed candidates are never demoted; the floor is derived
    from them, so it can never exclude them. A candidate that carries no
    font size at all is left alone rather than judged on evidence it
    doesn't have. And a document where no alias matched anything states
    no convention to measure against, so nothing is filtered and the
    behaviour above stands unchanged - which is what keeps heading-less
    and wholly-custom resumes working exactly as before.

    The floor only applies from the first alias heading onward. Above it
    sits the header - the name, the line naming the person's profession,
    the contact details - and there a line smaller than the section
    titles is ordinary, not an entry inside anything: there is no
    section open yet for it to be an entry of. Real resumes set that
    professional-title line below their section titles routinely, and
    measuring it against them deleted a leading block that
    buildStructuredResume's identity window is already responsible for
    reading. So before the first alias heading the scoring above stands
    on its own, and identity keeps its own owner.

    Deliberately no lookahead and no notion of which section is
    currently open: an earlier attempt to read structure from vertical
    spacing is described at the top of this file, and it fragmented real
    sections. One document-local measurement and one position are
    enough.
  */
  const aliasHeadings = candidates.filter((candidate) => candidate.reasonCodes.includes("known-heading-alias"));
  const aliasHeadingFontSizes = aliasHeadings
    .map((candidate) => blocks[candidate.blockIndex].style?.fontSize)
    .filter((fontSize): fontSize is number => typeof fontSize === "number");
  if (aliasHeadingFontSizes.length === 0) return candidates;
  const aliasHeadingFontFloor = Math.min(...aliasHeadingFontSizes);
  const firstAliasHeadingIndex = Math.min(...aliasHeadings.map((candidate) => candidate.blockIndex));

  return candidates.filter((candidate) => {
    if (candidate.reasonCodes.includes("known-heading-alias")) return true;
    if (candidate.blockIndex < firstAliasHeadingIndex) return true;
    const fontSize = blocks[candidate.blockIndex].style?.fontSize;
    if (typeof fontSize !== "number") return true;
    return fontSize >= aliasHeadingFontFloor - FONT_SIZE_MATCH_TOLERANCE;
  });
}

export type SectionBoundary = {
  headingBlockIndex: number | null;
  /* Every block that contributed a line to this heading, in source order.
     A heading that wrapped across the rail has more than one, and the
     continuation lines are only identifiable structurally - the caller
     cannot recover them from headingBlockIndex alone. Optional so a
     boundary built without it keeps its previous single-block meaning. */
  headingBlockIndices?: number[];
  headingText: string | null;
  startBlockIndex: number;
  endBlockIndex: number;
  reasonCodes: string[];
};

export type BoundaryDetectionResult = {
  identityBlockIndices: number[];
  sections: SectionBoundary[];
};

/*
  No-heading fallback (section 16 of the spec): if zero heading
  candidates were found anywhere in the document, the ENTIRE block
  sequence becomes exactly one custom section with headingText=null,
  rather than guessing a boundary that isn't there. This is the
  "무제목 콘텐츠 보존" requirement - nothing gets silently dropped just
  because the document has no detectable section titles.
*/
/*
  A section heading set in a narrow left rail wraps across several visual
  lines ("PROFESSIONAL" / "SUMMARY"), and every line scores as its own
  heading candidate above, so each one would open its own section. The
  body column's text is interleaved between those lines in reading order,
  so block adjacency cannot decide continuity - what matters is whether
  the next candidate continues the SAME rail directly beneath the previous
  one.

  Geometry only: no text, alias or dictionary evidence is consulted, so an
  unknown or localized heading groups exactly like a known one. The
  measured separation is wide - real wrapped lines sit at a gap of at most
  0.321x their own font size, while the nearest genuine non-heading pair
  (a heading followed by a metric) sits at 0.561x and a heading followed
  by a job title at 0.921x. Anything unmeasurable, non-finite, negative or
  outside these bounds is left separate.
*/
const RAIL_X_TOLERANCE = 0.5;
const RAIL_GAP_TO_FONT_SIZE_RATIO = 0.4;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function continuesRailHeading(
  blocks: SemanticContentBlock[],
  previousIndex: number,
  nextIndex: number
): boolean {
  const previous = blocks[previousIndex];
  const next = blocks[nextIndex];
  if (!previous || !next) return false;
  if (previous.pageIndex !== next.pageIndex) return false;

  const previousBox = previous.bbox;
  const nextBox = next.bbox;
  if (!previousBox || !nextBox) return false;
  if (!isFiniteNumber(previousBox.x) || !isFiniteNumber(previousBox.y) || !isFiniteNumber(previousBox.height)) return false;
  if (!isFiniteNumber(nextBox.x) || !isFiniteNumber(nextBox.y)) return false;

  const previousFontSize = previous.style?.fontSize;
  const nextFontSize = next.style?.fontSize;
  if (!isFiniteNumber(previousFontSize) || !isFiniteNumber(nextFontSize)) return false;
  if (previousFontSize <= 0) return false;
  if (previousFontSize !== nextFontSize) return false;

  if (Math.abs(nextBox.x - previousBox.x) > RAIL_X_TOLERANCE) return false;

  const gap = nextBox.y - (previousBox.y + previousBox.height);
  if (!isFiniteNumber(gap) || gap < 0) return false;
  return gap / previousFontSize <= RAIL_GAP_TO_FONT_SIZE_RATIO;
}

/*
  Groups already-scored candidates into runs, where a run of more than one
  entry is a single heading that wrapped. Never creates a candidate, never
  drops one: every candidate belongs to exactly one run, in the same order.
*/
function groupRailHeadingRuns(
  blocks: SemanticContentBlock[],
  sortedCandidates: HeadingCandidate[]
): HeadingCandidate[][] {
  const runs: HeadingCandidate[][] = [];
  let current: HeadingCandidate[] = [sortedCandidates[0]];

  for (let i = 1; i < sortedCandidates.length; i++) {
    const previous = current[current.length - 1];
    const candidate = sortedCandidates[i];
    if (continuesRailHeading(blocks, previous.blockIndex, candidate.blockIndex)) {
      current.push(candidate);
    } else {
      runs.push(current);
      current = [candidate];
    }
  }

  runs.push(current);
  return runs;
}

export function detectSectionBoundaries(blocks: SemanticContentBlock[]): BoundaryDetectionResult {
  if (blocks.length === 0) {
    return { identityBlockIndices: [], sections: [] };
  }

  const candidates = scoreHeadingCandidates(blocks);

  if (candidates.length === 0) {
    return {
      identityBlockIndices: [],
      sections: [
        {
          headingBlockIndex: null,
          headingText: null,
          startBlockIndex: 0,
          endBlockIndex: blocks.length - 1,
          reasonCodes: ["no-heading-candidates-found-whole-document-fallback"],
        },
      ],
    };
  }

  const sortedCandidates = [...candidates].sort((a, b) => a.blockIndex - b.blockIndex);
  const runs = groupRailHeadingRuns(blocks, sortedCandidates);

  const identityBlockIndices: number[] = [];
  for (let i = 0; i < sortedCandidates[0].blockIndex; i++) identityBlockIndices.push(i);

  const sections: SectionBoundary[] = runs.map((run, i) => {
    const candidate = run[0];
    const nextCandidateIndex = runs[i + 1]?.[0].blockIndex ?? blocks.length;
    // A run of one keeps the exact previous text; a wrapped run joins its
    // lines with single spaces and nothing else. The continuation lines
    // stay inside this section's own block range, so no source block is
    // dropped and none changes owner.
    const headingText =
      run.length === 1
        ? blocks[candidate.blockIndex].rawText
        : run
            .map((line) => blocks[line.blockIndex].rawText.trim())
            .filter((text) => text.length > 0)
            .join(" ");
    return {
      headingBlockIndex: candidate.blockIndex,
      headingBlockIndices: run.map((line) => line.blockIndex),
      headingText,
      startBlockIndex: candidate.blockIndex,
      endBlockIndex: nextCandidateIndex - 1,
      reasonCodes:
        run.length === 1
          ? candidate.reasonCodes
          : [...candidate.reasonCodes, `rail-heading-run-${run.length}-lines`],
    };
  });

  return { identityBlockIndices, sections };
}
