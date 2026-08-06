/*
  TASK 3 - Skills extraction. Section 8 of the spec. Handles, in
  priority order per block:

  1. Table/level-row shape - verified against a real fixture
     (lossless-synthetic/f6-docx-table-skills.docx): a DOCX table row
     becomes ONE block with cell text space-joined ("Power BI
     Advanced"), so >= 2 blocks each ending in a known level word are
     treated as one ungrouped skill list with the level word stripped.
     A non-matching header row ("Skill Level") is simply not extracted
     as a skill but its block still counts toward the group's source
     trace (block coverage is at the group level, not per-skill-string).
  2. Category label lines ("Technical Skills: Excel, SQL, Power BI") -
     verified against spec section 8's own example.
  3. Plain delimiter-separated lines (comma-separated: regtest4,
     lossless-synthetic/f4; bullet-separated: each bullet block is its
     own skill unless it itself contains a comma list).

  Never splits a full sentence into words - a block ending in
  terminal punctuation (. ! ?) is treated as prose, not a skill list,
  and is left un-extracted (its text is still preserved via the
  section's own rawText / Phase 1 data - this extractor only chooses
  not to mine skills out of it, which is a strictly safe direction per
  spec section 8's "구두점인 경우 무조건 skill로 분리하지 않는다").
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlocks } from "./sourceTrace";
import { tokenizeSkillList } from "./skillTokenizer";
import type { SkillGroup } from "./types";

const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;
const CATEGORY_LABEL_RE = /^([A-Za-z][A-Za-z0-9\s/&+-]{1,40}):\s*(.+)$/;
const KNOWN_LEVEL_WORDS = [
  "beginner",
  "basic",
  "intermediate",
  "advanced",
  "proficient",
  "expert",
  "fluent",
  "native",
  "conversational",
];
const LEVEL_SUFFIX_RE = new RegExp(`\\s+(${KNOWN_LEVEL_WORDS.join("|")})$`, "i");
const SENTENCE_END_RE = /[.!?]$/;

function stripBullet(text: string): string {
  return text.replace(BULLET_PREFIX_RE, "").trim();
}

function isSentence(text: string): boolean {
  return SENTENCE_END_RE.test(text.trim());
}

function splitSkillList(text: string): string[] {
  return tokenizeSkillList(text).tokens.map((t) => t.text);
}

/* Terminal-looking punctuation a genuinely complete skill list line
   normally ends with - a block ending in one of these is never a
   PDF line-wrap continuation candidate. */
const LIST_TERMINAL_RE = /[,;:.)]$/;

/*
  Phase 5D.6D D1.3 / Phase 5D.6E TASK B - PDF narrow-column line-wrap
  detection. A single skill list can legitimately span two adjacent
  Phase 1 blocks (each block is already one physical PDF line - see
  blockAdapter.ts's groupIntoLines) when a line runs out of column
  width mid-list - e.g. "...Microsoft Word, Excel & Google" wraps to
  "Sheets • Email &..." on the next line. Naively treating every block
  boundary as a hard skill separator then reproduces exactly that split
  (see this file's own gate test, and the round's own real 10-resume
  UAT, which is what actually caught this).

  Phase 5D.6D's fix (terminal punctuation + tight vertical spacing
  only, no width-ratio guard) over-corrected: it also merges two
  genuinely INDEPENDENT adjacent lines whenever they're vertically
  close and the first has no trailing punctuation - real bug, found via
  the round's own 10-resume UAT on r08's Board & Leadership Activities
  section, where "Board Director" (a role title) and "BC Manufacturing
  Association - 2021 - Present" (an unrelated org+date line directly
  below it, same vertical rhythm as any other bullet-adjacent line)
  fused into one bogus "skill".

  classifyWrappedContinuation replaces a single width-ratio guard with
  multiple independent structural signals - no product/company-name
  dictionary, no per-string special case. A genuine continuation has to
  show a POSITIVE signal that prev is already mid-list (contains a
  comma or an unresolved trailing conjunction - i.e. the exact shape a
  tokenizeSkillList-recognized list uses); a genuine new, unrelated
  entry shows its own POSITIVE signal instead (next carries a date-
  range shape, or prev itself is already a short, clean, Title Case
  phrase with no internal delimiter - "Board Director" is exactly
  that: complete-looking on its own, nothing dangling). Either
  "separate" signal overrides any "merge" signal - the two Board/
  Association-shaped cases in the round's own false-continuation list
  ("skill + institution", "title + location", "credential + issuer")
  all reduce to the same "next line has a date, or prev already reads
  as a finished short title" pattern, so this stays generic rather than
  chasing each shape individually.

  Uncertain (neither signal fires) defaults to "separate" - false
  merges are wrong data (two real facts fused into one), false splits
  merely lose a compound-phrase join that D1's tokenizer already
  guards against reintroducing; the round explicitly prioritizes
  eliminating false merges this round, so ties break toward separate.
*/
const DATE_RANGE_SHAPE_RE = /\b(19|20)\d{2}\b\s*[-–—]\s*(\b(19|20)\d{2}\b|present|current)\b|\b(19|20)\d{2}\b\s*[-–—]\s*$/i;
const TITLE_CASE_CONNECTOR_WORDS = new Set(["of", "the", "for", "and", "in", "on", "at", "to", "a", "an", "&"]);

