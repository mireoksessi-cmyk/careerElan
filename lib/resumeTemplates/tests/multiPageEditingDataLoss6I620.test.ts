/*
  Phase 6I.6.20 - Multi-Page Resume / Cover Letter Editing Data-Loss
  Elimination regression suite. Covers the P0 bug found in
  app/job-tracker/A4Preview.tsx: editing any one page's textarea used to
  call a single shared onChange with ONLY that page's own (already
  re-wrapped, lossy) text, which the caller wrote straight into the
  full-document state - destroying every other page on the first
  keystroke.

  Exercises computeA4Pages()/reconstructFullTextAfterPageEdit() (exported
  from A4Preview.tsx specifically for this) directly - these are the
  exact pure functions the component's per-page textareas call on every
  keystroke, so this is real coverage of the shipped fix, not a
  reimplementation of it. No DB, no AI, no network calls. Run with:
    npx tsx lib/resumeTemplates/tests/multiPageEditingDataLoss6I620.test.ts
*/
import { computeA4Pages, reconstructFullTextAfterPageEdit } from "../../../app/job-tracker/A4Preview";

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

/*
  Each "page" gets a marker line plus enough filler lines (well past the
  ~53-line-per-page capacity at 10pt/5mm line height between y=15mm and
  y=280mm) to force the SAME real pagination path exportPdf()/A4Preview
  use, not a synthetic 1-line-per-page stub.
*/
function buildFixture(markers: [string, string, string], seedPrefix: string): string {
  function chunk(marker: string, seed: string): string[] {
    const lines = [marker];
    for (let i = 0; i < 60; i++) {
      lines.push(`${seed} filler content line ${i} - sample text for real pagination`);
    }
    return lines;
  }
  return [
    ...chunk(markers[0], `${seedPrefix}-alpha`),
    ...chunk(markers[1], `${seedPrefix}-bravo`),
    ...chunk(markers[2], `${seedPrefix}-charlie`),
  ].join("\n");
}

const RESUME_FIXTURE = buildFixture(["RESUME-PAGE-ONE-620", "RESUME-PAGE-TWO-620", "RESUME-PAGE-THREE-620"], "resume");
const COVER_FIXTURE = buildFixture(["COVER-PAGE-ONE-620", "COVER-PAGE-TWO-620", "COVER-PAGE-THREE-620"], "cover");

function assertExactPrefix(label: string, fullLines: string[], prefixLines: string[]) {
  checkTrue(label, prefixLines.length <= fullLines.length && prefixLines.every((line, i) => fullLines[i] === line));
}
function assertExactSuffix(label: string, fullLines: string[], suffixLines: string[]) {
  const offset = fullLines.length - suffixLines.length;
  checkTrue(label, offset >= 0 && suffixLines.every((line, i) => fullLines[offset + i] === line));
}

