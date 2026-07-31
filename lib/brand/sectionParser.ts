import type { DocumentIR, ParsedSection, SectionKey } from "./types";

/*
  PoC Section Parser - resume_text (or cover_letter_text) -> section
  blocks, WITHOUT ever deleting, reordering, or rewriting a single
  character of the original text. The only thing this module decides is
  "which lines are a section heading, and which section does each belong
  to" - never anything about the content itself.

  Deliberately conservative: a line is only treated as a heading when the
  ENTIRE (normalized) line matches a known synonym. No substring/fuzzy
  matching, no confidence scoring - this trades recall (some real
  headings in unusual phrasing won't be recognized) for zero risk of a
  false positive swallowing body text into a wrong section. An
  unrecognized heading just becomes part of the previous section's body
  (or leadingText, if before the first real heading) - content is never
  lost, only possibly mis-grouped.
*/

const HEADING_DICTIONARY: Record<SectionKey, string[]> = {
  summary: [
    "summary",
    "professional summary",
    "profile",
    "career summary",
    "objective",
    "career objective",
    "about me",
  ],
  experience: [
    "experience",
    "work experience",
    "employment history",
    "professional experience",
    "work history",
    "relevant experience",
  ],
  education: ["education", "education and training", "academic background"],
  skills: [
    "skills",
    "technical skills",
    "core skills",
    "key skills",
    "competencies",
    "skills and competencies",
  ],
  projects: ["projects", "project experience", "key projects"],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licences",
    "credentials",
    "certifications and licenses",
  ],
  languages: ["languages", "language skills", "bilingual skills"],
  volunteer: [
    "volunteer",
    "volunteer experience",
    "volunteer / internship",
    "volunteering",
    "community involvement",
  ],
  references: ["references"],
};

function normalizeHeadingCandidate(line: string): string {
  return line
    .trim()
    .replace(/^[*#\-\s]+/, "")
    .replace(/[*#:]+$/, "")
    .trim()
    .toLowerCase();
}

/*
  Exported for lib/documentPreservation/contentBox's role classifier
  (Phase 3 of the Document Preservation Engine effort) - it needs the
  exact same "is this line a known resume section heading" check this
  parser already uses, and reimplementing/copying HEADING_DICTIONARY
  would duplicate a curated synonym list rather than reuse it. Purely
  additive (same function, now also exported) - every existing caller of
  this module (parseSections, and everything that calls it) is
  unaffected.
*/
export function matchHeading(line: string): { key: SectionKey; headingText: string } | null {
  const trimmed = line.trim();

  // Real headings in AI-written resumes are always short, standalone
  // lines - anything longer is almost certainly a sentence, not a
  // heading, so we bail out early rather than risk a false match.
  if (!trimmed || trimmed.length > 40) return null;

  const normalized = normalizeHeadingCandidate(trimmed);
  if (!normalized) return null;

  for (const key of Object.keys(HEADING_DICTIONARY) as SectionKey[]) {
    if (HEADING_DICTIONARY[key].includes(normalized)) {
      return { key, headingText: trimmed };
    }
  }

  return null;
}

function trimBlockText(lines: string[]): string {
  const joined = lines.join("\n");
  return joined.replace(/^\n+/, "").replace(/\n+$/, "");
}

export function parseSections(resumeText: string): DocumentIR {
  const lines = (resumeText || "").split(/\r?\n/);

  const sections: ParsedSection[] = [];
  const leadingLines: string[] = [];
  let currentKey: SectionKey | null = null;
  let currentHeadingText = "";
  let currentLines: string[] = [];

  function flushCurrent() {
    if (currentKey) {
      sections.push({
        key: currentKey,
        headingText: currentHeadingText,
        raw: trimBlockText(currentLines),
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const match = matchHeading(line);

    if (match) {
      flushCurrent();
      currentKey = match.key;
      currentHeadingText = match.headingText;
      continue;
    }

    if (currentKey) {
      currentLines.push(line);
    } else {
      leadingLines.push(line);
    }
  }

  flushCurrent();

  return {
    sections,
    leadingText: trimBlockText(leadingLines),
  };
}
