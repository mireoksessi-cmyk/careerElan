/*
  TASK 2 gate test - design tokens. Run with
  `npx tsx lib/documentPreservation/professionalAtsHtml/designTokens.test.ts`.
*/
import { PROFESSIONAL_ATS_FONT_STACK, PAPER_DIMENSIONS, DENSITY_SPACING, DENSITY_ESCALATION_ORDER, MIN_SAFE_FONT_SIZE_PT, MIN_SAFE_LINE_HEIGHT } from "./designTokens";

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

check("font stack reuses the project's existing body font-family (no new font files)", PROFESSIONAL_ATS_FONT_STACK, "Arial, Helvetica, sans-serif");

check("letter dimensions", PAPER_DIMENSIONS.letter, { width: "8.5in", height: "11in", margin: "0.6in" });
check("a4 dimensions", PAPER_DIMENSIONS.a4, { width: "210mm", height: "297mm", margin: "15mm" });

check("exactly 4 density steps in fixed order", DENSITY_ESCALATION_ORDER, ["comfortable", "balanced", "compact", "ultra-compact"]);
check("DENSITY_SPACING has exactly the 4 density keys", Object.keys(DENSITY_SPACING).sort(), ["balanced", "comfortable", "compact", "ultra-compact"].sort());

for (const density of DENSITY_ESCALATION_ORDER) {
  const tokens = DENSITY_SPACING[density];
  checkTrue(`${density}: font size never below the safety floor (${MIN_SAFE_FONT_SIZE_PT}pt)`, tokens.fontSizePt >= MIN_SAFE_FONT_SIZE_PT);
  checkTrue(`${density}: line-height never below the safety floor (${MIN_SAFE_LINE_HEIGHT})`, tokens.lineHeight >= MIN_SAFE_LINE_HEIGHT);
}

checkTrue(
  "spacing strictly decreases (or stays equal) at every escalation step - never increases going from comfortable to ultra-compact",
  DENSITY_ESCALATION_ORDER.every((density, i) => {
    if (i === 0) return true;
    const prev = DENSITY_SPACING[DENSITY_ESCALATION_ORDER[i - 1]];
    const curr = DENSITY_SPACING[density];
    return (
      curr.pagePaddingPx <= prev.pagePaddingPx &&
      curr.sectionGapPx <= prev.sectionGapPx &&
      curr.entryGapPx <= prev.entryGapPx &&
      curr.bulletGapPx <= prev.bulletGapPx &&
      curr.lineHeight <= prev.lineHeight
    );
  })
);

checkTrue("comfortable is strictly the most spacious step (sanity check against a no-op token table)", DENSITY_SPACING.comfortable.sectionGapPx > DENSITY_SPACING["ultra-compact"].sectionGapPx);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
