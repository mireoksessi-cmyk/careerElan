/*
  Derives a display header (name + contact lines) from DocumentIR's
  leadingText - the text that appeared before the first recognized
  section heading. Real Generate Package resume_text consistently opens
  with the applicant's name on its own line, followed by one or more
  contact lines (location, phone, email, LinkedIn) before the first
  section heading (e.g. "PROFESSIONAL SUMMARY").

  This is presentation-layer derivation only - it does not change how
  sectionParser.ts/experienceParser.ts split resume_text into sections,
  and it never discards leadingText itself; buildDocumentIRFromText's
  callers can still fall back to rendering the raw leadingText verbatim
  (as components/brand/BrandedResumeTextPreview.tsx already does) if the
  derived header looks wrong for a given input - deriveResumeHeader only
  offers a best-effort structured view of the same untouched text.
*/

export type ResumeHeader = {
  name: string;
  contactLines: string[];
};

export function deriveResumeHeader(leadingText: string): ResumeHeader {
  const lines = (leadingText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { name: "", contactLines: [] };
  }

  const [name, ...rest] = lines;
  return { name, contactLines: rest };
}
