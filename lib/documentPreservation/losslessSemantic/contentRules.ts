/*
  TASK 5 (part 1) - Section 8 of the spec: content-structure-based
  classification signals, used ONLY for sections whose heading did not
  exact-match the alias dictionary (see classifier.ts for orchestration
  order). Spec section 8 names exactly 10 categories that get dedicated
  content rules - experience/education/skills/licenses/certifications/
  awards/projects/volunteering/publications/summary. The remaining 7
  dictionary-only categories (objective/training/professional_development/
  affiliations/languages/interests/references) are intentionally NOT
  given content rules here, matching the spec's own list - they rely on
  exact alias match, and otherwise correctly fall through to custom.

  Every rule reports an evidence score + reasonCodes, never a bare
  boolean verdict, so classifier.ts can apply one shared threshold/margin
  policy rather than each rule inventing its own pass/fail line.
*/
import type { SemanticContentBlock, SemanticSectionType } from "./types";

const DATE_RANGE_RE = /(19|20)\d{2}\s*(-|to|–|—)\s*((19|20)\d{2}|present|current)/i;
const DEGREE_KEYWORD_RE = /\b(bachelor|master|ph\.?d|doctorate|associate|diploma|b\.?a\.?|b\.?s\.?|m\.?a\.?|m\.?s\.?|m\.?b\.?a\.?)\b/i;
const GPA_RE = /\bgpa\b/i;
const LICENSE_KEYWORD_RE = /\b(licen[sc]e|licen[sc]ed|registered nurse|permit to practice|registration number)\b/i;
const CERT_KEYWORD_RE = /\b(certified|certificate|certification)\b/i;
const CERT_ACRONYM_RE = /\b[A-Z]{2,6}\b/;
const AWARD_KEYWORD_RE = /\b(award|scholarship|honou?r|dean'?s list|recognition|fellowship)\b/i;
const RANKING_RE = /\b(1st|2nd|3rd|top \d+%|first place|winner|recipient)\b/i;
const PROJECT_VERB_RE = /\b(built|developed|designed|created|launched|architected)\b/i;
const TECH_STACK_LIST_RE = /^[\w.#+/-]+(\s*,\s*[\w.#+/-]+){2,}$/;
const VOLUNTEER_KEYWORD_RE = /\b(volunteer|non-?profit|charity|community outreach)\b/i;
const CITATION_SHAPE_RE = /\((19|20)\d{2}\)|\b(journal|conference|proceedings|vol\.|doi:|issn)\b/i;

function bodyText(blocks: SemanticContentBlock[]): string[] {
  return blocks.map((b) => b.rawText).filter((t) => t.length > 0);
}

function bulletRatio(blocks: SemanticContentBlock[]): number {
  const relevant = blocks.filter((b) => b.blockType === "bullet" || b.blockType === "paragraph");
  if (relevant.length === 0) return 0;
  return relevant.filter((b) => b.blockType === "bullet").length / relevant.length;
}

export type ContentRuleResult = {
  type: Exclude<SemanticSectionType, "custom">;
  score: number;
  reasonCodes: string[];
};

function scoreExperience(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  const dateLines = lines.filter((l) => DATE_RANGE_RE.test(l));
  if (dateLines.length >= 1) {
    score += 2;
    reasonCodes.push("date-range-entry-line-present");
  }
  if (dateLines.length >= 2) {
    score += 1;
    reasonCodes.push("multiple-date-range-entries");
  }
  // Bullets only count as supporting evidence once a date-range entry
  // line has already been found - a bulleted list alone is equally
  // common in skills/projects/awards sections and must never look like
  // experience on its own.
  if (dateLines.length >= 1 && bulletRatio(blocks) > 0.3) {
    score += 1;
    reasonCodes.push("bullet-list-under-entries");
  }
  return { type: "experience", score, reasonCodes };
}

function scoreEducation(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => DEGREE_KEYWORD_RE.test(l))) {
    score += 2;
    reasonCodes.push("degree-keyword-present");
  }
  if (lines.some((l) => GPA_RE.test(l))) {
    score += 1;
    reasonCodes.push("gpa-mention");
  }
  if (lines.some((l) => DATE_RANGE_RE.test(l))) {
    score += 1;
    reasonCodes.push("date-range-present");
  }
  return { type: "education", score, reasonCodes };
}

