/*
  TASK 6 - Award entry extraction. Section 14 of the spec. Real shape
  (lossless-synthetic/f1): "Northline Media Rising Star Award, 2022" -
  one bullet per award, "Name, Year".

  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening.
  Boundary detection now uses headerWindow.ts's shared N-line sliding
  window (the same primitive educationExtractor.ts/credentialExtractor.ts
  use), and a genuine multi-line window (Shape G: Award, Organization,
  Date) recovers the organization line into `issuer` instead of gluing
  it into `name`. A non-header-shaped line (long prose, no date) is
  folded into the PRECEDING entry's own `details[]` rather than becoming
  a spurious award entry of its own - see credentialExtractor.ts's own
  comment on segmentCredentialRanges for the real-fixture evidence this
  guards against (a pre-existing Phase 1 column-interleaving issue,
  already disclosed in Phase 5D.3B's report, that can otherwise leak
  unrelated Experience-column bullet text into this section).
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { collectHeaderWindow, classifyWindow, looksLikeHeaderLine, type HeaderWindowLine } from "./headerWindow";
import type { AwardEntry, StructuredTextValue } from "./types";

function makeValue(value: string, sectionId: string, blocks: SemanticContentBlock[], confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlocks(sectionId, blocks) };
}

type AwardRange = { headerIndices: number[]; bodyIndices: number[] };

function segmentAwardRanges(blocks: SemanticContentBlock[]): AwardRange[] {
  const ranges: AwardRange[] = [];
  let i = 0;
  const n = blocks.length;
  while (i < n) {
    if (blocks[i].rawText.length === 0) {
      i++;
      continue;
    }

    if (blocks[i].blockType !== "bullet" && !looksLikeHeaderLine(blocks[i])) {
      if (ranges.length > 0) {
        ranges[ranges.length - 1].bodyIndices.push(i);
      } else {
        ranges.push({ headerIndices: [], bodyIndices: [i] });
      }
      i++;
      continue;
    }

    const window = collectHeaderWindow(blocks, i);
    if (window.length === 0) {
      ranges.push({ headerIndices: [i], bodyIndices: [] });
      i++;
      continue;
    }
    ranges.push({ headerIndices: window, bodyIndices: [] });
    i = window[window.length - 1] + 1;
  }
  return ranges;
}

export function extractAwardEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): AwardEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading");
  const ranges = segmentAwardRanges(relevant);

  return ranges.map((range, index) => {
    const indices = range.headerIndices;
    const blocks = indices.map((i) => relevant[i]);
    const bodyBlocksForEntry = range.bodyIndices.map((i) => relevant[i]);
    const details = bodyBlocksForEntry.filter((b) => b.rawText.length > 0).map((b) => makeValue(b.rawText, sectionId, [b], 0.6));
    const rawHeaderText = blocks.length > 0 ? blocks.map((b) => b.rawText).join("\n") : bodyBlocksForEntry.map((b) => b.rawText).join("\n");
    const reasonCodes: string[] = [];

    const classified = classifyWindow(relevant, indices);
    const { dateLines } = classified;

    let name: StructuredTextValue | undefined;
    let issuer: StructuredTextValue | undefined;
    let dateText: StructuredTextValue | undefined;

    const hasDate = dateLines.length > 0;
    if (hasDate) {
      /* Phase 5D.3B - the date can land before, after, or in the middle
         of the award name ("2008 Samsung SDI Award" is date-FIRST). */
      dateText = makeValue(dateLines[0].dateAnchor.dateRangeText, sectionId, [dateLines[0].block], 0.75);
    }

    type Candidate = { line: HeaderWindowLine; text: string };
    const candidates: Candidate[] = classified.lines.filter((l) => l.remainderText.length > 0).map((l) => ({ line: l, text: l.remainderText }));

    /* A generic AUTHORITY-category word ("Board", "Association",
       "Chamber", ...) identifies a SEPARATE issuing-organization LINE,
       mirroring educationExtractor.ts's own institution-keyword
       convention - recovers Shape G (Award, Organization, Date) into
       its own field instead of gluing the organization into `name`.
       Only applied when there are 2+ candidate lines: with a single
       candidate, the whole remainder is one combined string ("Regional
       Innovation Award — Chamber of Commerce") and matching the
       keyword ANYWHERE within it would wrongly claim the entire line
       (losing the award name) instead of just the organization
       fragment - the trailing-dash split below handles that
       single-line case instead. */
    let issuerCand: Candidate | undefined;
    if (candidates.length > 1) {
      issuerCand = candidates.find((c) => c.line.hasAuthorityKeyword);
      if (issuerCand) {
        issuer = makeValue(issuerCand.text, sectionId, [issuerCand.line.block], 0.7);
        reasonCodes.push("authority-keyword-disambiguated");
      }
    }
    const remaining = candidates.filter((c) => c !== issuerCand);

    if (remaining.length > 0) {
      const nameText = remaining.map((c) => c.text).join(" ");
      if (nameText.length > 0) {
        if (issuer === undefined) {
          /* Real-fixture shape: "Regional Innovation Award — Chamber
             of Commerce" - the issuer trails the award name on the
             SAME line, dash-separated, mirroring
             credentialExtractor.ts's own splitTrailingDashIssuer. */
          const dashParts = nameText.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
          if (dashParts.length >= 2) {
            name = makeValue(dashParts.slice(0, -1).join(" - "), sectionId, remaining.map((c) => c.line.block), hasDate ? 0.7 : 0.55);
            issuer = makeValue(dashParts[dashParts.length - 1], sectionId, remaining.map((c) => c.line.block), 0.65);
            reasonCodes.push("trailing-dash-issuer-disambiguated");
          } else {
            name = makeValue(nameText, sectionId, remaining.map((c) => c.line.block), hasDate ? 0.7 : 0.55);
          }
        } else {
          name = makeValue(nameText, sectionId, remaining.map((c) => c.line.block), hasDate ? 0.7 : 0.55);
        }
      }
    }

    reasonCodes.push(hasDate ? "date-anchored-window" : "no-date-evidence-in-window");

    return {
      id: entryId(sectionId, "award", index),
      name,
      issuer,
      dateText,
      details,
      // Phase 5D.3A - mirrors `details` 1:1 (see types.ts's own comment
      // on AwardEntry.content: this extractor never separates a
      // detail line from the name/date-bearing line differently).
      content: [],
      rawHeaderText,
      source: mergeTraces(traceFromBlocks(sectionId, [...blocks, ...bodyBlocksForEntry])),
      isUncertain: name === undefined,
      reasonCodes,
    };
  });
}
