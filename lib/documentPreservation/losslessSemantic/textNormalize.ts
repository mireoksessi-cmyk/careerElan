/*
  Section 6 of the spec - normalization allowed ONLY for the purpose of
  alias-dictionary matching, never applied to originalHeading/rawText
  themselves (those stay verbatim - see types.ts). Every transform here
  is reversible-information-preserving in the sense that it never
  changes WHICH alias a heading matches based on anything but
  formatting - no spelling correction, no synonym substitution.
*/
export function normalizeHeadingForMatching(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[.,:;!?'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
