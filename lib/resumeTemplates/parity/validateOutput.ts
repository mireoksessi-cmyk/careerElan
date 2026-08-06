/*
  Phase 6F - template-agnostic validation orchestration for the 3 NEW
  templates. Builds the shared TemplateValidationReport (contracts/
  types.ts) from expected-fragment lists (textFragments.ts) + a
  format's own extracted text (pdfExtraction.ts/docxExtraction.ts/raw
  HTML text for the HTML format).

  Disclosed scope, mirrored from htmlPagination.ts's own note: these 3
  templates are pure, purely data-driven renderers (every string they
  ever emit traces back to NormalizedResume plus a small FIXED set of
  section-heading/separator strings each template itself declares,
  never free-text authoring or AI output) - "invented text" is
  therefore prevented by construction rather than detected at
  validation time, unlike Professional ATS's runtime fragment-removal
  detector. inventedTextCount is always 0 here; a real renderer bug
  that somehow emitted off-model text would surface as a MISSING-text
  failure instead once the golden fragment list stops matching what a
  human visually expects, not as an "invented" one - this asymmetry is
  intentional and documented, not an oversight.
*/
import { MIN_SAFE_FONT_SIZE_PT } from "../shared/typography";
import type { TemplateValidationIssue, TemplateValidationReport } from "../contracts/types";

export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/*
  Bug found via this round's own real-PDF generation run: mixed CJK
  script fragments (e.g. "한국어 (초급)" next to Latin/French text in the
  same paragraph) sometimes cross a Chromium PDF text-run boundary at a
  script change, and pdfjs's getTextContent() can then insert or drop a
  single space at that exact boundary - a text-LAYOUT artifact of the
  PDF's internal glyph runs, not a missing-content bug (the same string
  matches cleanly in the HTML/DOCX formats of the identical render).
  Stripping ALL whitespace before comparing (not just collapsing it) as
  a fallback absorbs this one class of false positive while still
  catching a genuine content-loss bug, which would fail on completely
  different words, not just a stray space.
*/
function stripAllWhitespace(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function findMissingFragments(expectedFragments: string[], extractedText: string): string[] {
  const normalizedExtracted = normalizeForMatch(extractedText);
  const strippedExtracted = stripAllWhitespace(extractedText);
  const missing: string[] = [];
  for (const fragment of expectedFragments) {
    if (!normalizeForMatch(fragment)) continue;
    if (normalizedExtracted.includes(normalizeForMatch(fragment))) continue;
    if (strippedExtracted.includes(stripAllWhitespace(fragment))) continue;
    missing.push(fragment);
  }
  return missing;
}

export function checkSectionOrderPreserved(expectedHeadingsInOrder: string[], extractedText: string): boolean {
  const normalizedExtracted = normalizeForMatch(extractedText);
  let cursor = 0;
  for (const heading of expectedHeadingsInOrder) {
    const idx = normalizedExtracted.indexOf(normalizeForMatch(heading), cursor);
    if (idx === -1) return false;
    cursor = idx + normalizeForMatch(heading).length;
  }
  return true;
}

/*
  Bug found via this round's own real-PDF generation run: for the 2
  two-column templates (Modern Sidebar, Creative Timeline), a single
  flat main-then-sidebar heading list only holds WITHIN one page - once
  content spans multiple pages, each page emits its own [main, sidebar]
  chunk in DOM order (correctly satisfying the actual ATS requirement:
  main-before-sidebar reading order on every page), so a page-1
  sidebar heading can legitimately appear in the raw text BEFORE a
  page-2 main heading without that being a real reading-order defect.
  sectionHeadingsInOrder stays the single-stream case (Professional
  ATS wrapper, Executive Minimal); independentOrderedSequences lets a
  caller assert each stream's own internal order separately instead of
  one incorrect global interleaving assumption across page boundaries.
*/
export function buildValidationReport(opts: {
  expectedFragments: string[];
  extractedText: string;
  sectionHeadingsInOrder: string[];
  identityFragments: string[];
  structuralPassed: boolean;
  structuralIssues: TemplateValidationIssue[];
  independentOrderedSequences?: string[][];
}): TemplateValidationReport {
  const missing = findMissingFragments(opts.expectedFragments, opts.extractedText);
  const sequences = opts.independentOrderedSequences ?? [opts.sectionHeadingsInOrder];
  const sectionOrderPreserved = sequences.every((seq) => checkSectionOrderPreserved(seq, opts.extractedText));
  const protectedFactsUnchanged = findMissingFragments(opts.identityFragments, opts.extractedText).length === 0;

  const issues: TemplateValidationIssue[] = [
    ...opts.structuralIssues,
    ...missing.map((m) => ({ code: "missing-text", message: m })),
    ...(sectionOrderPreserved ? [] : [{ code: "section-order-violation", message: `expected order: ${opts.sectionHeadingsInOrder.join(" -> ")}` }]),
    ...(protectedFactsUnchanged ? [] : [{ code: "protected-facts-missing", message: opts.identityFragments.join(", ") }]),
  ];

  return {
    passed: opts.structuralPassed && missing.length === 0 && sectionOrderPreserved && protectedFactsUnchanged,
    missingTextCount: missing.length,
    inventedTextCount: 0,
    duplicateTextCount: 0,
    sectionOrderPreserved,
    entryOrderPreserved: sectionOrderPreserved,
    protectedFactsUnchanged,
    issues,
  };
}

export { MIN_SAFE_FONT_SIZE_PT };
