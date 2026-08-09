/*
  Phase 6I.6.22 - the ONE authoritative Canada job-scope policy, reused
  by Paste Job's Analyze Job step, the legacy Generate Package worker,
  and the canonical Generate Package dispatch path. See this phase's
  own audit (final report) for the exact bug this closes: canonical
  never called legacy's validateCanadianScope() at all (its own AI
  tailoring response has no jobContext field, and normalizePackageAnalysis()
  silently defaults one in) - a job explicitly restricted to another
  country could reach real AI generation through the canonical routing
  choice while being correctly blocked through the legacy one.

  Deliberately a PURE, deterministic function over the raw job posting
  text - not a new/separate OpenAI call (Part P), and not dependent on
  either engine's own AI response shape (avoids re-opening either
  prompt's contract, which the canonical tailoring response in
  particular has no room for without a real schema change - see
  canonicalGeneratePackageService.ts's own comment on why it doesn't
  re-run this classification today). Both legacy (job_description /
  manifest.originalText) and canonical (jobText, the same request-time
  field) already have the exact same raw text available before either
  engine's own AI call, so this can run - and gate - BEFORE either one,
  which also satisfies "UNSUPPORTED -> zero OpenAI invocations."

  Exactly 3 states (Part B) - never collapsed to boolean. UNKNOWN is a
  first-class outcome, never conflated with UNSUPPORTED (Part B/H): most
  real postings are ambiguous enough ("Remote", employer identity not
  stated) that treating "can't tell" as "reject" would falsely block a
  large share of genuinely-Canadian remote postings.

  Evidence hierarchy (Part E/C-CASE10): explicit ELIGIBILITY RESTRICTION
  language ("US residents only", "Remote - Canada", "not available in
  Canada", etc.) is checked FIRST and is decisive - it overrides a mere
  location/employer mention found elsewhere in the same text (Part C
  CASE 10's own conflicting-evidence example: metadata says Toronto,
  body says "US residents only" -> UNSUPPORTED). Only when no explicit
  restriction language is present does this fall back to weaker
  location/employer-mention evidence (Canadian province/territory/city/
  "Canadian company" phrasing vs. a foreign country/city with no Canada
  evidence anywhere). Bare "Remote"/"Global"/"North America" alone is
  never itself decisive in either direction (Part F/P's own explicit
  examples) - it falls through to UNKNOWN.
*/
import { provinces } from "../job-search/provinces";

export type CanadaScopeStatus = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export type CanadaScopeClassification = {
  status: CanadaScopeStatus;
  reason: string;
  evidence: string[];
};

/*
  Explicit restriction/eligibility phrasing - Tier 1, decisive. Kept as
  literal phrase lists (not a general regex/NLP parser) so behavior is
  fully deterministic and directly traceable to the phase's own CASE 1-
  10 examples; extend this list rather than generalizing the matcher if
  a genuinely new phrasing needs covering later.
*/
const CANADA_INCLUSION_RESTRICTION_PHRASES = [
  "remote - canada",
  "remote canada",
  "remote (canada)",
  "canada-wide",
  "canada wide",
  "anywhere in canada",
  "canadian residents",
  "canadian applicants only",
  "canada only",
  "candidates must reside in canada",
  "candidates must be based in canada",
  "must be located in canada",
  "must be authorized to work in canada",
  "must be eligible to work in canada",
  "authorized to work in canada",
  "eligible to work in canada",
  "open to canadian applicants",
  "canadian residents nationwide",
  "work from anywhere in canada",
];

const NON_CANADA_EXCLUSION_RESTRICTION_PHRASES = [
  "us residents only",
  "u.s. residents only",
  "united states residents only",
  "us only",
  "u.s. only",
  "remote - us only",
  "remote us only",
  "us applicants only",
  "us-based candidates only",
  "us based candidates only",
  "must be authorized to work in the united states",
  "must be authorized to work in the us",
  "must be authorized to work in the u.s.",
  "authorized to work in the united states",
  "authorized to work in the us",
  "eligible to work in the united states",
  "not available in canada",
  "not open to canada",
  "unavailable in canada",
  "position available only to us residents",
  "candidates must reside in the united states",
  "candidates must be based in the united states",
  "uk residents only",
  "u.k. residents only",
  "must be eligible to work in the uk",
  "must be authorized to work in the uk",
  "authorized to work in the united kingdom",
];

