/*
  Document Preservation Engine (DPE) - Phase 3 (Content Box & Template
  Layer). Shared editable-role classifier, used by BOTH the PDF and DOCX
  Content Box Generators - the one piece of "PDF와 DOCX 모두 동일한
  Content Box 모델을 사용한다" that can genuinely be identical code, since
  it only ever looks at a box's TEXT (something both generators have),
  never at coordinates (something only PDF has).

  Reuses lib/brand/sectionParser.ts's matchHeading() (now exported - see
  that file's own comment) instead of re-deriving or copying its
  HEADING_DICTIONARY. This is a deliberate, direct reuse of an existing,
  already-curated classification mechanism already used elsewhere in this
  codebase to recognize resume section headings - not a new heuristic.

  Sequential/stateful by design: it walks a document's boxes in order and
  remembers "which section are we currently inside," exactly the way
  sectionParser.ts's own parseSections() does for AI-generated resume
  text. A box only gets a specific editable role (skills/experience/...)
  if a confident heading match was seen earlier in the same document -
  otherwise it stays "unknown", per this phase's "불확실하면 unknown으로
  둔다" rule.
*/
import { matchHeading } from "@/lib/brand/sectionParser";
import type { SectionKey } from "@/lib/brand/types";
import type { DPEDocumentType } from "../types";
import type { ContentBoxConfidence, ContentBoxLayer, ContentBoxRole } from "./types";

/*
  Exported for Phase 4A's Content Mapping (lib/documentPreservation/
  contentMapping) - it needs the exact same SectionKey -> editable role
  mapping to match DocumentIR sections (from the EXISTING
  buildDocumentIRFromText()/lib/brand/types.ts SectionKey) against these
  Content Boxes' own `role` field. Reusing this table keeps both phases'
  notion of "which role corresponds to which section" identical by
  construction, instead of a second, possibly-drifting copy.
*/
export const SECTION_KEY_TO_ROLE: Record<SectionKey, ContentBoxRole> = {
  summary: "summary",
  experience: "experience",
  education: "education",
  skills: "skills",
  projects: "project",
  certifications: "certification",
  languages: "languages",
  volunteer: "volunteer",
  references: "references",
};

export type RoleClassifierInput = {
  documentType: DPEDocumentType;
  boxType: "text" | "image" | "table" | "unknown";
  text: string | null;
};

export type RoleClassifierResult = {
  layer: ContentBoxLayer;
  role: ContentBoxRole;
  confidence: ContentBoxConfidence;
};

export type SequentialRoleClassifier = {
  classify: (input: RoleClassifierInput) => RoleClassifierResult;
};

export function createSequentialRoleClassifier(): SequentialRoleClassifier {
  let currentSectionRole: ContentBoxRole | null = null;

  function classify(input: RoleClassifierInput): RoleClassifierResult {
    if (input.boxType === "text" && input.text) {
      /*
        Only the box's FIRST line is checked against matchHeading(), not
        the whole (possibly multi-line) text. DOCX boxes are always
        exactly one logical element already, so this changes nothing for
        them - but PDF boxes come from geometry clustering
        (pdfContentBoxGenerator.ts), which frequently bundles a heading
        together with the body text right below it into one box (a
        heading line is usually close enough, vertically and
        horizontally, to its own body to cluster as "the same block").
        matchHeading() requires the ENTIRE input to be a short, exact
        match, so checking the full multi-line text against it would
        almost never succeed once a heading and its body share one box -
        confirmed empirically against a real 2-column PDF (see the final
        report).
      */
      const firstLine = input.text.split(/\r?\n/, 1)[0] ?? input.text;
      const isSingleLine = !input.text.includes("\n");
      const heading = matchHeading(firstLine);

      if (heading) {
        currentSectionRole = SECTION_KEY_TO_ROLE[heading.key];

        if (isSingleLine) {
          // The heading LINE itself is role "heading", not the section's
          // body role - e.g. the literal text "Skills" is role
          // "heading", while the bullets under it become role "skills".
          return { layer: "editable", role: "heading", confidence: "high" };
        }

        // A bundled heading+body box (geometry clustering merged them) -
        // this box is not JUST the heading, so it takes the section's
        // body role directly rather than "heading", at reduced
        // confidence (the heading match itself was exact, but the rest
        // of the box's content was never independently verified).
        return { layer: "editable", role: currentSectionRole, confidence: "medium" };
      }
    }

    if (input.boxType === "text" && currentSectionRole) {
      // Inherited from the most recent confident heading match, not
      // independently verified against this specific box's own content -
      // hence "medium", not "high".
      return { layer: "editable", role: currentSectionRole, confidence: "medium" };
    }

    /*
      Cover letters have no resume-style section headings at all (see the
      Phase 0 investigation - PACKAGE_GENERATION prompt formats cover
      letters as plain body paragraphs), so a text box with no active
      section in a cover_letter document defaults to its body role rather
      than staying unknown - the one place this classifier makes a
      document-type-driven assumption instead of only reacting to
      matched text, and it is disclosed here rather than left implicit.
    */
    if (
      input.boxType === "text" &&
      input.documentType === "cover_letter" &&
      !currentSectionRole &&
      (input.text?.trim().length ?? 0) > 0
    ) {
      return { layer: "editable", role: "cover_letter_body", confidence: "medium" };
    }

    return { layer: "unknown", role: "unknown", confidence: "low" };
  }

  return { classify };
}
