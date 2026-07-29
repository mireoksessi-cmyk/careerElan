import type { ParsedExperienceEntry } from "./types";

/*
  PoC best-effort splitter for a single "Experience"/"Volunteer" section's
  raw body into per-role entries (jobTitle/company/dates/description).
  Explicitly NOT a general-purpose resume parser - a fixed two-line
  header convention ("Job Title" line + "Company ... dates" line, in
  either order) is the only shape it ever recognizes. Anything that
  doesn't match that shape with high confidence is returned unsplit
  (`structured: false`, `raw` = the original block verbatim) rather than
  guessed at - per instruction, uncertain cases must never be forced.
*/

const MONTHS =
  "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";
const MONTH_YEAR = `${MONTHS}\\.?\\s+\\d{4}`;
const YEAR = `(19|20)\\d{2}`;
const DATE_TOKEN = `(?:${MONTH_YEAR}|${YEAR}|present|current)`;
const DATE_RANGE_RE = new RegExp(
  `${DATE_TOKEN}\\s*(?:–|—|-|to)\\s*${DATE_TOKEN}`,
  "i"
);

// Fix 2: real Generate Package output frequently emits a single ISO
// "YYYY-MM" date (e.g. current-employment "2021-02") with no range at
// all. This is a separate, narrower fallback token used only when
// DATE_RANGE_RE finds no range - it must never change range parsing.
const ISO_YEAR_MONTH = `(19|20)\\d{2}-(0[1-9]|1[0-2])`;
const SINGLE_DATE_TOKEN = `(?:${ISO_YEAR_MONTH}|${MONTH_YEAR}|${YEAR}|present|current)`;
const SINGLE_DATE_RE = new RegExp(SINGLE_DATE_TOKEN, "i");

function looksLikeBulletLine(line: string): boolean {
  return /^\s*[-•*]\s+/.test(line);
}

function extractDateRange(line: string): string | null {
  const match = line.match(DATE_RANGE_RE);
  return match ? match[0].trim() : null;
}

function extractSingleDate(line: string): string | null {
  const match = line.match(SINGLE_DATE_RE);
  return match ? match[0].trim() : null;
}

function splitOnSeparator(line: string): string[] | null {
  const separators = [" — ", " – ", " | ", ", "];

  for (const sep of separators) {
    if (line.includes(sep)) {
      const parts = line
        .split(sep)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length >= 2) return parts;
    }
  }

  return null;
}

function splitIntoBlocks(raw: string): string[] {
  return raw
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseSingleEntry(block: string): ParsedExperienceEntry {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { raw: block, structured: false };
  }

  const [lineA, lineB] = lines;
  const rest = lines.slice(2);

  // A block whose very first line is already a bullet is a continuation
  // of the previous entry (or a flat bullet list with no per-role
  // header at all) - never treat it as a new title/company header. Same
  // for the second line: if it's a bullet too, there is only ONE real
  // header line (e.g. "Title | Company | Date" followed directly by
  // bullets with no blank line) - never mistake a bullet for company/title.
  if (looksLikeBulletLine(lineA) || looksLikeBulletLine(lineB)) {
    return { raw: block, structured: false };
  }

  const dateInA = extractDateRange(lineA);
  const dateInB = extractDateRange(lineB);

  // No date range found on either header line, or found on BOTH
  // (ambiguous - can't tell which is the real "company + dates" line) -
  // too uncertain to split safely.
  if (dateInA && dateInB) {
    return { raw: block, structured: false };
  }

  let titleLine: string;
  let company: string;
  let dates: string;

  if (dateInA || dateInB) {
    // Existing convention (unchanged): the line WITH the date range is
    // "Company ... dates"; the other line is the job title.
    const dateLine = dateInA ? lineA : lineB;
    titleLine = dateInA ? lineB : lineA;
    dates = (dateInA || dateInB) as string;

    const remainder = dateLine.replace(dates, "").trim();
    const companyParts = splitOnSeparator(remainder);
    company = (companyParts ? companyParts[0] : remainder)
      .replace(/[|,\-–—]+$/, "")
      .trim();
  } else {
    // Fix 2: no full range on either line - fall back to a single date
    // token (e.g. "2021-02" for an ongoing/current role, no end date).
    // Real output pairs the single date directly with the JOB TITLE
    // ("Senior Engineer | 2021-02"), the opposite of the range
    // convention above, so title/company come from the opposite lines.
    const singleInA = extractSingleDate(lineA);
    const singleInB = extractSingleDate(lineB);

    if (!singleInA && !singleInB) {
      return { raw: block, structured: false };
    }
    if (singleInA && singleInB) {
      return { raw: block, structured: false };
    }

    const titleDateLine = singleInA ? lineA : lineB;
    const companyLine = singleInA ? lineB : lineA;
    dates = (singleInA || singleInB) as string;

    const remainder = titleDateLine.replace(dates, "").trim();
    const titleParts = splitOnSeparator(remainder);
    titleLine = (titleParts ? titleParts[0] : remainder)
      .replace(/[|,\-–—]+$/, "")
      .trim();
    company = companyLine.replace(/[|,\-–—]+$/, "").trim();
  }

  if (!titleLine || !company) {
    return { raw: block, structured: false };
  }

  return {
    raw: block,
    structured: true,
    jobTitle: titleLine,
    company,
    dates,
    description: rest.join("\n"),
  };
}

function hasAnyBulletLine(block: string): boolean {
  return block
    .split(/\r?\n/)
    .some((line) => looksLikeBulletLine(line.trim()));
}

function isAllBulletLines(block: string): boolean {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => looksLikeBulletLine(line));
}

// Fix 1: real Generate Package output sometimes puts a blank line between
// a "Company \n Title | Dates" header and its bullet list, which
// splitIntoBlocks (splitting on blank lines) turns into two separate
// blocks. If a header block has zero bullets and is immediately followed
// by a bullet-only block, merge them back into one block before parsing -
// verbatim text concatenation only, no content is altered.
function mergeHeaderOnlyBlocksWithFollowingBullets(blocks: string[]): string[] {
  const merged: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const current = blocks[i];
    const next = blocks[i + 1];
    if (next !== undefined && !hasAnyBulletLine(current) && isAllBulletLines(next)) {
      merged.push(`${current}\n\n${next}`);
      i += 2;
    } else {
      merged.push(current);
      i += 1;
    }
  }
  return merged;
}

export function parseExperienceEntries(sectionRaw: string): ParsedExperienceEntry[] {
  const blocks = mergeHeaderOnlyBlocksWithFollowingBullets(splitIntoBlocks(sectionRaw));
  return blocks.map(parseSingleEntry);
}
