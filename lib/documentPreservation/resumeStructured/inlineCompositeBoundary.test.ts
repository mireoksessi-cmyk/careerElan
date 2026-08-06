/*
  Phase 5D.4A - Generic Inline Composite Institution/Organization
  Boundary Hardening. Permanent regression gate for parseInlineCompositeHeader
  (academicCompositeParser.ts) and looksLikeLocation (splitOrganizationLocation.ts)
  after this round's generalization fix.

  Real bug this round closes (found during Phase 5D.4 QA's negative-control
  authoring, reported in docs/PHASE5D4_QA_REPORT.md Section 8 Bug #1):
  "Example University | San Francisco, California, USA" (a 3-part "City,
  Province, Country" location) was corrupted - looksLikeLocation only ever
  inspected commaParts[1] under a commaParts.length===2 gate, so the
  3-part location failed that gate, fell through to splitOnTrailingComma's
  unconditional whole-string split (still containing the pipe character),
  and produced institution="Example University | San Francisco" (pipe
  glued in) and location="California, USA" (wrong, missing "San Francisco").

  This file verifies BOTH halves of the fix:
    1. looksLikeLocation generalized from commaParts.length===2 to >=2,
       judging only the trailing qualifier (splitOrganizationLocation.ts).
    2. parseInlineCompositeHeader's pipe/dot/bullet/colon/arrow path now
       searches trailing delimiter-segment windows from narrowest to
       widest, so a location spread across MULTIPLE delimited segments
       ("Institute | Berlin | Germany") is recognized too, not just a
       location that happens to sit inside one already-comma-joined
       segment (academicCompositeParser.ts).

  Every case below uses only GENERIC STRUCTURE (delimiter shape, comma
  count, trailing region-code/country-name/work-mode qualifier) - never a
  hardcoded school/company/city/country branch in the PARSER itself. Test
  DATA below mixes plausible real-world-style organization/institution
  names (the same "prove it isn't special-cased" convention already
  established in splitOrganizationLocation.test.ts, which uses Google/
  OpenAI/Samsung SDI/Toyota/BBC as plain input strings with zero special
  handling for any of them) with clearly synthetic ones - the parser
  itself contains no name of either kind.

  Run with `npx tsx lib/documentPreservation/resumeStructured/inlineCompositeBoundary.test.ts`.
*/
import { parseInlineCompositeHeader } from "./academicCompositeParser";
import { looksLikeLocation } from "./splitOrganizationLocation";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

function splitOrg(text: string) {
  return parseInlineCompositeHeader(text, "organization");
}
function splitEdu(text: string) {
  return parseInlineCompositeHeader(text, "education");
}

// =====================================================================
// SECTION 0 - Exact Bug #1 repro from the QA report, both contexts
// =====================================================================
{
  const r = splitEdu("Example University | San Francisco, California, USA");
  check("Bug#1 repro: institution never has the pipe glued in", r.primaryText, "Example University");
  check("Bug#1 repro: full 3-part location recovered", r.location, "San Francisco, California, USA");
}
{
  const r = splitOrg("Example University | San Francisco, California, USA");
  check("Bug#1 repro (organization context): institution clean", r.primaryText, "Example University");
  check("Bug#1 repro (organization context): full 3-part location recovered", r.location, "San Francisco, California, USA");
}

