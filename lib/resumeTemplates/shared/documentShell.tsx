/*
  Phase 6F - shared HTML document shell for the 3 NEW templates' HTML
  renderers. React's renderToStaticMarkup only produces the markup for
  the element tree it's given (no <!DOCTYPE>/<html>/<head>) - this
  wraps that markup into a complete, standalone HTML document once,
  instead of each template re-writing the same doctype/meta/style
  boilerplate.
*/
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderHtmlDocument(opts: { lang: string; title: string; styleText: string; bodyHtml: string }): string {
  return `<!DOCTYPE html><html lang="${escapeHtml(opts.lang)}"><head><meta charset="utf-8" /><title>${escapeHtml(opts.title)}</title><style>${opts.styleText}</style></head><body>${opts.bodyHtml}</body></html>`;
}