/*
  Shared matrix runner - identical assertions run once for the Resume
  fixture (R1-R7) and once for the Cover Letter fixture (C1-C7), per the
  phase spec's own "repeat equivalent tests for Cover Letter" instruction.
*/
function runMatrix(fixture: string, docLabel: string, markers: [string, string, string]) {
  const { pages, pageLineRanges } = computeA4Pages(fixture);
  checkTrue(`${docLabel} fixture setup: produces a real multi-page document (>=3 pages)`, pages.length >= 3);

  const originalRawLines = fixture.split("\n");
  const page0Lines = originalRawLines.slice(pageLineRanges[0][0], pageLineRanges[0][1]);
  const page1Lines = originalRawLines.slice(pageLineRanges[1][0], pageLineRanges[1][1]);
  const lastIdx = pages.length - 1;
  const pageLastLines = originalRawLines.slice(pageLineRanges[lastIdx][0], pageLineRanges[lastIdx][1]);

  /* TEST 1 - middle-page edit: page 0 (prefix) and last page (suffix) untouched */
  {
    const edited = pages[1] + `\n${docLabel}-EDIT-MARKER-1`;
    const result = reconstructFullTextAfterPageEdit(fixture, 1, edited);
    const resultLines = result.split("\n");
    assertExactPrefix(`${docLabel} 1 (middle-page edit): page 1 preserved verbatim as prefix`, resultLines, page0Lines);
    assertExactSuffix(`${docLabel} 1 (middle-page edit): last page preserved verbatim as suffix`, resultLines, pageLastLines);
    checkTrue(`${docLabel} 1: edited content present`, result.includes(`${docLabel}-EDIT-MARKER-1`));
    checkTrue(`${docLabel} 1: middle-page marker still present`, result.includes(markers[1]));
    check(`${docLabel} 1: total line count = untouched pages + edited page + 1 new line`, resultLines.length, originalRawLines.length + 1);
  }

  /* TEST 2 - first-page edit: everything from page 1 onward preserved verbatim as suffix */
  {
    const edited = pages[0] + `\n${docLabel}-EDIT-MARKER-2`;
    const result = reconstructFullTextAfterPageEdit(fixture, 0, edited);
    const resultLines = result.split("\n");
    const untouchedSuffix = originalRawLines.slice(pageLineRanges[0][1]);
    assertExactSuffix(`${docLabel} 2 (first-page edit): pages 2+ preserved verbatim`, resultLines, untouchedSuffix);
    checkTrue(`${docLabel} 2: edited content present`, result.includes(`${docLabel}-EDIT-MARKER-2`));
    checkTrue(`${docLabel} 2: page 2 marker still present`, result.includes(markers[1]));
    checkTrue(`${docLabel} 2: last page marker still present`, result.includes(markers[2]));
  }

  /* TEST 3 - last-page edit: everything before the last page preserved verbatim as prefix */
  {
    const edited = pages[lastIdx] + `\n${docLabel}-EDIT-MARKER-3`;
    const result = reconstructFullTextAfterPageEdit(fixture, lastIdx, edited);
    const resultLines = result.split("\n");
    const untouchedPrefix = originalRawLines.slice(0, pageLineRanges[lastIdx][0]);
    assertExactPrefix(`${docLabel} 3 (last-page edit): pages before it preserved verbatim`, resultLines, untouchedPrefix);
    checkTrue(`${docLabel} 3: edited content present`, result.includes(`${docLabel}-EDIT-MARKER-3`));
    checkTrue(`${docLabel} 3: page 1 marker still present`, result.includes(markers[0]));
    checkTrue(`${docLabel} 3: page 2 marker still present`, result.includes(markers[1]));
  }

  /* TEST 4 - first-page edit large enough to change pagination (reflow); no content loss */
  {
    const bigAddition = Array.from({ length: 80 }, (_, i) => `${docLabel}-REFLOW-4-LINE-${i}`).join("\n");
    const edited = pages[0] + "\n" + bigAddition;
    const result = reconstructFullTextAfterPageEdit(fixture, 0, edited);
    const { pages: pagesAfter } = computeA4Pages(result);
    checkTrue(`${docLabel} 4: reflow increased page count`, pagesAfter.length > pages.length);
    checkTrue(`${docLabel} 4: all 3 original page markers survive reflow`, markers.every((m) => result.includes(m)));
    checkTrue(`${docLabel} 4: reflow addition present`, result.includes(`${docLabel}-REFLOW-4-LINE-0`) && result.includes(`${docLabel}-REFLOW-4-LINE-79`));
    const untouchedSuffix = originalRawLines.slice(pageLineRanges[0][1]);
    assertExactSuffix(`${docLabel} 4: unedited pages 2+ still verbatim after reflow`, result.split("\n"), untouchedSuffix);
  }

  /* TEST 5 - middle-page edit large enough to change page count; all semantic content preserved */
  {
    const bigAddition = Array.from({ length: 80 }, (_, i) => `${docLabel}-REFLOW-5-LINE-${i}`).join("\n");
    const edited = pages[1] + "\n" + bigAddition;
    const result = reconstructFullTextAfterPageEdit(fixture, 1, edited);
    const { pages: pagesAfter } = computeA4Pages(result);
    checkTrue(`${docLabel} 5: reflow increased page count`, pagesAfter.length > pages.length);
    checkTrue(`${docLabel} 5: all 3 original page markers survive reflow`, markers.every((m) => result.includes(m)));
    assertExactPrefix(`${docLabel} 5: page 1 still verbatim prefix after reflow`, result.split("\n"), page0Lines);
    assertExactSuffix(`${docLabel} 5: last page still verbatim suffix after reflow`, result.split("\n"), pageLastLines);
  }

  /* TEST 6 - sequential edits (page 1, then last page, then middle page) all accumulate */
  {
    let current = fixture;
    let pagesNow = computeA4Pages(current).pages;
    current = reconstructFullTextAfterPageEdit(current, 0, pagesNow[0] + `\n${docLabel}-SEQ-A`);

    pagesNow = computeA4Pages(current).pages;
    const lastNow = pagesNow.length - 1;
    current = reconstructFullTextAfterPageEdit(current, lastNow, pagesNow[lastNow] + `\n${docLabel}-SEQ-B`);

    pagesNow = computeA4Pages(current).pages;
    const midNow = Math.floor(pagesNow.length / 2);
    current = reconstructFullTextAfterPageEdit(current, midNow, pagesNow[midNow] + `\n${docLabel}-SEQ-C`);

    checkTrue(`${docLabel} 6: all 3 sequential edits accumulate (none overwritten by a later one)`, current.includes(`${docLabel}-SEQ-A`) && current.includes(`${docLabel}-SEQ-B`) && current.includes(`${docLabel}-SEQ-C`));
    checkTrue(`${docLabel} 6: all 3 original page markers survive 3 sequential edits`, markers.every((m) => current.includes(m)));
  }

  /* TEST 7 - whitespace/newline-only edits don't delete unrelated content */
  {
    const edited = pages[1] + "\n\n   \n";
    const result = reconstructFullTextAfterPageEdit(fixture, 1, edited);
    const resultLines = result.split("\n");
    assertExactPrefix(`${docLabel} 7 (whitespace edit): page 1 preserved verbatim as prefix`, resultLines, page0Lines);
    assertExactSuffix(`${docLabel} 7 (whitespace edit): last page preserved verbatim as suffix`, resultLines, pageLastLines);
    checkTrue(`${docLabel} 7: middle-page marker still present`, result.includes(markers[1]));
  }
}

