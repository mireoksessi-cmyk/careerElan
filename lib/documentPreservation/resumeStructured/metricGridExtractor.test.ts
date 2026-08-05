/*
  Phase 5D.2B - Metric Grid / KPI Card Semantic Recovery gate test.
  Covers looksLikeMetricValue/looksLikeMetricLabel shape classification
  (including the same shapes the real 4-column private-resume evidence
  exhibited - currency-with-suffix, currency-with-parenthetical, short
  date, arrow/ratio - reproduced here with fully synthetic numbers, see
  fixtures/scripts/generatePhase5D2BSyntheticFixtures.mts for the
  anonymized real-fixture-shaped fixture this module is actually
  verified against) and detectMetricGrids' geometry-driven pairing
  across synthetic LosslessResumeSection fixtures - horizontal
  multi-column grids, a vertically-stacked single-column grid,
  cross-Phase-1-section pairing (the real bug this module works
  around), and explicit false-positive-prevention cases (an isolated
  date-above-text pair, a bare date RANGE, an ordinary bullet line).
  Run with `npx tsx lib/documentPreservation/resumeStructured/metricGridExtractor.test.ts`.
*/
import { detectMetricGrids, looksLikeMetricValue, looksLikeMetricLabel } from "./metricGridExtractor";
import type { LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

// --- looksLikeMetricValue: real-fixture-shaped evidence (synthetic numbers) ---
checkTrue('value "$212M+"', looksLikeMetricValue("$212M+"));
checkTrue('value "$18.4M (FY2027E)"', looksLikeMetricValue("$18.4M (FY2027E)"));
checkTrue('value "Mar 2024"', looksLikeMetricValue("Mar 2024"));
checkTrue('value "3 → 11"', looksLikeMetricValue("3 → 11"));

// --- looksLikeMetricValue: general shapes (never resume-specific) ---
checkTrue('value "96%"', looksLikeMetricValue("96%"));
checkTrue('value "4.8/5"', looksLikeMetricValue("4.8/5"));
checkTrue('value "$1,250,000"', looksLikeMetricValue("$1,250,000"));
checkTrue('value "12"', looksLikeMetricValue("12"));
checkTrue('value "150+"', looksLikeMetricValue("150+"));
checkTrue('value "~$109.0M"', looksLikeMetricValue("~$109.0M"));
checkTrue('value "€2.5B"', looksLikeMetricValue("€2.5B"));
checkTrue('value "£450K"', looksLikeMetricValue("£450K"));
checkTrue('value "-3.2%"', looksLikeMetricValue("-3.2%"));
checkTrue('value "4:15" (colon ratio)', looksLikeMetricValue("4:15"));
checkTrue('value "9.2/10"', looksLikeMetricValue("9.2/10"));
checkTrue('value "2023" (bare year)', looksLikeMetricValue("2023"));
checkTrue('value "04/2026" (numeric month/year)', looksLikeMetricValue("04/2026"));

// --- looksLikeMetricValue: must NOT match ---
checkFalse('not a value: "1986–1989" (date RANGE, not a single date)', looksLikeMetricValue("1986–1989"));
checkFalse('not a value: "Nov 2005 – Nov 2021 (15 years)"', looksLikeMetricValue("Nov 2005 – Nov 2021 (15 years)"));
checkFalse('not a value: ordinary sentence', looksLikeMetricValue("Led planning and delivery for multiple concurrent initiatives."));
checkFalse('not a value: empty string', looksLikeMetricValue(""));
checkFalse('not a value: company name', looksLikeMetricValue("Acme Industrial Group"));

// --- looksLikeMetricLabel ---
checkTrue('label "CUMULATIVE CONTRACT VALUE (incl. regional partners)"', looksLikeMetricLabel("CUMULATIVE CONTRACT VALUE (incl. regional partners)"));
checkTrue('label "Customer Satisfaction Score"', looksLikeMetricLabel("Customer Satisfaction Score"));
checkFalse('label rejects a value-shaped string', looksLikeMetricLabel("$212M+"));
checkFalse('label rejects a full sentence (terminal punctuation)', looksLikeMetricLabel("Built weekly sales dashboards used by regional managers."));
checkFalse('label rejects a bare symbol with no letters', looksLikeMetricLabel("•"));
checkFalse('label rejects empty string', looksLikeMetricLabel(""));

// --- detectMetricGrids: synthetic section/block builders ---
let blockCounter = 0;
function makeBlock(text: string, x: number, y: number, width: number, height: number, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const id = `blk-${blockCounter++}`;
  return {
    id,
    sourceElementIds: [id],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: blockCounter,
    bbox: { x, y, width, height },
    style: { fontSize: 12 },
    blockType,
  };
}
function makeSection(id: string, blocks: SemanticContentBlock[]): LosslessResumeSection {
  return {
    id,
    originalHeading: null,
    normalizedHeading: null,
    normalizedType: "custom",
    displayHeading: null,
    sourceOrder: 0,
    startPageIndex: 0,
    endPageIndex: 0,
    confidence: 0,
    classificationMethod: "fallback",
    reasonCodes: [],
    blocks,
    rawText: blocks.map((b) => b.rawText).join("\n"),
    isUncertain: false,
  };
}

// Test 1: a clean 4-column horizontal grid, one section.
{
  blockCounter = 0;
  const section = makeSection("sec-a", [
    makeBlock("$1,250,000", 40, 100, 40, 13),
    makeBlock("$18.4M", 200, 100, 45, 13),
    makeBlock("Mar 2024", 360, 100, 50, 13),
    makeBlock("3 → 11", 520, 100, 35, 13),
    makeBlock("TOTAL REVENUE MANAGED", 30, 115, 90, 7),
    makeBlock("PROJECTED ANNUAL REVENUE", 190, 115, 95, 7),
    makeBlock("PLATFORM LAUNCH DATE", 350, 115, 80, 7),
    makeBlock("TEAM HEADCOUNT GROWTH", 510, 115, 90, 7),
  ]);
  const { grids, consumedBlockIds } = detectMetricGrids([section]);
  check("4-col grid: 1 grid found", grids.length, 1);
  check("4-col grid: 4 entries", grids[0]?.entries.length, 4);
  check("4-col grid: columns=4", grids[0]?.columns, 4);
  check("4-col grid: all 8 blocks consumed", consumedBlockIds.size, 8);
  check("4-col grid: entry 1 value", grids[0]?.entries[0]?.value.value, "$1,250,000");
  check("4-col grid: entry 1 label", grids[0]?.entries[0]?.label.value, "TOTAL REVENUE MANAGED");
}

// Test 2: cross-section pairing - the exact real-bug shape (Phase 1
// split a 4-column band into two sections; values in one, labels in
// the other).
{
  blockCounter = 0;
  const sectionValues = makeSection("sec-values", [
    makeBlock("$212M+", 40, 100, 40, 13, "heading"),
    makeBlock("3 → 11", 500, 100, 35, 13),
  ]);
  const sectionLabels = makeSection("sec-labels", [
    makeBlock("CUMULATIVE CONTRACT VALUE", 30, 115, 90, 7),
    makeBlock("TEAM HEADCOUNT GROWTH", 490, 115, 90, 7),
  ]);
  const { grids } = detectMetricGrids([sectionValues, sectionLabels]);
  check("cross-section: 1 grid found", grids.length, 1);
  check("cross-section: 2 entries", grids[0]?.entries.length, 2);
  check("cross-section: entry 1 value sourceSectionId", grids[0]?.entries[0]?.value.source.sourceSectionId, "sec-values");
  check("cross-section: entry 1 label sourceSectionId", grids[0]?.entries[0]?.label.source.sourceSectionId, "sec-labels");
}

// Test 3: vertically-stacked single-column Score Panel (3 pairs, no
// column differentiation at all - every block shares the same x).
{
  blockCounter = 0;
  const section = makeSection("sec-panel", [
    makeBlock("27", 40, 100, 20, 12),
    makeBlock("Volunteer Events Coordinated", 40, 113, 140, 8),
    makeBlock("150+", 40, 130, 25, 12),
    makeBlock("Community Members Reached", 40, 143, 150, 8),
    makeBlock("9.2/10", 40, 160, 30, 12),
    makeBlock("Program Feedback Score", 40, 173, 130, 8),
  ]);
  const { grids } = detectMetricGrids([section]);
  check("stacked panel: 1 merged grid (not 3 singletons)", grids.length, 1);
  check("stacked panel: 3 entries", grids[0]?.entries.length, 3);
  check("stacked panel: columns=1", grids[0]?.columns, 1);
}

// Test 4: false-positive prevention - a single isolated value-above-
// text pair (below the >=2-entry threshold) must NOT become a grid.
{
  blockCounter = 0;
  const section = makeSection("sec-lonely", [
    makeBlock("2023", 40, 100, 25, 10),
    makeBlock("Some unrelated caption line", 40, 112, 140, 8),
  ]);
  const { grids } = detectMetricGrids([section]);
  check("isolated single pair: 0 grids (below MIN_ENTRIES_PER_GRID)", grids.length, 0);
}

// Test 5: false-positive prevention - a date RANGE above ordinary body
// text (an ordinary long-tenure experience-entry shape) must never be
// mistaken for a metric pair, even with 2+ candidate rows.
{
  blockCounter = 0;
  const section = makeSection("sec-experience", [
    makeBlock("Senior Engineer", 40, 100, 90, 12, "heading"),
    makeBlock("Jun 2008 – Jun 2020 (12 years)", 40, 113, 160, 9),
    makeBlock("Principal Engineer, Systems Development Group", 40, 126, 220, 9),
  ]);
  const { grids } = detectMetricGrids([section]);
  check("experience entry shape: 0 grids", grids.length, 0);
}

// Test 6: false-positive prevention - two side-by-side date/text pairs
// at the SAME row (education entry shape: "1990-1994" next to
// "Northgate University - B.S. ...") must not be treated as a
// value/label ROW PAIR (they are column-adjacent within one row, not
// row-adjacent).
{
  blockCounter = 0;
  const section = makeSection("sec-education", [
    makeBlock("1990–1994", 40, 100, 40, 9),
    makeBlock("Northgate University — B.S. in Mechanical Engineering", 90, 100, 150, 9),
  ]);
  const { grids } = detectMetricGrids([section]);
  check("same-row date+institution: 0 grids", grids.length, 0);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
