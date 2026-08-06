/*
  Phase 6F - strips an HTML document down to its rendered, decoded
  VISIBLE text. Bug found via this round's own real-PDF/HTML generation
  run: each template's HTML self-validation was comparing expected
  fragments against the RAW HTML markup string (tags + HTML-entity-
  encoded characters like "&amp;") instead of the text a reader/PDF-
  extractor actually sees - any expected fragment containing "&" (e.g.
  "P&L Ownership") could never match "P&amp;L Ownership" in the raw
  markup. This is the one place that conversion happens, reused by all
  3 new templates' renderXxxHtml() validation step.
*/
const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#39|amp|lt|gt|quot|apos|nbsp|#(\d+));/g, (match, entity) => {
    if (entity.startsWith("#") && entity !== "#39") {
      const codePoint = Number(entity.slice(1));
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

export function extractVisibleTextFromHtml(html: string): string {
  const withoutStyleScript = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  const withoutTags = withoutStyleScript.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}