function looksLikeCleanShortTitlePhrase(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 4) return false;
  if (/[,;:/&]/.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  // A phrase that itself dangles on a trailing connector ("Research
  // and") is never "complete" by construction - a real job/role title
  // never ends on a bare conjunction, so this can't be conflated with
  // a genuinely finished short title even though "and" is otherwise an
  // allowed connector word mid-phrase (e.g. "Director of Operations").
  if (/\b(and|or)\s*$/i.test(text)) return false;
  return words.every((w) => TITLE_CASE_CONNECTOR_WORDS.has(w.toLowerCase()) || /^[A-Z]/.test(w));
}

function hasDanglingListSignal(text: string): boolean {
  if (text.includes(",")) return true;
  return /(&|\band\b)\s*$/i.test(text) || /\b(&|and)\s+[A-Z][a-z]*$/.test(text);
}

export type WrappedContinuationDecision = "merge" | "separate" | "uncertain";
export type WrappedContinuationResult = { decision: WrappedContinuationDecision; confidence: number; reasonCodes: string[] };

export function classifyWrappedContinuation(prev: SemanticContentBlock, next: SemanticContentBlock): WrappedContinuationResult {
  if (prev.blockType === "bullet" || next.blockType === "bullet") {
    return { decision: "separate", confidence: 0.95, reasonCodes: ["bullet-block-excluded"] };
  }
  const prevText = stripBullet(prev.text);
  const nextText = stripBullet(next.text);
  if (prevText.length === 0 || LIST_TERMINAL_RE.test(prevText)) {
    return { decision: "separate", confidence: 0.9, reasonCodes: ["prev-terminal-punctuation-or-empty"] };
  }
  if (!prev.bbox || !next.bbox) {
    return { decision: "separate", confidence: 0.7, reasonCodes: ["missing-bbox-geometry"] };
  }

  const lineHeight = prev.bbox.height || next.bbox.height || 0;
  if (lineHeight <= 0) return { decision: "separate", confidence: 0.7, reasonCodes: ["invalid-line-height"] };
  const verticalGap = next.bbox.y - (prev.bbox.y + prev.bbox.height);
  const tightVerticalGap = verticalGap >= -lineHeight * 0.5 && verticalGap <= lineHeight * 0.75;
  if (!tightVerticalGap) {
    return { decision: "separate", confidence: 0.85, reasonCodes: ["vertical-gap-out-of-range"] };
  }

  const separateReasons: string[] = [];
  if (DATE_RANGE_SHAPE_RE.test(nextText)) separateReasons.push("next-has-date-range-shape");
  if (looksLikeCleanShortTitlePhrase(prevText)) separateReasons.push("prev-is-clean-short-title-phrase");
  if (separateReasons.length > 0) {
    return { decision: "separate", confidence: 0.85, reasonCodes: separateReasons };
  }

  const mergeReasons: string[] = [];
  if (hasDanglingListSignal(prevText)) mergeReasons.push("prev-already-list-like");
  if (mergeReasons.length > 0) {
    return { decision: "merge", confidence: 0.75, reasonCodes: mergeReasons };
  }

  return { decision: "separate", confidence: 0.5, reasonCodes: ["uncertain-defaults-to-separate"] };
}