// =====================================================================
// SECTION A - MUST SPLIT: 2-part comma location ("City, Region"/"City,
// Country") across every supported delimiter form, including the 3
// new Phase 5D.4A forms (colon, ">>", arrow).
// =====================================================================
const TWO_PART_DELIMITER_CASES: Array<{ org: string; loc: string; delim: string }> = [
  { org: "Northshore Manufacturing", loc: "Austin, TX", delim: "|" },
  { org: "Global Health Alliance", loc: "Bangkok, Thailand", delim: "•" },
  { org: "TechNova Solutions", loc: "Berlin, Germany", delim: "·" },
  { org: "Riverbend Logistics", loc: "Halifax, NS", delim: "—" },
  { org: "Cedarwood Financial Group", loc: "Denver, CO", delim: "–" },
  { org: "Brightline Analytics", loc: "Ottawa, ON", delim: "/" },
  { org: "Silverleaf Consulting", loc: "Mountain View, CA", delim: ":" },
  { org: "Ashford Public Relations", loc: "Calgary, AB", delim: ">>" },
  { org: "Meridian Research Group", loc: "Tokyo, Japan", delim: "→" },
  { org: "Example College", loc: "Regina, SK", delim: "|" },
  { org: "Example Institute", loc: "Winnipeg, MB", delim: "•" },
  { org: "Example University", loc: "Montreal, QC", delim: "·" },
  { org: "Fairview Community Trust", loc: "London, UK", delim: "|" },
  { org: "Lakeshore Environmental Group", loc: "Amsterdam, Netherlands", delim: "•" },
  { org: "Harborview Insurance Partners", loc: "Zurich, Switzerland", delim: "·" },
  { org: "Ironwood Capital Advisors", loc: "Edmonton, AB", delim: "—" },
  { org: "Willowbrook Design Studio", loc: "Wellington, New Zealand", delim: "–" },
  { org: "Summit Ridge Ventures", loc: "Singapore, Singapore", delim: "/" },
];
for (const c of TWO_PART_DELIMITER_CASES) {
  const text = `${c.org} ${c.delim} ${c.loc}`;
  const r = splitOrg(text);
  check(`2-part [${c.delim}] "${text}": institution`, r.primaryText, c.org);
  check(`2-part [${c.delim}] "${text}": location`, r.location, c.loc);
}

// =====================================================================
// SECTION B - MUST SPLIT: 3-part comma location ("City, Province,
// Country" / "City, State, Country") within ONE trailing segment - the
// exact shape class Bug #1 was about, across multiple delimiters.
// =====================================================================
const THREE_PART_SINGLE_SEGMENT_CASES: Array<{ org: string; loc: string; delim: string }> = [
  { org: "Example University", loc: "San Francisco, California, USA", delim: "|" },
  { org: "Example Institute", loc: "Toronto, Ontario, Canada", delim: "|" },
  { org: "Example College", loc: "Vancouver, British Columbia, Canada", delim: "•" },
  { org: "Northshore Manufacturing", loc: "Cambridge, Massachusetts, USA", delim: "·" },
  { org: "Global Health Alliance", loc: "Sydney, New South Wales, Australia", delim: "—" },
  { org: "TechNova Solutions", loc: "Munich, Bavaria, Germany", delim: "–" },
  { org: "Riverbend Logistics", loc: "Osaka, Osaka Prefecture, Japan", delim: "/" },
  { org: "Cedarwood Financial Group", loc: "Austin, Texas, USA", delim: ":" },
  { org: "Brightline Analytics", loc: "Seoul, Gyeonggi, Korea", delim: ">>" },
  { org: "Silverleaf Consulting", loc: "Geneva, Geneva Canton, Switzerland", delim: "→" },
  { org: "Ashford Public Relations", loc: "Halifax, Nova Scotia, Canada", delim: "|" },
  { org: "Meridian Research Group", loc: "Portland, Oregon, USA", delim: "|" },
];
for (const c of THREE_PART_SINGLE_SEGMENT_CASES) {
  const text = `${c.org} ${c.delim} ${c.loc}`;
  const r = splitEdu(text);
  check(`3-part-1seg [${c.delim}] "${text}": institution`, r.primaryText, c.org);
  check(`3-part-1seg [${c.delim}] "${text}": location`, r.location, c.loc);
}

// =====================================================================
// SECTION C - MUST SPLIT: comma-only (no pipe at all) 3-part location -
// the pure-comma corollary of Bug #1 (splitOnTrailingComma's fallback
// path also benefits from the looksLikeLocation generalization).
// =====================================================================
const COMMA_ONLY_THREE_PART_CASES: string[] = [
  "Example University, San Francisco, California, USA",
  "Example College, Toronto, Ontario, Canada",
  "Meridian Research Group, Austin, Texas, USA",
];
const COMMA_ONLY_EXPECTED: Array<{ org: string; loc: string }> = [
  { org: "Example University", loc: "San Francisco, California, USA" },
  { org: "Example College", loc: "Toronto, Ontario, Canada" },
  { org: "Meridian Research Group", loc: "Austin, Texas, USA" },
];
COMMA_ONLY_THREE_PART_CASES.forEach((text, i) => {
  const r = splitEdu(text);
  check(`comma-only 3-part "${text}": institution`, r.primaryText, COMMA_ONLY_EXPECTED[i].org);
  check(`comma-only 3-part "${text}": location`, r.location, COMMA_ONLY_EXPECTED[i].loc);
});

