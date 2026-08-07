/*
  Phase 5D.6 TASK B gate test - normalizeBulletPresentation(). Pure
  unit-level (no document pipeline needed - the function's only inputs
  are text + blockType). Covers: every decorative glyph shape Phase 1's
  own BULLET_PREFIX_RE recognizes plus this module's superset, checkbox
  markers, ordered markers on bullet-classified blocks (defensive),
  semantic-numbered-heading preservation on non-bullet blocks (the
  round's own named "1) xEV Battery Development Leadership" case), and
  explicit negative controls proving a genuine leading em-dash/number in
  prose is never corrupted.

  Run with `npx tsx lib/documentPreservation/resumeStructured/bulletPresentation.test.ts`.
*/
import { normalizeBulletPresentation, type BulletMarkerKind } from "./bulletPresentation";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

function scenario(
  label: string,
  text: string,
  blockType: string,
  expectedDisplayText: string,
  expectedMarkerKind: BulletMarkerKind,
) {
  const result = normalizeBulletPresentation(text, { blockType });
  check(`${label}: displayText`, result.displayText, expectedDisplayText);
  check(`${label}: markerKind`, result.markerKind, expectedMarkerKind);
  check(`${label}: sourceText echoes input`, result.sourceText, text);
}

// --- Decorative glyph markers on blockType:"bullet" (safe to strip) ---
scenario("bullet-glyph-solid-round", "• Managed a team of 5", "bullet", "Managed a team of 5", "unordered");
scenario("bullet-glyph-hyphen", "- Led quarterly planning", "bullet", "Led quarterly planning", "unordered");
scenario("bullet-glyph-asterisk", "* Increased revenue by 12%", "bullet", "Increased revenue by 12%", "unordered");
scenario("bullet-glyph-white-circle", "◦ Sub-bullet detail", "bullet", "Sub-bullet detail", "unordered");
scenario("bullet-glyph-black-square", "▪ Square bullet detail", "bullet", "Square bullet detail", "unordered");
scenario("bullet-glyph-middle-dot", "· Middle dot bullet detail", "bullet", "Middle dot bullet detail", "unordered");
scenario("bullet-glyph-triangular", "‣ Triangular bullet detail", "bullet", "Triangular bullet detail", "unordered");
scenario("bullet-glyph-hyphen-bullet-variant", "⁃ Hyphen bullet variant", "bullet", "Hyphen bullet variant", "unordered");
scenario("bullet-glyph-filled-circle", "● Filled circle bullet", "bullet", "Filled circle bullet", "unordered");
scenario("bullet-glyph-open-circle", "○ Open circle bullet", "bullet", "Open circle bullet", "unordered");
scenario("bullet-glyph-filled-square", "■ Filled square bullet", "bullet", "Filled square bullet", "unordered");
scenario("bullet-glyph-open-square", "□ Open square bullet", "bullet", "Open square bullet", "unordered");
scenario("bullet-glyph-en-dash", "– En dash bullet detail", "bullet", "En dash bullet detail", "unordered");
scenario("bullet-glyph-em-dash", "— Em dash bullet detail", "bullet", "Em dash bullet detail", "unordered");
scenario("bullet-glyph-extra-spaces", "•    Extra spaces after marker", "bullet", "Extra spaces after marker", "unordered");
scenario("bullet-glyph-only-strips-one-marker", "• - Two markers stacked", "bullet", "- Two markers stacked", "unordered");

// --- Defensive ordered markers on blockType:"bullet" (not reachable via current Phase 1 BULLET_PREFIX_RE, still exercised) ---
scenario("bullet-ordered-numeral-period", "1. Complete onboarding checklist", "bullet", "Complete onboarding checklist", "ordered");
scenario("bullet-ordered-numeral-paren", "2) Review annual budget", "bullet", "Review annual budget", "ordered");
scenario("bullet-ordered-letter-period", "a. First deployment step", "bullet", "First deployment step", "ordered");
scenario("bullet-ordered-letter-paren", "b) Second deployment step", "bullet", "Second deployment step", "ordered");

// --- blockType:"bullet" with no recognizable marker at all (never invent a strip) ---
scenario("bullet-no-marker", "Delivered training to 40+ staff", "bullet", "Delivered training to 40+ staff", "none");
scenario("bullet-dash-attached-no-space", "-5 years of direct experience", "bullet", "-5 years of direct experience", "none");

