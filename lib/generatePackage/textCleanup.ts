/*
  Pure, dependency-free text post-processing for AI-generated documents -
  deliberately has zero imports (not even from ./shared, which pulls in the
  "openai" package for its error-classification types) so this module is
  safe to import from a "use client" component (e.g. Job Tracker's own
  direct Supabase read) without bundling server-only/AI-SDK code into the
  client. lib/generatePackage/shared.ts re-exports both functions below so
  every existing "./shared" import (generateCore.ts, the status route, the
  generate-package route's idempotent-replay branch) keeps working
  unchanged - this file is the single source of truth for the actual
  logic, never duplicated.
*/

/* =========================================================
   Shared contact-field primitives
========================================================= */

function isPhoneOnlySegment(segment: string): boolean {
  const stripped = segment.replace(/^(phone|tel|mobile|cell)\s*:?\s*/i, "");
  if (!stripped) return false;
  if (!/^[\d+\-.() \t]+$/.test(stripped)) return false;
  const digitCount = stripped.replace(/[^\d]/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

function isEmailOnlySegment(segment: string): boolean {
  const stripped = segment.replace(/^e-?mail\s*:?\s*/i, "");
  return /^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/i.test(stripped);
}

function isPostalCodeSegment(segment: string): boolean {
  // Canadian (A1A 1A1) or US ZIP (12345 / 12345-6789) - the two formats
  // most likely to appear given this app's Canadian job-market focus.
  // Deliberately not exhaustive of every country's postal format; a
  // postal code in some other format still gets caught by the more
  // general looksLikeAddressOrRegionLine() check below when it appears
  // alongside a city/region on the same line.
  return (
    /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(segment) ||
    /^\d{5}(-\d{4})?$/.test(segment)
  );
}

function isStreetAddressSegment(segment: string): boolean {
  // "123 Main St", "45 Oak Avenue Apt 2" - a leading street number is the
  // one reasonably unambiguous street-address signal available without a
  // full address-parsing library.
  return /^\d+\s+\S/.test(segment);
}

// Words that show up in ordinary cover-letter prose, never in a genuine
// "City, Region[, Country]" line - a cheap guard against misreading a
// short personal-branding sentence (e.g. "Detail-oriented, driven
// professional") as an address just because it happens to contain commas.
const PROSE_LIKE_WORDS =
  /\b(experience|professional|years?|skill|position|role|team|opportunit|attached|resume|cover letter|dear|sincerely|regards|manager|company|organi[sz]ation|driven|dedicated|motivated|passionate)\b/i;

/*
  Country-agnostic "does this line look like a city/region/country
  address line" check - deliberately never limited to a fixed country
  list (an earlier Canada-only version of this function missed real
  addresses like "Pyeongtaek-si, Gyeonggi-do, South Korea" and
  "North York, ON M2N 5T2", the exact two shapes that motivated this
  rewrite). Safe to be this permissive only because every call site below
  scopes it to a narrow window (the few lines directly under an
  applicant's name, before the first blank line or greeting) - never the
  recipient block or body.
*/
function looksLikeAddressOrRegionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 70) return false;
  if (PROSE_LIKE_WORDS.test(trimmed)) return false;

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    // "City, Province/State[, Country]" - short, comma-separated,
    // non-sentence segments (an address's parts are city/region/country
    // names, never full clauses).
    return parts.every(
      (part) =>
        part.length <= 40 &&
        part.split(/\s+/).length <= 5 &&
        !/[.!?]$/.test(part)
    );
  }

  // No comma - could still be a bare postal code or a bare street address.
  return isPostalCodeSegment(trimmed) || isStreetAddressSegment(trimmed);
}

/* =========================================================
   Email Draft signature contact stripping

   The AI is not instructed one way or the other on whether to include a
   phone number/email under the closing signature, and does so
   inconsistently. Product decision: the final closing block should be
   "Sincerely, <name>" only - phone/email belong on the resume and cover
   letter, not repeated in every email draft. This only ever touches the
   trailing signature block (the contiguous run of lines immediately after
   the detected closing+name, at the very end of the document) - a phone
   number or email mentioned earlier in the body (e.g. "you can reach my
   reference at ...") is never touched, since the scan never looks there.
========================================================= */

const EMAIL_SIGNATURE_CLOSING_RE =
  /^(sincerely|best regards|kind regards|warm regards|regards|respectfully|thank you)[,.]?\s*$/i;

function isContactOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const segments = trimmed
    .split(/[|·]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        isPhoneOnlySegment(segment) || isEmailOnlySegment(segment)
    )
  );
}

export function stripEmailSignatureContact(emailDraft: string): string {
  const lines = emailDraft.split("\n");

  let closingIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (EMAIL_SIGNATURE_CLOSING_RE.test(lines[i].trim())) {
      closingIdx = i;
      break;
    }
  }

  // No recognizable closing found - nothing safe to strip. Never guesses.
  if (closingIdx === -1) return emailDraft;

  let nameIdx = -1;

  for (let i = closingIdx + 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      nameIdx = i;
      break;
    }
  }

  // Closing with nothing after it (no name line) - leave as-is.
  if (nameIdx === -1) return emailDraft;

  let cutoff = lines.length;

  for (let i = lines.length - 1; i > nameIdx; i--) {
    const trimmed = lines[i].trim();

    if (trimmed && !isContactOnlyLine(trimmed)) {
      break;
    }

    cutoff = i;
  }

  return lines.slice(0, cutoff).join("\n").trimEnd();
}

/* =========================================================
   Cover Letter contact block stripping

   Same product decision as the Email Draft signature above, applied to
   the opposite end of the document: the applicant's own contact block
   directly under their name at the very top. Scoped narrowly - only the
   contiguous, contact-shaped lines immediately after the name, stopping
   at the first blank line (or the first line that doesn't look like
   contact info) - so the recipient block (company name/address) that
   normally follows a blank line further down, and any company/location
   mention in the body, are never reached by the scan and therefore never
   touched.
========================================================= */

function isPersonalContactLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const segments = trimmed
    .split(/[|·]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const allSegmentsAreContactFields =
    segments.length > 0 &&
    segments.every(
      (segment) =>
        isPhoneOnlySegment(segment) ||
        isEmailOnlySegment(segment) ||
        isPostalCodeSegment(segment)
    );

  if (allSegmentsAreContactFields) return true;

  return looksLikeAddressOrRegionLine(trimmed);
}

/*
  Handles contact info appended to the SAME line as the name (e.g.
  "Young Jun Kwak, 437-449-1513, young@example.com" or
  "Young Jun Kwak | 437-449-1513"). Only ever keeps the first segment and
  drops the rest, and only when every remaining segment is unambiguously
  a phone/email/postal field - a name written "Last, First" (e.g.
  "Kwak, Young Jun") is safe because "Young Jun" matches none of those
  patterns, so the line is left untouched.
*/
function splitNameLineFromContact(line: string): string {
  for (const delimiter of [/\s*\|\s*/, /\s*·\s*/, /,\s*/]) {
    const segments = line
      .split(delimiter)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length < 2) continue;

    const [first, ...rest] = segments;

    if (
      rest.length > 0 &&
      rest.every(
        (segment) =>
          isPhoneOnlySegment(segment) ||
          isEmailOnlySegment(segment) ||
          isPostalCodeSegment(segment)
      )
    ) {
      return first;
    }
  }

  return line;
}

export function stripCoverLetterContactBlock(coverLetter: string): string {
  const lines = coverLetter.split("\n");

  let nameIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      nameIdx = i;
      break;
    }
  }

  // Nothing but blank lines - nothing to do.
  if (nameIdx === -1) return coverLetter;

  const originalNameLine = lines[nameIdx].trim();
  const cleanedNameLine = splitNameLineFromContact(originalNameLine);

  let endIdx = nameIdx + 1;

  for (let i = nameIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // A blank line ends the header block - whatever comes after (date,
    // recipient block, body) is a separate section and is never scanned.
    if (!trimmed) break;

    // The first line that doesn't look like contact info stops the scan
    // immediately, preserving it and everything after it untouched.
    if (!isPersonalContactLine(trimmed)) break;

    endIdx = i + 1;
  }

  const nameLineChanged = cleanedNameLine !== originalNameLine;

  // Nothing matched right after the name, and the name line itself had no
  // same-line contact info to strip - unchanged.
  if (endIdx === nameIdx + 1 && !nameLineChanged) return coverLetter;

  const resultLines = [...lines];
  resultLines[nameIdx] = cleanedNameLine;

  return [
    ...resultLines.slice(0, nameIdx + 1),
    ...resultLines.slice(endIdx),
  ].join("\n");
}