export function extractSkillGroups(sectionId: string, bodyBlocks: SemanticContentBlock[]): SkillGroup[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading" && b.rawText.length > 0);
  if (relevant.length === 0) return [];

  // --- 1. Table/level-row shape ---
  const levelMatches = relevant.filter((b) => LEVEL_SUFFIX_RE.test(stripBullet(b.text)));
  if (levelMatches.length >= 2) {
    const skills = levelMatches.map((b) => stripBullet(b.text).replace(LEVEL_SUFFIX_RE, "").trim()).filter((s) => s.length > 0);
    return [
      {
        skills,
        source: traceFromBlocks(sectionId, relevant),
      },
    ];
  }

  // --- 2. Category label lines + 3. plain delimiter lines ---
  const groups: SkillGroup[] = [];
  const ungroupedSkills: string[] = [];
  const ungroupedBlocks: SemanticContentBlock[] = [];

  let pendingRunText = "";
  let pendingRunBlocks: SemanticContentBlock[] = [];

  function flushPendingRun() {
    if (pendingRunBlocks.length === 0) return;
    // A prose/sentence run contributes no skill VALUE (per the "never
    // split a sentence into skills" rule above) but its block ids must
    // still be traced somewhere - real fixture evidence (bench/resume-
    // E-senior-ats.pdf) showed a "Skills"-typed section whose tail also
    // contains prose bullet fragments (Phase 1's own section boundary,
    // not corrected this round); dropping those blocks from coverage
    // entirely violated the "never silently drop a block" invariant
    // even though correctly extracting zero skills from them.
    if (!isSentence(pendingRunText)) {
      ungroupedSkills.push(...splitSkillList(pendingRunText));
    }
    ungroupedBlocks.push(...pendingRunBlocks);
    pendingRunText = "";
    pendingRunBlocks = [];
  }

  for (const block of relevant) {
    const text = stripBullet(block.text);
    if (text.length === 0) continue;

    const labelMatch = text.match(CATEGORY_LABEL_RE);
    if (labelMatch) {
      const [, label, listPart] = labelMatch;
      if (!isSentence(listPart)) {
        flushPendingRun();
        groups.push({
          label: label.trim(),
          skills: splitSkillList(listPart),
          source: traceFromBlocks(sectionId, [block]),
        });
        continue;
      }
    }

    const prevRunBlock = pendingRunBlocks[pendingRunBlocks.length - 1];
    if (prevRunBlock && classifyWrappedContinuation(prevRunBlock, block).decision === "merge") {
      // A genuine PDF line-wrap continuation of the SAME skill list line
      // (see classifyWrappedContinuation's own comment) - join into the
      // pending run's text instead of tokenizing this block on its own,
      // so a word split across two lines (e.g. "...Google" / "Sheets")
      // is tokenized once as one continuous line, never as two
      // independent list entries.
      pendingRunText = `${pendingRunText} ${text}`.trim();
      pendingRunBlocks.push(block);
      continue;
    }

    flushPendingRun();
    pendingRunText = text;
    pendingRunBlocks = [block];
  }
  flushPendingRun();

  if (ungroupedBlocks.length > 0) {
    groups.push({
      skills: ungroupedSkills,
      source: traceFromBlocks(sectionId, ungroupedBlocks),
    });
  }

  return groups;
}