// =====================================================================
// SECTION D - MUST SPLIT: multi-segment WIDENING - "City" and "Country"
// (or "City" and work-mode+"Country") arrive as SEPARATE delimited
// segments, neither independently location-shaped alone, only the
// JOINED pair is - the new capability this round adds.
// =====================================================================
{
  const r = splitEdu("Example Institute | Berlin | Germany");
  check("widen 2-seg pipe: institution", r.primaryText, "Example Institute");
  check("widen 2-seg pipe: no stray detail", r.detailText, undefined);
  check("widen 2-seg pipe: location joins both segments", r.location, "Berlin, Germany");
}
{
  const r = splitOrg("Global Health Alliance | Bangkok | Thailand");
  check("widen 2-seg pipe (org): institution", r.primaryText, "Global Health Alliance");
  check("widen 2-seg pipe (org): location", r.location, "Bangkok, Thailand");
}
{
  const r = splitOrg("Meridian Research Group • Portland • OR");
  check("widen 2-seg bullet: institution", r.primaryText, "Meridian Research Group");
  check("widen 2-seg bullet: location", r.location, "Portland, OR");
}
{
  const r = splitOrg("Silverleaf Consulting : Geneva : Switzerland");
  check("widen 2-seg colon: institution", r.primaryText, "Silverleaf Consulting");
  check("widen 2-seg colon: location", r.location, "Geneva, Switzerland");
}
{
  const r = splitOrg("Ashford Public Relations → Halifax → Canada");
  check("widen 2-seg arrow: institution", r.primaryText, "Ashford Public Relations");
  check("widen 2-seg arrow: location", r.location, "Halifax, Canada");
}
{
  // Narrowest-first must still win when the LAST segment alone already
  // qualifies (Remote/Hybrid) - never widen further than necessary.
  const r = splitOrg("Cedarwood Financial Group | Remote | Canada");
  check("widen stops early when last-2 already qualify (Remote, Canada)", r.location, "Remote, Canada");
}

// =====================================================================
// SECTION E - MUST SPLIT with DETAIL preserved: 3+ segments where a
// genuine middle detail (Campus/Department/Division/Office) sits
// between institution and an ALREADY-qualified trailing location -
// proves the narrowest-first search never over-widens past a location
// that already satisfies looksLikeLocation on its own.
// =====================================================================
const DETAIL_PLUS_LOCATION_CASES: Array<{ org: string; detail: string; loc: string; delim: string }> = [
  { org: "Example Institute", detail: "Downtown Campus", loc: "Vancouver, BC", delim: "|" },
  { org: "Northshore Manufacturing", detail: "Battery R&D Center", loc: "Suwon, Korea", delim: "|" },
  { org: "Global Health Alliance", detail: "Regional Office", loc: "Cairo, Egypt", delim: "|" },
  { org: "Meridian Research Group", detail: "Engineering Division", loc: "Austin, TX", delim: "|" },
  { org: "Cedarwood Financial Group", detail: "Compliance Department", loc: "London, UK", delim: "|" },
  { org: "Example University", detail: "School of Business", loc: "Toronto, Ontario, Canada", delim: "|" },
  { org: "TechNova Solutions", detail: "Platform Engineering", loc: "Dublin, Ireland", delim: "•" },
  { org: "Riverbend Logistics", detail: "Warehouse Operations", loc: "Memphis, TN", delim: "·" },
];
for (const c of DETAIL_PLUS_LOCATION_CASES) {
  const text = `${c.org} ${c.delim} ${c.detail} ${c.delim} ${c.loc}`;
  const r = splitEdu(text);
  check(`detail+loc [${c.delim}] "${text}": institution`, r.primaryText, c.org);
  check(`detail+loc [${c.delim}] "${text}": detail preserved`, r.detailText, c.detail);
  check(`detail+loc [${c.delim}] "${text}": location`, r.location, c.loc);
}