function scoreSkills(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  const ratio = bulletRatio(blocks);
  const shortLines = lines.filter((l) => l.length <= 60).length;
  if (ratio > 0.5 && lines.length > 0) {
    score += 1;
    reasonCodes.push("high-bullet-density");
  }
  if (lines.length > 0 && shortLines / lines.length > 0.7) {
    score += 1;
    reasonCodes.push("mostly-short-lines");
  }
  if (lines.some((l) => TECH_STACK_LIST_RE.test(l.trim()))) {
    score += 1;
    reasonCodes.push("comma-separated-token-list-line");
  }
  const hasEntryShape = lines.some((l) => DATE_RANGE_RE.test(l));
  if (hasEntryShape) {
    score -= 2;
    reasonCodes.push("date-range-entries-present-disqualifier");
  }
  return { type: "skills", score, reasonCodes };
}

function scoreLicenses(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => LICENSE_KEYWORD_RE.test(l))) {
    score += 2;
    reasonCodes.push("license-keyword-present");
  }
  return { type: "licenses", score, reasonCodes };
}

function scoreCertifications(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => CERT_KEYWORD_RE.test(l))) {
    score += 2;
    reasonCodes.push("certification-keyword-present");
  }
  const acronymLines = lines.filter((l) => l.length <= 60 && CERT_ACRONYM_RE.test(l));
  if (acronymLines.length >= 1 && bulletRatio(blocks) > 0.3) {
    score += 1;
    reasonCodes.push("acronym-style-bulleted-entries");
  }
  return { type: "certifications", score, reasonCodes };
}

function scoreAwards(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => AWARD_KEYWORD_RE.test(l))) {
    score += 2;
    reasonCodes.push("award-keyword-present");
  }
  if (lines.some((l) => RANKING_RE.test(l))) {
    score += 1;
    reasonCodes.push("ranking-language-present");
  }
  return { type: "awards", score, reasonCodes };
}

function scoreProjects(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => PROJECT_VERB_RE.test(l))) {
    score += 1;
    reasonCodes.push("project-verb-language-present");
  }
  if (lines.some((l) => TECH_STACK_LIST_RE.test(l.trim()))) {
    score += 1;
    reasonCodes.push("tech-stack-list-line");
  }
  const hasEmployerDateShape = lines.filter((l) => DATE_RANGE_RE.test(l)).length >= 2;
  if (hasEmployerDateShape) {
    score -= 1;
    reasonCodes.push("looks-more-like-multi-employer-experience");
  }
  return { type: "projects", score, reasonCodes };
}

function scoreVolunteering(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => VOLUNTEER_KEYWORD_RE.test(l))) {
    score += 2;
    reasonCodes.push("volunteer-keyword-present");
  }
  if (lines.some((l) => DATE_RANGE_RE.test(l))) {
    score += 1;
    reasonCodes.push("date-range-present");
  }
  return { type: "volunteering", score, reasonCodes };
}

function scorePublications(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  if (lines.some((l) => CITATION_SHAPE_RE.test(l))) {
    score += 2;
    reasonCodes.push("citation-shape-present");
  }
  return { type: "publications", score, reasonCodes };
}

function scoreSummary(blocks: SemanticContentBlock[]): ContentRuleResult {
  const lines = bodyText(blocks);
  const reasonCodes: string[] = [];
  let score = 0;
  const paragraphBlocks = blocks.filter((b) => b.blockType === "paragraph");
  const avgLen = paragraphBlocks.length > 0 ? paragraphBlocks.reduce((s, b) => s + b.rawText.length, 0) / paragraphBlocks.length : 0;
  if (paragraphBlocks.length > 0 && paragraphBlocks.length <= 4 && avgLen > 80) {
    score += 1;
    reasonCodes.push("narrative-prose-shape");
  }
  if (bulletRatio(blocks) < 0.2) {
    score += 1;
    reasonCodes.push("low-bullet-density");
  }
  if (lines.some((l) => DATE_RANGE_RE.test(l))) {
    score -= 2;
    reasonCodes.push("date-range-entries-present-disqualifier");
  }
  return { type: "summary", score, reasonCodes };
}

/*
  Runs every content rule and returns ALL results (not just the winner) -
  classifier.ts needs the full ranked list to enforce a minimum
  margin-over-second-place before confirming, per section 10's "a
  correct custom beats a wrong known type" policy.
*/
export function classifyByContentRules(bodyBlocks: SemanticContentBlock[]): ContentRuleResult[] {
  return [
    scoreExperience(bodyBlocks),
    scoreEducation(bodyBlocks),
    scoreSkills(bodyBlocks),
    scoreLicenses(bodyBlocks),
    scoreCertifications(bodyBlocks),
    scoreAwards(bodyBlocks),
    scoreProjects(bodyBlocks),
    scoreVolunteering(bodyBlocks),
    scorePublications(bodyBlocks),
    scoreSummary(bodyBlocks),
  ].sort((a, b) => b.score - a.score);
}
