/*
  Document Preservation Engine (DPE) - Phase 4B (Execution Engine).
  Experience Group Refinement - Experience Box -> Job Entry -> Title ->
  Company -> Bullet Group -> Individual Bullet, using ONLY data Phase 2/3
  already produced. No new PDF/DOCX parser, no OCR, no new Layout
  Analyzer (per this phase's explicit prohibition).

  PDF and DOCX are refined by two DIFFERENT strategies, per this phase's
  own "PDF와 DOCX를 동일한 방식으로 처리하려고 하지 않는다" - because
  their Phase 3 Content Boxes are structurally different (confirmed in
  Phase 3's own report): PDF's geometry clustering can merge an entire
  multi-job Experience section into one box; DOCX's 1:1 element mapping
  never merges anything (each title/company/bullet line is already its
  own box).
*/
import { parseExperienceEntries, extractDateRange, looksLikeBulletLine } from "@/lib/brand/experienceParser";
import type { ElementMetadata } from "../layoutAnalysis/types";
import type { ContentBox } from "../contentBox/types";
import type { ExperienceRefinementResult, RefinedBulletGroup, RefinedJobEntry } from "./types";

function looksLikeBulletText(text: string | null): boolean {
  return looksLikeBulletLine(text ?? "");
}

/*
  ===== DOCX strategy =====
  Existing role ("experience") + existing bullet marker + existing text
  order (all explicitly allowed signals) group the ALREADY-GRANULAR 1:1
  boxes into entries: a run of non-bullet boxes (title, then company)
  followed by a run of bullet boxes is one Job Entry; the next non-bullet
  box starts the next entry. No text is re-parsed - only box order and
  each box's own leading-marker shape are inspected.
*/
function refineDocxExperienceBoxes(boxes: ContentBox[]): ExperienceRefinementResult {
  if (boxes.length === 0) {
    return { originalBoxId: "docx-experience-group", refined: false, evaluated: false, reason: "No experience-role boxes to refine.", entries: [] };
  }

  const entries: RefinedJobEntry[] = [];
  let current: RefinedJobEntry | null = null;
  let sawAnyBullet = false;

  for (const box of boxes) {
    const isBullet = looksLikeBulletText(box.text);

    if (isBullet) {
      sawAnyBullet = true;
      if (!current) {
        // A bullet with no preceding title/company line - keep it as its
        // own entry rather than guessing which earlier entry it belongs
        // to (this can legitimately happen if the FIRST box Phase 3 gave
        // us is already a bullet).
        current = { titleText: null, companyText: null, titleBoxId: null, companyBoxId: null, bullets: [] };
        entries.push(current);
      }
      current.bullets.push({ boxId: box.id, bulletText: box.text ?? "" });
      continue;
    }

    if (!current || current.bullets.length > 0) {
      // Starting a new entry: this box is the title line.
      current = { titleText: box.text, companyText: null, titleBoxId: box.id, companyBoxId: null, bullets: [] };
      entries.push(current);
    } else if (current.titleText !== null && current.companyText === null) {
      current.companyText = box.text;
      current.companyBoxId = box.id;
    } else {
      // A third consecutive non-bullet line with no bullets seen yet for
      // this entry - not a shape this grouping is confident about
      // (title/company convention assumes exactly two header lines).
      // Start a fresh entry rather than guess this line's role.
      current = { titleText: box.text, companyText: null, titleBoxId: box.id, companyBoxId: null, bullets: [] };
      entries.push(current);
    }
  }

  if (!sawAnyBullet || entries.length < 2) {
    return {
      originalBoxId: "docx-experience-group",
      refined: false,
      // A single box (nothing to possibly split) never counts as a real
      // "attempted, not confident" case - only >= 2 boxes with real
      // structure to compare do.
      evaluated: boxes.length >= 2,
      reason: entries.length < 2
        ? "Fewer than 2 distinguishable entries found - not a clear multi-entry split."
        : "No bullet-marked boxes found among experience-role boxes.",
      entries: [],
    };
  }

  return { originalBoxId: "docx-experience-group", refined: true, evaluated: true, reason: "Grouped by existing role + bullet marker + box order.", entries };
}

