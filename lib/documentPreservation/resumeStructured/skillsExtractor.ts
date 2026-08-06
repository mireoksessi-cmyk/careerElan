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
  Phase 5D.6D D1.3 - PDF narrow-column line-wrap detection. A single
  skill list can legitimately span two adjacent Phase 1 blocks (each
  block is already one physical PDF line - see blockAdapter.ts's
  groupIntoLines) when a line runs out of column width mid-list - e.g.
  "...Microsoft Word, Excel & Google" wraps to "Sheets • Email &..." on
  the next line. Naively treating every block boundary as a hard skill
  separator then reproduces exactly that split (see this file's own
  gate test, and the round's own real 10-resume UAT, which is what
  actually caught this).

  Real-world correction: an earlier version of this check additionally
  required the second block's bbox to be MEASURABLY NARROWER than the
  first's, on the assumption a wrap continuation is always a short
  leftover fragment. A real private-resume fixture disproved that
  assumption - a long "•"-delimited skills list can wrap across TWO
  nearly full-width lines (521px then 512px, well within a few percent
  of each other), not a short tail, so that width check silently
  suppressed the exact merge this function exists to perform. Removed;
  the remaining checks (terminal punctuation + tight vertical spacing)
  are the real safety net.

  Two blocks are only ever treated as ONE continued list (never as two
  independent list lines) when ALL of:
    - neither is a bullet block (bullets are already their own items)
    - the earlier block does not end in list-terminal punctuation
      (a block ending "...Excel," or "...Sheets." already reads as
      complete - never a wrap victim)
    - both blocks report real bbox geometry
    - the vertical gap between them is small (consecutive single-line
      spacing, not a paragraph/section gap) - this is what actually
      distinguishes "next line of the same list" from "start of an
      unrelated block below it"
  Any missing signal defaults to NOT merging - never guessing a split
  is real when the geometry is ambiguous or unavailable. Known residual
  trade-off (disclosed in the final report): two genuinely independent
  one-line skill lists stacked with ordinary single-line spacing and no
  terminal punctuation on the first can now also merge - accepted since
  the round's own named failure (a compound skill severed by a real
  line wrap) is the more visible, more harmful defect of the two.
*/
function looksLikeWrappedContinuation(prev: SemanticContentBlock, next: SemanticContentBlock): boolean {
  if (prev.blockType === "bullet" || next.blockType === "bullet") return false;
  const prevText = stripBullet(prev.text);
  if (prevText.length === 0 || LIST_TERMINAL_RE.test(prevText)) return false;
  if (!prev.bbox || !next.bbox) return false;

  const lineHeight = prev.bbox.height || next.bbox.height || 0;
  if (lineHeight <= 0) return false;
  const verticalGap = next.bbox.y - (prev.bbox.y + prev.bbox.height);
  return verticalGap >= -lineHeight * 0.5 && verticalGap <= lineHeight * 0.75;
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
    if (prevRunBlock && looksLikeWrappedContinuation(prevRunBlock, block)) {
      // A genuine PDF line-wrap continuation of the SAME skill list line
      // (see looksLikeWrappedContinuation's own comment) - join into the
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
