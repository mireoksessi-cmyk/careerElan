/*
  Document Preservation Engine (DPE) - Phase 4B (Execution Engine).
  Replacement Engine - applies a Phase 4A ReplacementPlan's assignments to
  produce a new set of ContentBoxes with generated text in place of
  original text. Pure data transformation: never mutates a Phase 3
  ContentBox in place (returns new objects), never touches Template Layer
  boxes, never calls a Renderer or writes to any file/DB.
*/
import { matchHeading } from "@/lib/brand/sectionParser";
import type { ContentBox, DocumentLayerModel } from "../contentBox/types";
import type { ReplacementPlan } from "../contentMapping/types";

export type ReplacementResult = {
  replacedBoxes: ContentBox[];
  templateBoxes: ContentBox[];
  replacedCount: number;
  skippedCount: number;
};

/*
  9. Replacement Rules - Template Layer is never a mapping target and
  never a replacement target; this function's input (`layerModel`) still
  has its templateBoxes/unknownBoxes, but only editableBoxes ever get
  walked below. Existing Template Boxes are returned completely
  untouched (same object references) - never deleted, never reordered.
*/
export function applyReplacementPlan(
  layerModel: DocumentLayerModel,
  plan: ReplacementPlan
): ReplacementResult {
  const replacedById = new Map<string, ContentBox>();

  // Looked up by id rather than trusting assignment.contentBox as the
  // base object - the plan may have been built from an EARLIER snapshot
  // of layerModel.editableBoxes (e.g. before Phase 2-4 hardening's real
  // UnbreakableGroup assignment ran), so the CURRENT layerModel's own box
  // (same id, same content, only its `flow`/`templateRegionId` fields
  // possibly enriched since) is the correct base to preserve those
  // enrichments through replacement.
  const currentById = new Map(layerModel.editableBoxes.map((box) => [box.id, box]));

  const assignments =
    plan.documentType === "resume"
      ? plan.sections.flatMap((section) => section.assignments)
      : plan.assignments;

  for (const assignment of assignments) {
    if (!assignment.unit) continue;

    // Defensive: Replacement Rules forbid ever writing into a
    // Template-layer box, even if some future caller's plan
    // accidentally included one - this function is the last line of
    // defense for that rule, not just the mapping step.
    if (assignment.contentBox.layer !== "editable") continue;

    const baseBox = currentById.get(assignment.contentBox.id) ?? assignment.contentBox;

    /*
      Phase5 Gate Blocker 3 root-cause fix (real, evidenced - see the
      session's own investigation, standard_pdf fixture): a single-column
      PDF's own geometry clustering can bundle a section's HEADING line
      together with its BODY into ONE ContentBox (roleClassifier.ts's own
      documented "bundled heading+body" case - the box's role becomes
      the section's body role directly, never "heading", because it is
      not JUST the heading). rendererAdapter.ts's own comment already
      states the intended contract - "each section's ORIGINAL heading box
      ... keeps its own original text verbatim" - but a bundled box has
      no SEPARATE heading box to preserve: overwriting `baseBox.text`
      wholesale with only the new unit's body (mapSectionBlock's `raw` is
      body-only, the heading line already stripped by parseSections())
      silently deletes the heading word itself. Real instrumented
      evidence (standard_pdf): after replacement the "Skills" heading
      text was gone from the final reconstructed resume text, so
      re-parsing that text for measurement no longer recognized a
      "skills" section at all - a real, observable "Sidebar column
      presence changed (original=true, final=false)" mutation, not a
      validation false positive like Blocker 3's other two shapes.

      Detected the SAME way roleClassifier.ts itself detects a bundled
      box in the first place - matchHeading() on the box's own first
      line - so this never guesses at a NEW heuristic. A box whose first
      line was never a heading (a genuine "inherited, body-only" box, or
      any DOCX box - DOCX is always 1:1 per-element, never bundled) is
      completely unaffected; only a bundled box has its ORIGINAL heading
      line re-prefixed onto the new body, verbatim, exactly matching the
      non-bundled heading-box case's own existing "keep original wording"
      contract.
    */
    const originalFirstLine = (baseBox.text ?? "").split(/\r?\n/, 1)[0] ?? "";
    const isBundledHeadingBody = baseBox.role !== "heading" && matchHeading(originalFirstLine) !== null;

    replacedById.set(assignment.contentBox.id, {
      ...baseBox,
      text: isBundledHeadingBody ? `${originalFirstLine}\n${assignment.unit.text}` : assignment.unit.text,
    });
  }

  const replacedBoxes = layerModel.editableBoxes.map(
    (box) => replacedById.get(box.id) ?? box
  );

  return {
    replacedBoxes,
    templateBoxes: layerModel.templateBoxes,
    replacedCount: replacedById.size,
    skippedCount: layerModel.editableBoxes.length - replacedById.size,
  };
}
