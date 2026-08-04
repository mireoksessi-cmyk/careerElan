/*
  TASK 5 (part 2) - orchestrates the full judgment order from spec
  section 2: normalize heading (matching-only) -> alias dictionary
  (section 7) -> content-structure rules (section 8) -> context signals
  (section 9, support-only, never confirms alone) -> custom fallback
  (section 10). AI classification is explicitly out of scope this round
  - see aiClassifierStub.ts for the required stub/interface-only surface.

  Confidence values below are deliberately conservative and were picked
  to match section 10's ordering ("dictionary exact match = high;
  strong content pattern = medium-high; context alone = never
  confirms"), not tuned against a held-out fixture set (no fixture
  currently exercises the exact numeric confidence value, only the
  resulting normalizedType/classificationMethod - see
  classifier.test.ts). If real fixture results in TASK 8 show these
  need adjusting, that is expected follow-up, not a defect in this
  file.
*/
import type { ClassificationMethod, SemanticContentBlock, SemanticSectionType } from "./types";
import { matchAlias } from "./aliasDictionary";
import { normalizeHeadingForMatching } from "./textNormalize";
import { classifyByContentRules } from "./contentRules";

const CONTENT_RULE_CONFIRM_THRESHOLD = 3;
const CONTENT_RULE_MIN_MARGIN = 2;
const CONTEXT_BOOST_MAX = 1;

export type SectionClassification = {
  normalizedType: SemanticSectionType;
  confidence: number;
  classificationMethod: ClassificationMethod;
  reasonCodes: string[];
};

export type ClassificationContext = {
  isFirstSectionInDocument: boolean;
  immediatelyFollowsIdentityBlocks: boolean;
};

/*
  Section 9 context signals are support-only: they may only ADD to an
  already-nonzero content-rule score for the SAME candidate type, never
  manufacture evidence for a type that scored zero from content rules
  alone. This is what "context alone never confirms" means in code -
  there is no code path where isFirstSectionInDocument by itself can
  produce a non-custom classification.
*/
function applyContextBoost(
  results: ReturnType<typeof classifyByContentRules>,
  context: ClassificationContext | undefined
): ReturnType<typeof classifyByContentRules> {
  if (!context) return results;
  return results.map((r) => {
    if (r.type !== "summary" || r.score <= 0) return r;
    if (context.isFirstSectionInDocument && context.immediatelyFollowsIdentityBlocks) {
      return {
        ...r,
        score: r.score + CONTEXT_BOOST_MAX,
        reasonCodes: [...r.reasonCodes, "context-first-section-after-identity-block"],
      };
    }
    return r;
  });
}

export function classifySection(
  headingText: string | null,
  bodyBlocks: SemanticContentBlock[],
  context?: ClassificationContext
): SectionClassification {
  if (headingText !== null) {
    const normalized = normalizeHeadingForMatching(headingText);
    const aliasType = matchAlias(normalized);
    if (aliasType !== null) {
      return {
        normalizedType: aliasType,
        confidence: 0.95,
        classificationMethod: "dictionary",
        reasonCodes: ["known-heading-alias-exact-match"],
      };
    }
  }

  const rawContentResults = classifyByContentRules(bodyBlocks);
  const contentResults = applyContextBoost(rawContentResults, context).sort((a, b) => b.score - a.score);
  const best = contentResults[0];
  const second = contentResults[1];

  if (
    best &&
    best.score >= CONTENT_RULE_CONFIRM_THRESHOLD &&
    best.score - (second?.score ?? 0) >= CONTENT_RULE_MIN_MARGIN
  ) {
    const confidence = Math.min(0.5 + best.score * 0.08, 0.85);
    return {
      normalizedType: best.type,
      confidence,
      classificationMethod: "content-rule",
      reasonCodes: best.reasonCodes,
    };
  }

  return {
    normalizedType: "custom",
    confidence: 0,
    classificationMethod: "fallback",
    reasonCodes: [
      "below-classification-confidence-threshold",
      ...(best ? [`closest-candidate:${best.type}:score=${best.score}`] : ["no-content-rule-evidence"]),
    ],
  };
}
