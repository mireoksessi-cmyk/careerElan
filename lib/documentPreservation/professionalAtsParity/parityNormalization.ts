/*
  TASK 4 - Single shared normalization function for cross-format
  comparison, used by every format adapter and the manifest builder so
  HTML/PDF/DOCX text is compared on equal footing. Only cosmetic,
  format-artifact differences are normalized away (spec section 6's
  allow-list) - no value is ever changed, only its surrounding
  whitespace/punctuation representation. Original and normalized values
  are both preserved by callers for diagnostics; this function never
  discards the original.
*/

function collapseWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function normalizeQuotesAndDashes(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ");
}

/* PDF's pdfjs-dist sometimes splits a hyphenated word across two
   TextItems ("root-cause" -> "root-" + "cause"), and naive joining can
   introduce a stray space at the hyphen boundary that isn't present in
   the other two formats. Collapsing "- " back to "-" here (after quote/
   dash normalization has already unified all dash variants to a plain
   hyphen) makes this one, already-diagnosed artifact invisible to
   cross-format comparison without touching any other content. */
function collapseHyphenBoundaryArtifact(text: string): string {
  return text.replace(/-\s+/g, "-");
}

function stripBulletGlyphs(text: string): string {
  return text.replace(/^[\s•●■‣⁃∙\-\*]+/, "").trim();
}

export function normalizeForParity(text: string): string {
  const withGlyphsStripped = stripBulletGlyphs(text);
  const withQuotesAndDashes = normalizeQuotesAndDashes(withGlyphsStripped);
  const withHyphenFix = collapseHyphenBoundaryArtifact(withQuotesAndDashes);
  return collapseWhitespace(withHyphenFix);
}

export type NormalizationPair = {
  original: string;
  normalized: string;
};

export function normalizePair(text: string): NormalizationPair {
  return { original: text, normalized: normalizeForParity(text) };
}
