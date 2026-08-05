import { PAGE_SIZE_TWIPS, DOCX_DENSITY_SPACING, MIN_SAFE_FONT_SIZE_HALF_POINTS } from "./designTokens";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(name: string, actual: boolean) {
  console.log(actual ? "PASS" : "FAIL", name);
  if (actual) pass++;
  else fail++;
}

check("Letter width twips", PAGE_SIZE_TWIPS.letter.widthTwips, 12240);
check("Letter height twips", PAGE_SIZE_TWIPS.letter.heightTwips, 15840);
check("A4 width twips", PAGE_SIZE_TWIPS.a4.widthTwips, Math.round(210 * (1440 / 25.4)));
check("A4 height twips", PAGE_SIZE_TWIPS.a4.heightTwips, Math.round(297 * (1440 / 25.4)));

const order: Array<keyof typeof DOCX_DENSITY_SPACING> = ["comfortable", "balanced", "compact", "ultra-compact"];
for (let i = 1; i < order.length; i++) {
  const prev = DOCX_DENSITY_SPACING[order[i - 1]];
  const curr = DOCX_DENSITY_SPACING[order[i]];
  checkTrue(`${order[i]} pageMargin <= ${order[i - 1]}`, curr.pageMarginTwips <= prev.pageMarginTwips);
  checkTrue(`${order[i]} sectionSpacing <= ${order[i - 1]}`, curr.sectionSpacingBeforeTwips <= prev.sectionSpacingBeforeTwips);
  checkTrue(`${order[i]} fontSize <= ${order[i - 1]}`, curr.fontSizeHalfPoints <= prev.fontSizeHalfPoints);
}

for (const density of order) {
  checkTrue(`${density} fontSize >= safety floor`, DOCX_DENSITY_SPACING[density].fontSizeHalfPoints >= MIN_SAFE_FONT_SIZE_HALF_POINTS);
  checkTrue(`${density} lineSpacing >= 240 (1.0x floor)`, DOCX_DENSITY_SPACING[density].lineSpacingTwips >= 240);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
