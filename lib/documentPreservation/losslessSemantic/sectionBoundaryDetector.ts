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

  return candidates;
}

export type SectionBoundary = {
  headingBlockIndex: number | null;
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

  const identityBlockIndices: number[] = [];
  for (let i = 0; i < sortedCandidates[0].blockIndex; i++) identityBlockIndices.push(i);

  const sections: SectionBoundary[] = sortedCandidates.map((candidate, i) => {
    const nextCandidateIndex = sortedCandidates[i + 1]?.blockIndex ?? blocks.length;
    return {
      headingBlockIndex: candidate.blockIndex,
      headingText: blocks[candidate.blockIndex].rawText,
      startBlockIndex: candidate.blockIndex,
      endBlockIndex: nextCandidateIndex - 1,
      reasonCodes: candidate.reasonCodes,
    };
  });

  return { identityBlockIndices, sections };
}