/* Tier 2 - weaker location/employer-mention evidence, used only when no Tier 1 phrase is present anywhere in the text. */
const CANADIAN_PROVINCES_AND_TERRITORIES = provinces.Canada;

const CANADIAN_CITIES = [
  "toronto", "vancouver", "montreal", "montréal", "calgary", "ottawa", "edmonton",
  "winnipeg", "quebec city", "hamilton", "kitchener", "victoria", "halifax",
  "saskatoon", "regina", "st. john's", "st johns", "charlottetown", "fredericton",
  "moncton", "whitehorse", "yellowknife", "iqaluit", "burnaby", "surrey",
  "mississauga", "brampton", "markham", "vaughan", "gatineau", "laval",
  "windsor", "oshawa", "barrie", "kelowna", "abbotsford", "sudbury", "kingston",
  "thunder bay", "waterloo",
];

const CANADIAN_EMPLOYER_PHRASES = [
  "canadian company", "canadian employer", "canadian subsidiary", "canadian branch",
  "canadian office", "canadian entity", "canadian business", "canadian organization",
  "canadian corporation", "canada office", "canada inc.", "canada inc",
  "our canada team", "our canadian team", "canada-based", "canada based",
];

const FOREIGN_COUNTRY_MARKERS = [
  "united states", "u.s.a.", "usa", "u.s.", "united kingdom", "south korea",
  "north korea", "germany", "france", "australia", "india", "ireland",
  "new zealand", "singapore", "japan", "china", "mexico", "brazil",
  "philippines", "netherlands", "spain", "italy",
];

/*
  Distinct from FOREIGN_COUNTRY_MARKERS: matched with word boundaries
  only (see matchesAnyWordBoundary below), not substring, since these
  are short enough to otherwise false-positive inside other words. Bare
  "us" is deliberately NOT included here even as a whole word - it is
  the ordinary English pronoun ("join us", "contact us", "about us") far
  more often than it is short for "United States" in real job-posting
  prose, and Tier 1's own exclusion phrase list already covers every
  genuine "US"-meaning restriction ("us residents only", "us only",
  etc.) without this ambiguity. FOREIGN_COUNTRY_MARKERS below still
  covers the unambiguous "united states"/"usa"/"u.s."/"u.s.a." forms.
*/
const FOREIGN_COUNTRY_ABBREVIATIONS = ["uk"];

const FOREIGN_CITIES = [
  "new york", "london", "seoul", "berlin", "paris", "sydney", "melbourne",
  "dublin", "singapore city", "tokyo", "beijing", "shanghai", "mumbai",
  "delhi", "mexico city", "sao paulo", "são paulo", "manila", "amsterdam",
  "madrid", "rome", "chicago", "los angeles", "san francisco", "boston",
  "seattle", "austin", "atlanta", "denver", "miami",
];

/*
  Strips accents (Québec -> Quebec, Montréal -> Montreal) and collapses
  em/en-dashes to a plain hyphen so "Remote — Canada" matches the same
  phrase list entry as "Remote - Canada" - without this, a bilingual/
  French-Canadian posting or a smart-typography dash would silently miss
  otherwise-identical phrase matches (Part N's own French-posting/
  territories regression requirement).
*/
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―]/g, "-")
    .toLowerCase();
}

function matchesAny(normalizedText: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => normalizedText.includes(phrase));
}

function matchesAnyWordBoundary(normalizedText: string, words: string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalizedText));
}