/*
  ===== PDF strategy =====
  A merged PDF Experience Content Box's own `elements` (Phase 2's real
  per-line geometry, preserved unchanged on the box - see
  pdfContentBoxGenerator.ts) still carries each line's real vertical
  position, font size/weight, and horizontal x - all real signals Phase 2
  already extracted, never re-parsed here.

  Multi-signal confidence model (replaces the earlier single "gap > 2x
  median" threshold, per this phase's own "단일 gap 임계값을 넘어선다"
  instruction): at every consecutive-line boundary, count how many of
  these INDEPENDENT signals agree a new entry starts at the NEXT line -
  every signal is a real, already-available fact, never invented:
    - vertical gap is a real outlier vs. this block's own median gap
    - the next line contains a date range (extractDateRange(), the same
      exported helper parseExperienceEntries() itself uses - not a new
      regex)
    - font size changes from the previous line to this one
    - font weight changes from the previous line to this one
    - horizontal x position changes (a new left-alignment, e.g. a title
      no longer indented under a bullet)
    - the previous line was a bullet and this line is not (a bullet group
      just ended - the exact shape a new job header follows)
  A boundary is only accepted at >= CONFIDENCE_SIGNALS_REQUIRED agreeing
  signals, OR a single extreme gap outlier (>= 3x median) alone - two
  independent bars, not one. Two candidate break-sets (this stricter
  confidence-based set, and the OLDER "gap > 2x median" set as a second
  candidate) are each handed to the EXISTING, unmodified
  parseExperienceEntries() - never re-implemented here - and whichever
  candidate it accepts as fully `structured` with >= 2 entries is used;
  if neither is accepted, the box is kept unrefined and the disclosed
  reason names exactly which signals were and weren't present.
*/
const CONFIDENCE_SIGNALS_REQUIRED = 2;
const HORIZONTAL_SHIFT_TOLERANCE_PX = 2;

type LineSignals = {
  gapIsOutlier: boolean;
  gapIsExtremeOutlier: boolean;
  nextHasDateRange: boolean;
  fontSizeChanged: boolean;
  fontWeightChanged: boolean;
  xShifted: boolean;
  bulletThenNonBullet: boolean;
};

function computeBoundarySignals(sorted: ElementMetadata[]): LineSignals[] {
  if (sorted.length < 2) return [];

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevBottom = (sorted[i - 1].y ?? 0) + (sorted[i - 1].height ?? sorted[i - 1].fontSize ?? 1);
    gaps.push(Math.max(0, (sorted[i].y ?? 0) - prevBottom));
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)] || 1;

  return gaps.map((gap, i) => {
    const prev = sorted[i];
    const next = sorted[i + 1];
    return {
      gapIsOutlier: gap > median * 2 && gap > 0,
      gapIsExtremeOutlier: gap > median * 3 && gap > 0,
      nextHasDateRange: extractDateRange(next.text ?? "") !== null,
      fontSizeChanged: prev.fontSize !== null && next.fontSize !== null && prev.fontSize !== next.fontSize,
      fontWeightChanged: prev.fontWeight !== null && next.fontWeight !== null && prev.fontWeight !== next.fontWeight,
      xShifted: prev.x !== null && next.x !== null && Math.abs(prev.x - next.x) > HORIZONTAL_SHIFT_TOLERANCE_PX,
      bulletThenNonBullet: looksLikeBulletText(prev.text) && !looksLikeBulletText(next.text),
    };
  });
}

function signalScore(s: LineSignals): number {
  return (
    (s.gapIsOutlier ? 1 : 0) +
    (s.nextHasDateRange ? 1 : 0) +
    (s.fontSizeChanged ? 1 : 0) +
    (s.fontWeightChanged ? 1 : 0) +
    (s.xShifted ? 1 : 0) +
    (s.bulletThenNonBullet ? 1 : 0)
  );
}

