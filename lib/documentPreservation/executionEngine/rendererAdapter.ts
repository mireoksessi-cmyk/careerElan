/*
  Document Preservation Engine (DPE) - Phase 4B (Execution Engine).
  Renderer Adapter - converts the Replacement Engine's output back into a
  plain resume_text STRING, the ONLY input shape the existing Renderer
  actually accepts.

  Investigated first (per this phase's own instruction) exactly what the
  existing Renderer's contract is: lib/brand/render/renderer.ts's
  Renderer.React takes a parsed DocumentIR, but Renderer.exportPdf/
  exportDocx (and A4DocumentPreview.tsx, and every real call site in
  app/paste-job/page.tsx) all take `text: string` and internally call
  buildDocumentIRFromText(text) themselves. There is no structural
  "box tree" input anywhere in the Renderer's actual contract - text is
  the ONLY thing this phase can hand it without changing that contract
  (forbidden - "Renderer 계약을 변경하지 않는다"). This module's entire
  job is therefore: reassemble replaced Content Boxes into a valid
  resume_text string, in the SAME order Phase 3 already established, so
  the UNCHANGED buildDocumentIRFromText()/sectionParser.ts can parse it
  back exactly like any other Generate Package output.

  Heading lines are never regenerated from a role name - each section's
  ORIGINAL heading box (role "heading", never a Replacement Plan target
  since no SectionKey maps to that role) keeps its own original text
  verbatim, preserving whatever heading wording the source document
  actually used.
*/
import { matchHeading } from "@/lib/brand/sectionParser";
import type { ContentBox } from "../contentBox/types";
import type { ExperienceRefinementResult } from "./types";

/*
  Two adjacent boxes sharing a role that both received the SAME
  section-block unit (resumeMapping.ts's mapSectionBlock 1:N fan-out)
  normally end up with byte-identical text, which the dedup check below
  already skips. But when Content Box Generation split one logical
  section across an original source-document page boundary into two
  boxes, and exactly one of them bundles its own heading line
  (replacementEngine.ts's "bundled heading+body" case), that box's
  replaced text gets its ORIGINAL heading line prefixed onto the SAME
  generated unit text the other box received unprefixed - the two texts
  then differ by exactly that heading line, so a plain equality check no
  longer recognizes them as the same fan-out and both get emitted,
  duplicating the whole generated section. Stripping a leading
  heading-line match (the SAME matchHeading() replacementEngine.ts
  itself already uses to decide whether to add that prefix) before
  comparing restores the dedup's original intent without touching how
  the plan assigns units.
*/
function stripLeadingHeadingLine(text: string): string {
  const newlineIndex = text.indexOf("\n");
  const firstLine = newlineIndex === -1 ? text : text.slice(0, newlineIndex);
  if (matchHeading(firstLine) === null) return text;
  return newlineIndex === -1 ? "" : text.slice(newlineIndex + 1);
}

function entryText(entry: ExperienceRefinementResult["entries"][number]): string {
  const lines: string[] = [];
  if (entry.titleText) lines.push(entry.titleText);
  if (entry.companyText) lines.push(entry.companyText);
  for (const bullet of entry.bullets) lines.push(bullet.bulletText);
  return lines.join("\n");
}

/*
  If Experience Refinement succeeded for a given original box, its
  refined Job Entries (already carrying the SAME text the box would
  otherwise have contributed - Refinement never invents new text, only
  regroups existing text) replace that one box's contribution, entry by
  entry with a blank line between entries (matching the same convention
  parseExperienceEntries()/sectionParser.ts already expect on the way
  back in).
*/
export function renderBoxesToResumeText(
  editableBoxes: ContentBox[],
  refinements: ExperienceRefinementResult[] = []
): string {
  const refinementByBoxId = new Map(
    refinements.filter((r) => r.refined).map((r) => [r.originalBoxId, r])
  );

  // DOCX refinement is a single group-level result (originalBoxId:
  // "docx-experience-group") covering MANY boxes at once, not one box -
  // handled separately: once we've emitted it for the first
  // experience-role box in that group, every other box in the same
  // group is skipped (its text already came out as part of the group).
  const docxGroupRefinement = refinements.find(
    (r) => r.originalBoxId === "docx-experience-group" && r.refined
  );
  let docxGroupEmitted = false;

  const lines: string[] = [];

  /*
    Section-block mapping (resumeMapping.ts's mapSectionBlock) is a
    legitimate 1:N shape by design - ONE generated unit assigned to
    EVERY box sharing a role (e.g. all 12 individual DOCX skill-item
    boxes each receive the SAME whole Skills text, since Phase 3 never
    split Skills into one-box-per-item at a level this phase's own
    Section Matcher targets - see Phase 4A's own report). Walking every
    box and appending its text verbatim would repeat that ONE generated
    block once per box (confirmed empirically - a real DOCX fixture
    produced the same Skills paragraph ~12 times in a row). Consecutive
    boxes of the SAME role that ended up with IDENTICAL text (the
    unmistakable signature of one unit having been fanned out to many
    boxes) are only emitted once, the same way this phase already
    de-duplicates the docxGroupRefinement case above.
  */
  let lastEmittedRole: string | null = null;
  let lastEmittedText: string | null = null;

  for (const box of editableBoxes) {
    if (box.role === "heading") {
      lines.push("", box.text ?? "");
      lastEmittedRole = null;
      lastEmittedText = null;
      continue;
    }

    if (box.role === "experience") {
      const perBoxRefinement = refinementByBoxId.get(box.id);

      if (perBoxRefinement) {
        lines.push("", perBoxRefinement.entries.map(entryText).join("\n\n"));
        lastEmittedRole = null;
        lastEmittedText = null;
        continue;
      }

      if (docxGroupRefinement) {
        if (!docxGroupEmitted) {
          lines.push("", docxGroupRefinement.entries.map(entryText).join("\n\n"));
          docxGroupEmitted = true;
        }
        lastEmittedRole = null;
        lastEmittedText = null;
        continue;
      }
    }

    const normalizedText = stripLeadingHeadingLine(box.text ?? "");
    if (box.role === lastEmittedRole && normalizedText === lastEmittedText) {
      continue;
    }

    lines.push(box.text ?? "");
    lastEmittedRole = box.role;
    lastEmittedText = normalizedText;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