function main() {
  runMatrix(RESUME_FIXTURE, "RESUME", ["RESUME-PAGE-ONE-620", "RESUME-PAGE-TWO-620", "RESUME-PAGE-THREE-620"]);
  runMatrix(COVER_FIXTURE, "COVER", ["COVER-PAGE-ONE-620", "COVER-PAGE-TWO-620", "COVER-PAGE-THREE-620"]);

  /* --- Regression guard for the ORIGINAL reported bug shape: a naive
     "onChange(newPageText)" (old behavior) would have discarded every
     other page. Confirm the FIXED reconstruction is NOT equal to just
     the edited page's own text. --- */
  {
    const { pages } = computeA4Pages(RESUME_FIXTURE);
    const edited = pages[1] + "\nSOME-EDIT";
    const result = reconstructFullTextAfterPageEdit(RESUME_FIXTURE, 1, edited);
    checkTrue("regression guard: fixed reconstruction is NOT just the edited page's own text (the original bug's exact shape)", result !== edited);
    checkTrue("regression guard: fixed reconstruction contains page 1's marker (would be absent under the old bug)", result.includes("RESUME-PAGE-ONE-620"));
    checkTrue("regression guard: fixed reconstruction contains page 3's marker (would be absent under the old bug)", result.includes("RESUME-PAGE-THREE-620"));
  }

  /* --- Read-only mode (Job Tracker's usage - no onChange prop) is
     unaffected by this fix; computeA4Pages() itself has no notion of
     onChange, so read-only display pagination is identical regardless. --- */
  {
    const { pages } = computeA4Pages(RESUME_FIXTURE);
    checkTrue("read-only display: pagination still produces non-empty pages", pages.every((p) => p.length > 0));
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