// =====================================================================
// SECTION F - MUST SPLIT: work-mode shapes (Remote/Hybrid/On-site/
// Worldwide), bare and country-qualified, across delimiters.
// =====================================================================
const WORK_MODE_CASES: Array<{ org: string; loc: string; delim: string }> = [
  { org: "Brightline Analytics", loc: "Remote", delim: "|" },
  { org: "Silverleaf Consulting", loc: "Hybrid", delim: "•" },
  { org: "Ashford Public Relations", loc: "On-site", delim: "·" },
  { org: "Meridian Research Group", loc: "Worldwide", delim: "—" },
  { org: "Cedarwood Financial Group", loc: "Remote, Canada", delim: "|" },
  { org: "TechNova Solutions", loc: "Hybrid, USA", delim: "|" },
  { org: "Example Institute", loc: "Remote - Germany", delim: "•" },
  { org: "Fairview Community Trust", loc: "Worldwide", delim: "|" },
  { org: "Lakeshore Environmental Group", loc: "On-site, France", delim: "|" },
  { org: "Harborview Insurance Partners", loc: "Hybrid", delim: "→" },
];
for (const c of WORK_MODE_CASES) {
  const text = `${c.org} ${c.delim} ${c.loc}`;
  const r = splitOrg(text);
  check(`work-mode [${c.delim}] "${text}": institution`, r.primaryText, c.org);
  check(`work-mode [${c.delim}] "${text}": location`, r.location, c.loc);
}

// =====================================================================
// SECTION G - NEGATIVE CONTROL 1: internal sub-organization must NEVER
// be misclassified as a location - the exact "University of Toronto |
// School of Engineering" / "Samsung SDI | Battery R&D Center" class of
// case named explicitly in this round's spec. Zero text loss: the
// WHOLE original string survives verbatim as primaryText.
// =====================================================================
const INTERNAL_SUBUNIT_NOT_LOCATION_CASES: string[] = [
  "Example University | School of Engineering",
  "Research Center | Battery Division",
  "Northshore Manufacturing | Battery R&D Center",
  "Example Institute | Downtown Campus",
  "Global Health Alliance | Regional Office",
  "Meridian Research Group | Engineering Division",
  "Cedarwood Financial Group | Compliance Department",
  "TechNova Solutions | Platform Team",
  "Riverbend Logistics | Warehouse Operations",
  "Example College | Office of the Registrar",
  "Silverleaf Consulting • Strategy Practice",
  "Ashford Public Relations · Client Services",
  "Brightline Analytics — Data Science Unit",
  "Example University – Alumni Relations",
  "Example Institute / Continuing Education",
  "Meridian Research Group : Policy Division",
  "Cedarwood Financial Group >> Risk Management",
  "TechNova Solutions → Cloud Infrastructure",
  "Research & Development Institute",
  "Sales and Marketing Division",
  "Fairview Community Trust | Membership Services",
  "Lakeshore Environmental Group | Field Operations",
  "Harborview Insurance Partners | Underwriting Unit",
  "Ironwood Capital Advisors | Portfolio Management",
  "Willowbrook Design Studio | Creative Direction",
  "Summit Ridge Ventures | Investor Relations",
  "Health and Safety Division",
  "Arts and Science Faculty",
];
for (const text of INTERNAL_SUBUNIT_NOT_LOCATION_CASES) {
  const r = splitOrg(text);
  check(`internal-subunit NOT split "${text}": no location field`, r.location, undefined);
  check(`internal-subunit NOT split "${text}": full text preserved verbatim (0 loss)`, r.primaryText, text);
}

// =====================================================================
// SECTION H - NEGATIVE CONTROL 2: a bare/unqualified city (no comma, no
// region code, no known country, no work-mode word) must NEVER be
// guessed as a location - this codebase deliberately has no city
// dictionary, so an unqualified trailing word/segment is exactly the
// shape an internal division name also takes, and must stay unsplit
// (0 text loss) rather than risk a wrong guess.
// =====================================================================
const BARE_UNQUALIFIED_TRAILING_CASES: string[] = [
  "Example University | Toronto",
  "Northshore Manufacturing | Suwon",
  "Global Health Alliance | Office | Nairobi",
  "Meridian Research Group | Division | Austin",
  "Cedarwood Financial Group | Department | London",
  "Example Institute | Campus | Vancouver",
  "TechNova Solutions | Team | Dublin",
  "Fairview Community Trust | Office | Portland",
  "Lakeshore Environmental Group | Branch | Chicago",
];
for (const text of BARE_UNQUALIFIED_TRAILING_CASES) {
  const r = splitOrg(text);
  check(`bare-unqualified NOT split "${text}": no location field`, r.location, undefined);
  check(`bare-unqualified NOT split "${text}": full text preserved verbatim (0 loss)`, r.primaryText, text);
}