function describeSignals(s: LineSignals): string[] {
  const active: string[] = [];
  if (s.gapIsOutlier) active.push("vertical_gap_outlier");
  if (s.nextHasDateRange) active.push("next_line_has_date_range");
  if (s.fontSizeChanged) active.push("font_size_change");
  if (s.fontWeightChanged) active.push("font_weight_change");
  if (s.xShifted) active.push("horizontal_alignment_change");
  if (s.bulletThenNonBullet) active.push("bullet_group_ended");
  return active;
}

function buildTextWithBreaksAt(sorted: ElementMetadata[], breakIndices: Set<number>): string {
  let text = sorted[0].text ?? "";
  for (let i = 0; i < sorted.length - 1; i++) {
    text += (breakIndices.has(i) ? "\n\n" : "\n") + (sorted[i + 1].text ?? "");
  }
  return text;
}

function stripLeadingHeadingLine(text: string): string {
  return text.replace(/^[^\n]*\n\n?/, (match) =>
    /^(experience|professional experience|work experience|employment history|work history|relevant experience)\s*$/i.test(match.trim())
      ? ""
      : match
  );
}

function refinePdfExperienceBox(box: ContentBox): ExperienceRefinementResult {
  const sorted = [...box.elements].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const signals = computeBoundarySignals(sorted);

  if (signals.length === 0) {
    return { originalBoxId: box.id, refined: false, evaluated: false, reason: "Fewer than 2 lines in this box - no boundary to evaluate.", entries: [] };
  }

  const confidentBreaks = new Set<number>();
  const confidentSignalLog: string[] = [];
  signals.forEach((s, i) => {
    const score = signalScore(s);
    if (s.gapIsExtremeOutlier || score >= CONFIDENCE_SIGNALS_REQUIRED) {
      confidentBreaks.add(i);
      confidentSignalLog.push(`line ${i + 1}->${i + 2}: [${describeSignals(s).join(", ") || "extreme_gap_only"}]`);
    }
  });

  // Second, more permissive candidate - the earlier single-signal
  // threshold - kept as a SECOND candidate rather than the only one, so a
  // document where only the gap signal is real (no font/date/x data
  // available, e.g. some DOCX-sourced PDF exports) can still be split.
  const gapOnlyBreaks = new Set<number>();
  signals.forEach((s, i) => {
    if (s.gapIsOutlier) gapOnlyBreaks.add(i);
  });

  const candidates: { label: string; breaks: Set<number>; signalLog: string[] }[] = [
    { label: "multi_signal_confidence", breaks: confidentBreaks, signalLog: confidentSignalLog },
    { label: "gap_only_fallback", breaks: gapOnlyBreaks, signalLog: [] },
  ];

  const attemptedReasons: string[] = [];

  for (const candidate of candidates) {
    if (candidate.breaks.size === 0) {
      attemptedReasons.push(`${candidate.label}: no boundary reached confidence.`);
      continue;
    }

    const text = stripLeadingHeadingLine(buildTextWithBreaksAt(sorted, candidate.breaks));
    const parsed = parseExperienceEntries(text);
    const structuredCount = parsed.filter((entry) => entry.structured).length;

    if (parsed.length >= 2 && structuredCount === parsed.length) {
      const entries: RefinedJobEntry[] = parsed.map((entry) => {
        const bullets: RefinedBulletGroup[] = (entry.description ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((bulletText) => ({ boxId: null, bulletText }));

        // PDF: no separate title/company ContentBox exists to reference
        // (geometry clustering already merged them into the one original
        // box before refinement ran) - see this type's own comment.
        return { titleText: entry.jobTitle ?? null, companyText: entry.company ?? null, titleBoxId: null, companyBoxId: null, bullets };
      });

      return {
        originalBoxId: box.id,
        refined: true,
        evaluated: true,
        reason: `Split into ${entries.length} entries via "${candidate.label}" candidate (${candidate.breaks.size} boundary/boundaries) + existing parseExperienceEntries(). Signals: ${candidate.signalLog.join("; ") || "gap outlier only"}.`,
        entries,
      };
    }

    attemptedReasons.push(
      `${candidate.label}: parseExperienceEntries found ${parsed.length} block(s), only ${structuredCount} confidently structured - not accepted.`
    );
  }

  return {
    originalBoxId: box.id,
    refined: false,
    // At least one candidate proposed a real boundary (confidentBreaks or
    // gapOnlyBreaks was non-empty) but parseExperienceEntries() rejected
    // every candidate - a genuine "tried, not confident enough" outcome,
    // as opposed to signals.length===0 above (nothing to evaluate at
    // all).
    evaluated: confidentBreaks.size > 0 || gapOnlyBreaks.size > 0,
    reason: `No candidate grouping was accepted as a confident multi-entry split. ${attemptedReasons.join(" ")}`,
    entries: [],
  };
}

/*
  Entry point. `boxes` are the FULL set of editable, role="experience"
  Content Boxes for one document (already filtered by the caller). PDF
  boxes are refined one at a time (each may itself already be
  multi-entry, or may already be single-entry and simply pass through
  unrefined); DOCX boxes are refined as one group (see the DOCX strategy
  above for why - grouping needs to see box ORDER across the whole
  section, not per-box).
*/
export function refineExperienceContentBoxes(
  boxes: ContentBox[],
  sourceFormat: "pdf" | "docx"
): ExperienceRefinementResult[] {
  if (sourceFormat === "docx") {
    return [refineDocxExperienceBoxes(boxes)];
  }

  return boxes.map((box) => refinePdfExperienceBox(box));
}

/*
  Real UnbreakableGroup (Phase 2-4 hardening pass, Phase 3 item) -
  populates ContentBox.flow.unbreakableGroup on the ORIGINAL editable
  boxes (before Replacement) so a job's title/company header is never
  separated from its own bullets by a page-continuation decision.

  Only meaningful for DOCX: PDF's geometry clustering already merges an
  entire job entry's title+company+bullets into ONE ContentBox before
  refinement ever runs (pdfContentBoxGenerator.ts) - a single box cannot
  be split across a page break by definition, so it is already
  inherently unbreakable with nothing further to group. This function
  still runs unconditionally and simply returns the boxes unchanged for
  PDF (titleBoxId/companyBoxId/per-bullet boxId are all null there, per
  RefinedJobEntry's own comment) - never fabricates a grouping it has no
  real box-id evidence for.
*/
export function assignUnbreakableGroups(
  boxes: ContentBox[],
  refinements: ExperienceRefinementResult[]
): ContentBox[] {
  const groupIdByBoxId = new Map<string, string>();

  for (const refinement of refinements) {
    if (!refinement.refined) continue;
    refinement.entries.forEach((entry, entryIndex) => {
      const groupId = `${refinement.originalBoxId}-entry-${entryIndex}`;
      const memberBoxIds = [
        entry.titleBoxId,
        entry.companyBoxId,
        ...entry.bullets.map((b) => b.boxId),
      ].filter((id): id is string => id !== null);

      // Only a real, multi-box group (>= 2 distinct real Content Boxes)
      // is worth recording - a "group" of one box is trivially already
      // unbreakable, and recording it would be noise, not a real
      // grouping decision.
      if (memberBoxIds.length >= 2) {
        for (const boxId of memberBoxIds) groupIdByBoxId.set(boxId, groupId);
      }
    });
  }

  if (groupIdByBoxId.size === 0) return boxes;

  return boxes.map((box) => {
    const groupId = groupIdByBoxId.get(box.id);
    if (!groupId) return box;
    return { ...box, flow: { ...box.flow, unbreakableGroup: groupId } };
  });
}
