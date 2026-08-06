/*
  Phase 5D.2A - Organization/Location Boundary Hardening. A single,
  general-purpose helper shared by every extractor that needs to split
  an "Organization <separator> Location" style text run - it does not
  know or care which resume produced the text. Real evidence: a private
  entry-level resume's "Liberal Party of Canada ON office － Toronto,
  ON" was being mis-split by the pre-existing comma-only logic
  (organization ended up with "－ Toronto" glued on, location became
  the bare province code "ON") because that logic never looked for a
  dash-style separator at all - only for a leading comma.

  This module adds exactly one new capability on top of the existing,
  proven comma-based "Company, City, ST" split: recognizing a DASH
  (of any of the 6 supported Unicode forms) as an organization/location
  boundary, but ONLY when the text after that dash independently looks
  like a real location (see looksLikeLocation below). When nothing
  after any dash looks like a location, the text is left untouched by
  this step and falls through to the pre-existing comma-only behavior,
  which is unchanged.

  Phase 5D.4A - Generic Inline Composite Institution/Organization
  Boundary Hardening. Real evidence: a Phase 5D.4 QA negative-control
  case, "Example University | San Francisco, California, USA" (a
  3-part "City, Province, Country" location), was corrupted because
  looksLikeLocation only ever inspected commaParts[1] under a
  commaParts.length===2 gate - a 3-part location failed that gate, fell
  through to splitOnTrailingComma's unconditional split of the WHOLE
  original string (still containing the pipe character), and produced
  institution="Example University | San Francisco" (pipe glued in) and
  location="California, USA" (wrong, missing "San Francisco"). Fixed by
  generalizing the gate to accept any comma-part count while judging
  only the trailing qualifier - see looksLikeLocation below. Still
  shape-only: no city/institution/company name, no country dictionary
  beyond the pre-existing closed set, no whitelist/blacklist.
*/

/*
  Every dash-like character this module treats as a candidate
  organization/location separator - the same six forms
  dateRangeParsing.ts already hardened date ranges against (Phase
  5D.1), reused here for the same real-fixture reason: exports from
  different word processors use different Unicode dashes for the same
  visual "-". Deliberately excludes the word "to" (a date-range
  concept, not applicable to organization/location boundaries) and the
  comma (handled separately, by the pre-existing logic below).
*/
const DASH_SEPARATOR_RE = "(?:-|–|—|‒|―|－)";

/*
  A general reference set of country names/abbreviations - the same
  kind of general, non-resume-specific dictionary MONTH_RE already is
  for dates (dateRangeParsing.ts). Never targeted at any one resume;
  used identically for every organization/location string this module
  ever sees. Deliberately does NOT include city names (Toronto,
  Vancouver, ...) or province/state codes one at a time - those are
  covered generically by REGION_CODE_RE below instead of an enumerated
  list, so this module never needs a per-city or per-province lookup
  table (which would risk drifting into "hardcode the private resume's
  own cities" territory).
*/
const KNOWN_COUNTRY_NAMES = new Set(
  [
    "canada",
    "usa",
    "us",
    "u.s.",
    "u.s.a.",
    "united states",
    "united states of america",
    "uk",
    "u.k.",
    "united kingdom",
    "korea",
    "south korea",
    "north korea",
    "japan",
    "china",
    "france",
    "germany",
    "italy",
    "spain",
    "portugal",
    "netherlands",
    "belgium",
    "switzerland",
    "austria",
    "sweden",
    "norway",
    "denmark",
    "finland",
    "ireland",
    "poland",
    "mexico",
    "brazil",
    "argentina",
    "chile",
    "india",
    "australia",
    "new zealand",
    "singapore",
    "malaysia",
    "indonesia",
    "thailand",
    "vietnam",
    "philippines",
    "taiwan",
    "hong kong",
    "israel",
    "saudi arabia",
    "united arab emirates",
    "uae",
    "south africa",
    "egypt",
    "turkey",
    "russia",
    "ukraine",
    "greece",
    "czech republic",
    "hungary",
    "romania",
  ].map((c) => c.toLowerCase())
);

// Any bare two-letter UPPERCASE code (province, state, or similar
// region abbreviation - ON, QC, BC, CA, NY, UK, ...) - a general SHAPE
// signal, not an enumerated list of specific codes, so it covers every
// Canadian province and US state (and more) without hardcoding any of
// them by name.
const REGION_CODE_RE = /^[A-Z]{2}$/;

/*
  Phase 5D.4A - the same generic WORK-MODE vocabulary as Remote/Hybrid,
  extended with the two other shape-only qualifiers the round's own
  spec names (On-site, Worldwide) - never a name, always a closed,
  general-purpose word set describing HOW/WHERE work happens, not WHO
  or WHAT city/company it is.
*/
const WORK_MODE_RE = /^(remote|hybrid|on-?site|worldwide)$/i;
const WORK_MODE_WITH_QUALIFIER_RE = new RegExp(`^(remote|hybrid|on-?site|worldwide)\\s*(?:,|${DASH_SEPARATOR_RE})\\s*(.+)$`, "i");
/*
  Phase 5D.3C - a generic conjunction/slash joiner between two or more
  otherwise-independent location clauses ("Toronto, ON and Vancouver,
  BC", "Vancouver, BC and Remote") - the round's own required "Multiple
  Locations" shape. Never a city/company name lookup, purely structural.
*/
const LOCATION_CONJUNCTION_RE = /\s+(?:and|&)\s+|\s*\/\s*/i;

