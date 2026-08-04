/*
  TASK 3 - Deterministic, path-traversal-safe PDF filename. No existing
  reusable helper exists for this: app/paste-job/page.tsx's own
  sanitizeFileName() is a private, module-local function used only for
  a client-side <a download> attribute (no path-traversal exposure
  there, since the browser owns the actual save location) - not
  exported, and not a fit for a server-set Content-Disposition header
  value, which DOES need CRLF/control-character hardening even though
  it never touches a real filesystem path in this dev-only renderer.
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

export function buildPdfFileName(applicantName: string | null | undefined, paperSize: string, templateId: string): string {
  const slug = slugify(applicantName ?? "");
  const base = (slug.length > 0 ? slug : FALLBACK_BASE).slice(0, MAX_BASE_LENGTH).replace(/-+$/, "") || FALLBACK_BASE;
  return `${base}_${templateId}_${paperSize}_resume.pdf`;
}
