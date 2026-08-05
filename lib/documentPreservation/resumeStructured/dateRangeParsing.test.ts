/*
  Phase 5D.1 gate test - Unicode date-range separator hardening.
  Covers spec section 12 items 1-12: every supported separator
  character, month/year and year/year shapes, original-text
  preservation, and the ordinary-bullet false-positive guard.
  Run with `npx tsx lib/documentPreservation/resumeStructured/dateRangeParsing.test.ts`.
*/
import { isDateRangeLine, extractDateParts, hasDateEvidence } from "./dateRangeParsing";

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

// 1. ASCII hyphen-minus
checkTrue("1. ASCII hyphen: 'Role, 2020 - 2022'", isDateRangeLine("Role, 2020 - 2022"));
// 2. en dash
checkTrue("2. en dash: 'Role, 2020 – 2022'", isDateRangeLine("Role, 2020 – 2022"));
// 3. em dash
checkTrue("3. em dash: 'Role, 2020 — 2022'", isDateRangeLine("Role, 2020 — 2022"));
// 4. figure dash
checkTrue("4. figure dash: '2020 ‒ 2022'", isDateRangeLine("2020 ‒ 2022"));
// 5. horizontal bar
checkTrue("5. horizontal bar: '2019 ― 2021'", isDateRangeLine("2019 ― 2021"));
// 6. fullwidth hyphen-minus (the real private-resume shape)
checkTrue("6. fullwidth hyphen-minus (U+FF0D): '05/2026 － Current'", isDateRangeLine("05/2026 － Current"));
checkTrue("6b. fullwidth hyphen-minus, numeric-month both sides: '04/2026 － 05/2026'", isDateRangeLine("04/2026 － 05/2026"));
// 7. word separator "to"
checkTrue("7. 'to' word separator: '2021 to Present'", isDateRangeLine("2021 to Present"));
// 8. Present/Current, case-insensitive
checkTrue("8a. 'Present' recognized", isDateRangeLine("2020 - Present"));
checkTrue("8b. 'Current' (lowercase) recognized", isDateRangeLine("2020 - current"));
// 9. month/year
checkTrue("9. month/year: 'Jan 2022 — Mar 2024'", isDateRangeLine("Jan 2022 — Mar 2024"));
// 10. year/year
checkTrue("10. year/year: '2019 ‒ 2022'", isDateRangeLine("2019 ‒ 2022"));
// 11. original date text preservation (no normalization/rewriting of the value)
check("11a. dateRangeText preserves fullwidth separator verbatim", extractDateParts("05/2026 － Current")?.dateRangeText, "05/2026 － Current");
check("11b. dateRangeText preserves numeric-month-both-sides verbatim", extractDateParts("04/2026 － 05/2026")?.dateRangeText, "04/2026 － 05/2026");
check("11c. dateRangeText preserves named-month verbatim", extractDateParts("Jan 2022 - Jun 2023")?.dateRangeText, "Jan 2022 - Jun 2023");
check("11d. startDateText/endDateText preserved verbatim", [extractDateParts("04/2026 － 05/2026")?.startDateText, extractDateParts("04/2026 － 05/2026")?.endDateText], ["04/2026", "05/2026"]);
// 12. ordinary bullet year false-positive prevention (a bullet-typed line is
//     never itself asked isDateRangeLine by segmentEntryRanges - this
//     module's own functions are pure text tests and MUST still correctly
//     identify content, since the false-positive guard lives in the
//     caller's blockType check, not here. Verify the text-level function
//     doesn't do anything surprising with a single embedded year.)
checkTrue("12a. hasDateEvidence still true for a bare year (SAIT Polytechnic - 2016 shape)", hasDateEvidence("SAIT Polytechnic, Calgary, AB - 2016"));
checkFalse("12b. isDateRangeLine false for a bare single year with no range", isDateRangeLine("Completed 12 projects in 2024."));
checkTrue("12c. hasDateEvidence true for a bare single year (education-only use)", hasDateEvidence("Completed 12 projects in 2024."));

// -- French preposition "à" deliberately NOT treated as a separator (documented, unevaluated risk) --
checkFalse("French 'à' is NOT a recognized separator (not added, no evidence)", isDateRangeLine("Stage à Paris, 2020"));

// -- existing shapes must not regress --
check("YYYY-MM suffix shape still works ('2019-01 - Present')", extractDateParts("2019-01 - Present")?.dateRangeText, "2019-01 - Present");
check("parenthesized single-line shape still works", extractDateParts("(2021 - Present)")?.dateRangeText, "2021 - Present");

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
