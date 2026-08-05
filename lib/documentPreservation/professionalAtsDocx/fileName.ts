/*
  TASK 3 - Deterministic, path-traversal-safe DOCX filename. Mirrors
  professionalAtsPdf/fileName.ts's own convention (NFKD slugify, safe
  fallback, CRLF/control-char hardening for a server-set
  Content-Disposition header) as a genuinely separate function, not an
  import - Phase 5B is required to not modify any Phase 5A file, and a
  shared cross-format helper is explicitly out of scope for this round
  (spec section 13: "Phase 5A 파일은 수정하지 않고... DOCX 전용 helper를
  구현한다").
*/
const MAX_BASE_LENGTH = 80;
const FALLBACK_BASE = "resume";
const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildDocxFileName(applicantName: string | null | undefined, paperSize: string, templateId: string): string {
  const slug = slugify(applicantName ?? "");
  const base = (slug.length > 0 ? slug : FALLBACK_BASE).slice(0, MAX_BASE_LENGTH).replace(/-+$/, "") || FALLBACK_BASE;
  return `${base}_${templateId}_${paperSize}_resume.docx`;
}