// =====================================================================
// SECTION I - NEGATIVE CONTROL 3: location text must never be
// misclassified AS the institution/organization (i.e. primaryText must
// never itself be location-shaped while the true institution name gets
// dropped or glued elsewhere). Verified by checking primaryText is
// exactly the intended institution on every positive case above
// (already exhaustively checked) plus these additional edge shapes
// where a naive split could plausibly invert the two fields.
// =====================================================================
{
  const r = splitEdu("Toronto, ON | Example University");
  // Location-shaped text appears FIRST here - not a recognized composite
  // shape (this parser's contract is always primary-then-location, left
  // to right) - must stay whole, never invert institution<->location.
  check("location-first shape stays whole (never inverts institution/location)", r.location, undefined);
  check("location-first shape: primaryText is the full original text", r.primaryText, "Toronto, ON | Example University");
}
{
  const r = splitEdu("Remote | Example Institute");
  check("work-mode-first shape stays whole", r.location, undefined);
  check("work-mode-first shape: primaryText is the full original text", r.primaryText, "Remote | Example Institute");
}

// =====================================================================
// SECTION J - NEGATIVE CONTROL 4: no delimiter present at all - a
// plain descriptive sentence (even one containing commas) must never
// be split into institution/location just because a comma exists
// somewhere, when no comma-segment independently qualifies.
// =====================================================================
const NO_DELIMITER_CASES: string[] = [
  "Example University, School of Business",
  "University of Calgary, Haskayne School of Business",
  "Northshore Manufacturing, a global logistics leader",
  "Global Health Alliance, founded in 1998",
  "Meridian Research Group, Policy and Advocacy",
  "Fairview Community Trust, a registered charity",
  "Harborview Insurance Partners, established 2005",
];
for (const text of NO_DELIMITER_CASES) {
  const r = splitOrg(text);
  check(`no-delimiter false positive "${text}": institution unaffected`, r.primaryText, text);
  check(`no-delimiter false positive "${text}": no location field`, r.location, undefined);
}

// =====================================================================
// SECTION K - looksLikeLocation unit-level coverage for the exact
// generalization (N-part comma, not just N===2).
// =====================================================================
checkTrue("looksLikeLocation('San Francisco, California, USA') 3-part", looksLikeLocation("San Francisco, California, USA"));
checkTrue("looksLikeLocation('Toronto, Ontario, Canada') 3-part", looksLikeLocation("Toronto, Ontario, Canada"));
checkTrue("looksLikeLocation('A, B, C, Canada') 4-part still judged only by trailing qualifier", looksLikeLocation("Downtown, Midtown, Uptown, Canada"));
checkTrue("looksLikeLocation('On-site')", looksLikeLocation("On-site"));
checkTrue("looksLikeLocation('Onsite')", looksLikeLocation("Onsite"));
checkTrue("looksLikeLocation('Worldwide')", looksLikeLocation("Worldwide"));
checkTrue("looksLikeLocation('On-site, Canada')", looksLikeLocation("On-site, Canada"));
check("looksLikeLocation('School of Business, Accounting Department') still false (3-part, no qualifying trailing segment)", looksLikeLocation("School of Business, Accounting Department, Faculty"), false);
check("looksLikeLocation('Germany') bare 3rd-segment-alone still NOT trusted (must be joined, never guessed alone)", looksLikeLocation("Germany"), false);

// =====================================================================
// SELF-TEST - proves this suite is capable of failing, not vacuously
// agreeing with whatever the parser currently does. Re-runs a KNOWN
// true-positive through the same strict-equality harness used above;
// if the fix regressed, this would report FAIL.
// =====================================================================
{
  const r = splitEdu("Example University | San Francisco, California, USA");
  checkTrue("SELF-TEST: Bug#1 case genuinely produces the correct 2-field split (not vacuous)", r.primaryText === "Example University" && r.location === "San Francisco, California, USA");
}
{
  const r = splitOrg("Example University | School of Engineering");
  checkTrue("SELF-TEST: internal-subunit case genuinely stays unsplit (not vacuous)", r.location === undefined && r.primaryText === "Example University | School of Engineering");
}

const totalCases = TWO_PART_DELIMITER_CASES.length + THREE_PART_SINGLE_SEGMENT_CASES.length + COMMA_ONLY_THREE_PART_CASES.length + 6 /* widen */ + DETAIL_PLUS_LOCATION_CASES.length + WORK_MODE_CASES.length + INTERNAL_SUBUNIT_NOT_LOCATION_CASES.length + BARE_UNQUALIFIED_TRAILING_CASES.length + 2 /* inversion */ + NO_DELIMITER_CASES.length;
console.log(`\ntotal synthetic cases: ${totalCases}`);
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
