/*
  Shared Skills-section text splitting, used by both the React preview
  (components/brand/BrandedResumeTextPreview.tsx) and the production
  DocumentIR renderers (lib/brand/render/*). Extracted verbatim from
  BrandedResumeTextPreview.tsx so both call sites share one implementation
  instead of duplicating it - no behavior change from the version that
  was already exercised in the Generate Package format-standardization
  work (category-label stripping, atomic multi-word skill preservation).
*/

// Strips a short "Category Label:" prefix (inline or standalone line,
// e.g. "Technical & Data Tools: SQL, Python") before splitting - the
// label itself is not a skill, but whatever follows the colon still
// parses normally through the split below.
function stripSkillCategoryLabels(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      // Strip a leading "- "/"• " bullet marker first - some sources
      // (uploaded resumes, edge-case formatting) write one skill per
      // bulleted line rather than comma/newline-separated. Renderers add
      // their own bullet marker when displaying each skill, so a source
      // bullet left in place would otherwise double up ("- - Excel").
      const bulletStripped = line.trim().replace(/^[-•]\s+/, "");
      const labelMatch = bulletStripped.match(/^([A-Za-z0-9 &/'-]{2,40}):\s*(.*)$/);
      return labelMatch ? labelMatch[2] : bulletStripped;
    })
    .join("\n");
}

export function splitSkillsText(text: string): string[] {
  return stripSkillCategoryLabels(text)
    .split(/\r?\n|,|•/)
    .map((skill) => skill.trim().replace(/^[-•]\s+/, ""))
    .filter(Boolean);
}