function isKnownCountryName(text: string): boolean {
  return KNOWN_COUNTRY_NAMES.has(text.trim().toLowerCase());
}

/*
  Location judgment (spec section "Location 판정") - only recognizes a
  handful of GENERAL shapes, never a specific city/company/school name:
    - "Remote" / "Hybrid" alone
    - "Remote"/"Hybrid" followed by a comma or dash and a known country
      ("Remote, Canada", "Remote - Canada", "Hybrid － USA", ...)
    - "<anything>, XX" where XX is a bare two-letter uppercase code
      ("Toronto, ON", "Mountain View, CA", "Québec, QC", "London, UK")
    - "<anything>, <known country name>" ("Yongin, Korea", "Paris,
      France", "Tokyo, Japan")
  Deliberately does NOT recognize a bare city name or a bare country
  name with no qualifier - "확신이 없으면 절대 분리하지 않는다": a lone
  word after a dash is exactly the shape an organization's own internal
  division name takes ("... - Development", "... - Assurance"), so
  requiring a comma-qualified or Remote/Hybrid-qualified shape is what
  keeps those safely unsplit without needing a deny-list of business
  terms.
*/
export function looksLikeLocation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  if (WORK_MODE_RE.test(trimmed)) return true;

  const workModeMatch = trimmed.match(WORK_MODE_WITH_QUALIFIER_RE);
  if (workModeMatch && isKnownCountryName(workModeMatch[2])) return true;

  /*
    Phase 5D.4A - generalized from the pre-existing commaParts.length===2
    check (which only ever recognized exactly "X, Region/Country" and
    missed "City, Province, Country") to accept ANY comma-part count,
    judging only the TRAILING segment - the same single shape test
    (bare 2-letter region code, or an exact match against the closed
    country-name set) applied identically regardless of how many parts
    came before it. This is still never a city/name lookup: every part
    before the trailing qualifier is trusted implicitly, exactly as the
    2-part case already trusted commaParts[0] without inspecting it.
  */
  const commaParts = trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (commaParts.length >= 2) {
    const trailingQualifier = commaParts[commaParts.length - 1];
    if (REGION_CODE_RE.test(trailingQualifier)) return true;
    if (isKnownCountryName(trailingQualifier)) return true;
  }

  /* Phase 5D.3C - Multiple Locations shape: every conjunction-joined
     clause independently looks like a location by the same strict rule
     above (recursive on this same generic shape check, never a city
     lookup). Requires 2+ clauses so a single bare word never trivially
     "passes" through this branch. */
  const clauses = trimmed.split(LOCATION_CONJUNCTION_RE).map((s) => s.trim()).filter((s) => s.length > 0);
  if (clauses.length >= 2 && clauses.every((c) => looksLikeLocation(c))) return true;

  return false;
}

export type OrganizationLocationSplit = { organization: string; location?: string };

/*
  Tries every dash-separator occurrence in `text`, starting from the
  LAST one and working backward, and splits at the first one whose
  suffix independently looksLikeLocation. Starting from the end is what
  correctly leaves an organization name that itself contains a dash
  intact - "OBA – OJEN Competitive Mock Trials － Toronto, ON" tries the
  fullwidth dash before "Toronto, ON" FIRST (succeeds immediately), so
  the earlier en dash inside "OBA – OJEN" is never even considered.
  Returns null when no dash-based split is justified (either no
  separator exists, or nothing after any separator looks like a real
  location) - the caller falls back to its own pre-existing comma-only
  logic in that case, so ordinary "Company, City, ST" text with no dash
  at all is completely unaffected by this module.
*/
function trySplitOnDashSeparator(text: string): OrganizationLocationSplit | null {
  const re = new RegExp(`\\s*${DASH_SEPARATOR_RE}\\s*`, "g");
  const matches = [...text.matchAll(re)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const index = match.index ?? -1;
    if (index < 0) continue;
    const before = text.slice(0, index).trim();
    const after = text.slice(index + match[0].length).trim();
    if (before.length === 0 || after.length === 0) continue;
    if (looksLikeLocation(after)) {
      return { organization: before, location: after };
    }
  }
  return null;
}

/*
  Splits a "Company, Location" style prefix into organization + location.
  Only splits on the LAST comma group so a company name that itself
  contains a comma-free multi-word name is never broken up - "Company,
  City, ST" -> organization="Company", location="City, ST"; "Company"
  alone (no comma) -> organization="Company", location=undefined. This
  is the pre-existing, proven behavior (Phase 1-5D.1) - unchanged,
  UNconditional (never gated on looksLikeLocation), and only reached
  when trySplitOnDashSeparator above found no justified dash split.
*/
function splitOnTrailingComma(text: string): OrganizationLocationSplit {
  const trimmed = text.trim().replace(/[,–—-]+$/, "").trim();
  const parts = trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length <= 1) return { organization: trimmed };
  return { organization: parts[0], location: parts.slice(1).join(", ") };
}

export function splitOrganizationLocation(text: string): OrganizationLocationSplit {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { organization: trimmed };

  const dashSplit = trySplitOnDashSeparator(trimmed);
  if (dashSplit) return dashSplit;

  return splitOnTrailingComma(trimmed);
}
