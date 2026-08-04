/*
  TASK 6 - Break / keep-together policy defaults per AssemblyBlockKind.
  Spec section 7, applied literally per entry type. This is a pure
  lookup - no measurement, no pixel math, no page-count awareness.
  blockBuilders.ts (TASK 5) calls this to fill in each AssemblyBlock's
  breakPolicy/keepTogether/canSplit/splitStrategy fields.
*/
import type { AssemblyBlockKind, BreakPolicy, KeepTogetherPolicy, AssemblySplitStrategy } from "./types";

export type BlockPolicyDefaults = {
  breakPolicy: BreakPolicy;
  keepTogether: KeepTogetherPolicy;
  canSplit: boolean;
  splitStrategy: AssemblySplitStrategy;
};

export type BlockPolicyInput = {
  bulletCount?: number;
  paragraphCount?: number;
  /* honors+details combined for education; details alone for
     credential/award/publication. */
  detailCount?: number;
};

function noSplit(breakPolicy: BreakPolicy, keepTogether: KeepTogetherPolicy): BlockPolicyDefaults {
  return { breakPolicy, keepTogether, canSplit: false, splitStrategy: "none" };
}

/*
  Shared shape for experience-like entries (professional/volunteer
  experience, projects): keep the header with the first bullet or
  description paragraph; allow splitting between bullets (preferred) or
  between description paragraphs, never both prioritized wrong -
  bullets are the more common, more splittable real shape (spec section
  9's own dominant pattern). Never split when there's nothing to split -
  spec's explicit "bullet/paragraph가 하나도 없으면 false".
*/
function experienceLikePolicy(input: BlockPolicyInput): BlockPolicyDefaults {
  const bulletCount = input.bulletCount ?? 0;
  const paragraphCount = input.paragraphCount ?? 0;
  if (bulletCount >= 2) {
    return { breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: true, splitStrategy: "between-bullets" };
  }
  if (paragraphCount >= 2) {
    return { breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: true, splitStrategy: "between-paragraphs" };
  }
  return noSplit("avoid", "entry-header-with-first-content");
}

export function defaultBlockPolicy(kind: AssemblyBlockKind, input: BlockPolicyInput = {}): BlockPolicyDefaults {
  switch (kind) {
    case "identity":
      return noSplit("avoid", "whole-block");

    case "summary": {
      const paragraphCount = input.paragraphCount ?? 0;
      if (paragraphCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-block", canSplit: true, splitStrategy: "between-paragraphs" };
      return noSplit("avoid", "whole-block");
    }

    case "skill-group":
      return noSplit("avoid", "whole-block");

    case "experience-entry":
    case "volunteer-entry":
    case "project-entry":
      return experienceLikePolicy(input);

    case "education-entry": {
      const detailCount = input.detailCount ?? 0;
      if (detailCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" };
      return noSplit("avoid", "whole-entry-if-fits");
    }

    case "credential-entry": {
      const detailCount = input.detailCount ?? 0;
      if (detailCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" };
      return noSplit("avoid", "whole-entry-if-fits");
    }

    case "award-entry":
      // Spec section 7: "split 불가가 기본" - no stated exception, unlike
      // credential/publication which explicitly allow a details-based
      // exception. Kept conservatively non-splittable.
      return noSplit("avoid", "whole-entry-if-fits");

    case "publication-entry": {
      const detailCount = input.detailCount ?? 0;
      if (detailCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-paragraphs" };
      return noSplit("avoid", "whole-entry-if-fits");
    }

    case "custom-section": {
      const paragraphCount = input.paragraphCount ?? 0;
      const bulletCount = input.bulletCount ?? 0;
      if (paragraphCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-paragraphs" };
      if (bulletCount >= 2) return { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" };
      return noSplit("avoid", "whole-entry-if-fits");
    }

    case "custom-paragraph":
    case "custom-bullet-group":
      return noSplit("avoid", "whole-block");

    default:
      return noSplit("avoid", "none");
  }
}