// --- Checkbox markers (decorative regardless of blockType) ---
scenario("checkbox-empty-paragraph", "[ ] Task not yet started", "paragraph", "Task not yet started", "checkbox");
scenario("checkbox-lowercase-x-paragraph", "[x] Task completed", "paragraph", "Task completed", "checkbox");
scenario("checkbox-uppercase-x-bullet", "[X] Task completed in caps", "bullet", "Task completed in caps", "checkbox");
scenario("checkbox-unicode-unchecked", "☐ Unchecked box item", "paragraph", "Unchecked box item", "checkbox");
scenario("checkbox-unicode-checked", "☑ Checked box item", "paragraph", "Checked box item", "checkbox");
scenario("checkbox-priority-over-decorative", "[x] • redundant marker after checkbox", "bullet", "• redundant marker after checkbox", "checkbox");

// --- Semantic numbered heading: NON-bullet blockType, number/letter is real content, NEVER stripped ---
scenario("semantic-heading-round-own-example", "1) xEV Battery Development Leadership", "paragraph", "1) xEV Battery Development Leadership", "semantic-numbered-heading");
scenario("semantic-heading-entry-header-blocktype", "2) Global Supply Chain Transformation", "entry-header", "2) Global Supply Chain Transformation", "semantic-numbered-heading");
scenario("semantic-heading-period-style", "3. Digital Manufacturing Initiative", "paragraph", "3. Digital Manufacturing Initiative", "semantic-numbered-heading");
scenario("semantic-heading-paren-wrapped", "(1) Strategic Planning Council", "paragraph", "(1) Strategic Planning Council", "semantic-numbered-heading");
scenario("semantic-heading-uppercase-letter", "A) Regional Operations Leadership", "paragraph", "A) Regional Operations Leadership", "semantic-numbered-heading");
scenario("semantic-heading-lowercase-letter", "a) Regional Operations Leadership Lower", "paragraph", "a) Regional Operations Leadership Lower", "semantic-numbered-heading");
scenario("semantic-heading-multi-digit", "10) Tenth Initiative In A Long Career", "paragraph", "10) Tenth Initiative In A Long Career", "semantic-numbered-heading");
scenario("semantic-heading-heading-blocktype", "B. Divisional Restructuring", "heading", "B. Divisional Restructuring", "semantic-numbered-heading");
scenario("semantic-heading-unknown-blocktype", "4) Program Launched Under Unknown Classification", "unknown", "4) Program Launched Under Unknown Classification", "semantic-numbered-heading");
scenario("semantic-heading-metadata-blocktype", "5. Metadata-Classified Numbered Line", "metadata", "5. Metadata-Classified Numbered Line", "semantic-numbered-heading");

// --- Negative controls: genuine leading dash/number in prose must never be corrupted ---
scenario("negative-control-leading-em-dash-quote", "— This program transformed our results", "paragraph", "— This program transformed our results", "none");
scenario("negative-control-year-not-marker", "2023 Global Excellence Award", "paragraph", "2023 Global Excellence Award", "none");
scenario("negative-control-phone-like-parenthetical", "(555) 123-4567 contact line", "paragraph", "(555) 123-4567 contact line", "semantic-numbered-heading");
scenario("negative-control-bracketed-word-not-checkbox", "[Design] Approved for release", "paragraph", "[Design] Approved for release", "none");
scenario("negative-control-compound-skill-unaffected", "C++ and Java experience", "paragraph", "C++ and Java experience", "none");
scenario("negative-control-empty-string", "", "bullet", "", "none");
scenario("negative-control-decimal-not-ordered", "3.5 years average tenure", "paragraph", "3.5 years average tenure", "none");

// --- originalMarker is populated correctly for each markerKind family ---
{
  const r1 = normalizeBulletPresentation("• Managed a team of 5", { blockType: "bullet" });
  check("originalMarker: decorative glyph trimmed", r1.originalMarker, "•");
  const r2 = normalizeBulletPresentation("1) xEV Battery Development Leadership", { blockType: "paragraph" });
  check("originalMarker: semantic-numbered-heading trimmed", r2.originalMarker, "1)");
  const r3 = normalizeBulletPresentation("[x] Task completed", { blockType: "paragraph" });
  check("originalMarker: checkbox trimmed", r3.originalMarker, "[x]");
  const r4 = normalizeBulletPresentation("No marker here", { blockType: "paragraph" });
  check("originalMarker: undefined when markerKind is none", r4.originalMarker, undefined);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
