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

  Phase 6F.1 - real-resume hardening found a second, generic gap in the
  same function: React's own server renderer (renderToStaticMarkup)
  escapes a literal apostrophe as the HEX numeric entity "&#x27;", not
  the decimal form "&#39;" - confirmed via direct isolated-render
  reproduction (any text node containing a straight apostrophe, e.g.
  any English possessive/contraction like "company's", produces
  "&#x27;" in the raw HTML). The decimal-only regex below never matched
  it, so the literal 6-character string "&#x27;" survived into the
  "extracted" text instead of decoding back to a single "'", breaking
  substring containment against the expected fragment (which still has
  the real apostrophe). Not resume-specific - this affects any resume
  whose prose contains an apostrophe, which is most English text.
*/
const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = isHex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

export function extractVisibleTextFromHtml(html: string): string {
  const withoutStyleScript = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  const withoutTags = withoutStyleScript.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}