export function classifyCanadaJobScope(jobText: string): CanadaScopeClassification {
  const text = String(jobText ?? "");
  const normalized = normalize(text);

  if (!normalized.trim()) {
    return { status: "UNKNOWN", reason: "No job posting text was provided to evaluate location/eligibility.", evidence: [] };
  }

  // ==================== Tier 1 - explicit eligibility restriction language (decisive, checked first) ====================
  const inclusionRestrictions = matchesAny(normalized, CANADA_INCLUSION_RESTRICTION_PHRASES);
  const exclusionRestrictions = matchesAny(normalized, NON_CANADA_EXCLUSION_RESTRICTION_PHRASES);

  if (inclusionRestrictions.length > 0 && exclusionRestrictions.length > 0) {
    return {
      status: "UNKNOWN",
      reason: "The posting contains conflicting eligibility statements (both Canada-inclusive and non-Canada-exclusive language) that cannot be reliably resolved.",
      evidence: [...inclusionRestrictions, ...exclusionRestrictions],
    };
  }

  if (exclusionRestrictions.length > 0) {
    return {
      status: "UNSUPPORTED",
      reason: "The posting explicitly restricts eligibility to a location other than Canada.",
      evidence: exclusionRestrictions,
    };
  }

  if (inclusionRestrictions.length > 0) {
    return {
      status: "SUPPORTED",
      reason: "The posting explicitly states Canada-wide or Canadian-resident eligibility.",
      evidence: inclusionRestrictions,
    };
  }

  // ==================== Tier 2 - location/employer-mention evidence ====================
  const canadaProvinceMatches = matchesAny(normalized, CANADIAN_PROVINCES_AND_TERRITORIES.map((p) => p.toLowerCase()));
  const canadaCityMatches = matchesAny(normalized, CANADIAN_CITIES);
  const canadaCountryMatch = matchesAnyWordBoundary(normalized, ["canada", "canadian"]);
  const canadaEmployerMatches = matchesAny(normalized, CANADIAN_EMPLOYER_PHRASES);
  const canadaEvidence = [...canadaProvinceMatches, ...canadaCityMatches, ...canadaCountryMatch, ...canadaEmployerMatches];

  if (canadaEvidence.length > 0) {
    return {
      status: "SUPPORTED",
      reason: "The posting mentions a Canadian location, province/territory, or Canadian hiring entity.",
      evidence: Array.from(new Set(canadaEvidence)),
    };
  }

  const foreignCountryMatches = matchesAny(normalized, FOREIGN_COUNTRY_MARKERS);
  const foreignAbbrevMatches = matchesAnyWordBoundary(normalized, FOREIGN_COUNTRY_ABBREVIATIONS);
  const foreignCityMatches = matchesAny(normalized, FOREIGN_CITIES);
  const foreignEvidence = [...foreignCountryMatches, ...foreignAbbrevMatches, ...foreignCityMatches];

  if (foreignEvidence.length > 0) {
    return {
      status: "UNSUPPORTED",
      reason: "The posting names a physical location outside Canada with no Canadian eligibility evidence found anywhere in the text.",
      evidence: Array.from(new Set(foreignEvidence)),
    };
  }

  return {
    status: "UNKNOWN",
    reason: "The posting's location and hiring entity could not be reliably determined as Canadian or non-Canadian from the available text.",
    evidence: [],
  };
}

/*
  Part H's actual gate: SUPPORTED and UNKNOWN both allow generation to
  proceed - only UNSUPPORTED blocks it. Kept as its own tiny function
  (rather than inlining `!== "UNSUPPORTED"` at every call site) so the
  "UNKNOWN is allowed" decision is named and impossible to accidentally
  invert at any one of the call sites.
*/
export function isCanadaScopeGenerationAllowed(status: CanadaScopeStatus): boolean {
  return status !== "UNSUPPORTED";
}

/*
  Part Q's user-facing message - fixed text, never includes internal
  reason/evidence strings (those are for logs/tests only, never surfaced
  to the end user).
*/
export const CANADA_SCOPE_UNSUPPORTED_MESSAGE =
  "Career Élan currently supports jobs available to applicants in Canada.";
