/*
  Phase 5D.1 - Embedded Canonical Subsection Recovery. A real private
  entry-level resume's PDF put "Education and Training" and
  "Certifications & Licenses" as plain paragraph lines INSIDE its
  Volunteer Experience section (Phase 1 correctly kept the section
  boundary at "Volunteer Experience" - see Phase 5D.0's audit - Phase 1
  is not being second-guessed here). Without this module, everything
  after those lines silently became bullets/description of whichever
  volunteer entry happened to be open, and education/credentials stayed
  empty even though the content was present verbatim in the document.

  This module only SEGMENTS an already-classified Experience/Volunteer
  section's body blocks into contiguous runs whenever a non-bullet
  block's full, normalized text exact-matches a known Education or
  Credentials heading alias - it does not parse, does not invent, does
  not decide values. buildStructuredResume.ts routes each run's blocks
  to the SAME existing extractExperienceEntries/extractEducationEntries/
  extractCredentialEntries used everywhere else in Phase 2.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { matchAlias } from "../losslessSemantic/aliasDictionary";
import { normalizeHeadingForMatching } from "../losslessSemantic/textNormalize";

export type EmbeddedSubsectionType = "primary" | "education" | "credentials";

export type EmbeddedSubsection = {
  type: EmbeddedSubsectionType;
  /* null only for the leading "primary" run when the section's own
     body starts with real primary content (the common case). */
  headingBlock: SemanticContentBlock | null;
  blocks: SemanticContentBlock[];
};

/*
  Phrasings Phase 1's own alias dictionary (aliasDictionary.ts)
  deliberately does NOT include - either because they are compound
  headings Phase 1's top-level classifier intentionally never force-
  splits ("Certifications & Licenses" - see that file's own header
  comment), or because they are simple synonyms outside this round's
  Phase 1 scope ("Education and Training"). This module's concern is
  narrower than Phase 1's: not "what is this section's one canonical
  type" but "does this specific line, already known to sit INSIDE an
  Experience/Volunteer section, mark the start of an embedded Education
  or Credentials run" - so a small supplementary map here reuses
  Phase 1's matcher as the primary mechanism (see resolveEmbeddedHeading
  below) and only adds the handful of phrasings this spec explicitly
  calls for, without duplicating Phase 1's own lists or modifying its
  file. Every key is already fully normalized (normalizeHeadingForMatching
  turns "&" into "and", strips punctuation, collapses whitespace), so
  "Certifications & Licenses", "Certifications and Licenses", and a
  trailing colon on any of these all normalize to one of these keys.
*/
const SUPPLEMENTAL_EMBEDDED_ALIASES: Record<string, EmbeddedSubsectionType> = {
  "education and training": "education",
  "training and education": "education",
  "certifications and licenses": "credentials",
};

function resolveEmbeddedHeadingTarget(text: string): EmbeddedSubsectionType | null {
  const normalized = normalizeHeadingForMatching(text);
  if (normalized.length === 0) return null;
  const aliasType = matchAlias(normalized);
  if (aliasType === "education") return "education";
  if (aliasType === "certifications" || aliasType === "licenses") return "credentials";
  return SUPPLEMENTAL_EMBEDDED_ALIASES[normalized] ?? null;
}

/*
  Splits one section's BODY blocks (heading already excluded by the
  caller, same convention every extractor in this module uses) into
  contiguous runs. Bullet blocks are NEVER heading candidates (spec
  section 7) - this is what keeps an ordinary bullet like "Increased
  revenue by 25% in 2024" or "Maintained certifications and licenses
  database" from ever being mistaken for a section break; only a
  paragraph/heading/metadata block whose ENTIRE normalized text exact-
  matches a known alias can start a new run, so a full sentence merely
  containing heading-shaped words never qualifies. Block order and every
  block's identity are preserved exactly - only the grouping changes.
*/
export function splitEmbeddedCanonicalSubsections(body: SemanticContentBlock[]): EmbeddedSubsection[] {
  const subsections: EmbeddedSubsection[] = [];
  let currentType: EmbeddedSubsectionType = "primary";
  let currentHeading: SemanticContentBlock | null = null;
  let currentBlocks: SemanticContentBlock[] = [];

  const flush = () => {
    subsections.push({ type: currentType, headingBlock: currentHeading, blocks: currentBlocks });
  };

  for (const block of body) {
    const candidateTarget = block.blockType !== "bullet" ? resolveEmbeddedHeadingTarget(block.text) : null;
    if (candidateTarget !== null) {
      flush();
      currentType = candidateTarget;
      currentHeading = block;
      currentBlocks = [];
      continue;
    }
    currentBlocks.push(block);
  }
  flush();

  // Drop only the leading placeholder run (no heading claimed, no
  // blocks collected) that results when the section's body starts
  // immediately with a recognized embedded heading - every other run
  // (has a heading, or has blocks, or both) is kept so its blocks stay
  // covered downstream.
  return subsections.filter((s) => s.headingBlock !== null || s.blocks.length > 0);
}
