import { createHash } from "crypto";

/*
  Deterministic content hashing shared by the Recommended Jobs and
  Analytics caches. Always computed server-side from data the server
  itself queried - never from a client-supplied hash or client-supplied
  copies of the underlying data.

  canonicalize() recursively sorts object keys so that column order
  returned by a query, JSON.stringify's own key-insertion-order behavior,
  and incidental whitespace can never produce a different hash for
  semantically identical data. Arrays are NOT reordered here - callers
  that want order-independence (e.g. an unordered skills list) must sort
  the array themselves before passing it in; order-meaningful arrays
  (e.g. work history) must be left as-is, since reordering those would
  hide a real content change.
*/
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    const sortedKeys = Object.keys(
      value as Record<string, unknown>
    ).sort();

    const result: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      result[key] = canonicalize(
        (value as Record<string, unknown>)[key]
      );
    }

    return result;
  }

  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("hex");
}

/*
  Minimal normalization for freeform text content (resume text, etc.):
  trims leading/trailing whitespace and collapses internal \r\n / \r to
  \n. Deliberately does NOT collapse repeated whitespace, blank lines, or
  re-wrap text - those can be meaningful formatting in a resume, and this
  hash's whole purpose is to detect real content edits, not to be
  maximally insensitive to formatting.
*/
export function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function hashContent(value: unknown): string {
  return sha256Hex(canonicalJsonString(value));
}
