/*
  Phase 6F.1 - extractVisibleTextFromHtml()/decodeEntities() hardening
  gate test. Pure synthetic HTML strings (no real resume text, no PII)
  - reproduces the exact real-resume-discovered bug directly against
  htmlText.ts.

  Root cause (see htmlText.ts's own header comment above the fix):
  React's renderToStaticMarkup escapes a literal straight apostrophe as
  the HEX numeric entity "&#x27;", never the decimal form "&#39;" - the
  old decodeEntities() regex only matched "#(\d+)" (decimal digits),
  so "&#x27;" survived as a literal 6-character string in "extracted"
  text instead of decoding back to a single "'", breaking substring
  containment against any expected fragment that legitimately contains
  a possessive/contraction apostrophe (confirmed via direct isolated
  reproduction against a real "father" resume bullet - never against
  its literal text here, only via this synthetic re-creation of the
  exact same entity shape).

  Run with `npx tsx lib/resumeTemplates/tests/htmlTextEntityDecoding.test.ts`.
*/
import { extractVisibleTextFromHtml } from "../shared/htmlText";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// --- 1. The real bug shape: React's own hex numeric apostrophe entity ---
check("hex numeric apostrophe entity &#x27; decodes to '", extractVisibleTextFromHtml("<span>company&#x27;s</span>"), "company's");
check("uppercase hex numeric apostrophe entity &#X27; also decodes to '", extractVisibleTextFromHtml("<span>company&#X27;s</span>"), "company's");
check("multiple hex apostrophes in one string all decode", extractVisibleTextFromHtml("<li>it&#x27;s the client&#x27;s decision</li>"), "it's the client's decision");

// --- 2. Decimal numeric entity (the pre-existing, already-working case) still works ---
check("decimal numeric apostrophe entity &#39; still decodes to '", extractVisibleTextFromHtml("<span>company&#39;s</span>"), "company's");

// --- 3. Named entities (amp/lt/gt/quot/apos/nbsp) still work, unaffected by the fix ---
check("named entity &amp; decodes to &", extractVisibleTextFromHtml("<span>P&amp;L</span>"), "P&L");
check("named entity &lt; decodes to <", extractVisibleTextFromHtml("<span>a &lt; b</span>"), "a < b");
check("named entity &gt; decodes to >", extractVisibleTextFromHtml("<span>a &gt; b</span>"), "a > b");
check("named entity &quot; decodes to a straight double quote", extractVisibleTextFromHtml("<span>&quot;quoted&quot;</span>"), '"quoted"');
check("named entity &apos; decodes to '", extractVisibleTextFromHtml("<span>&apos;quoted&apos;</span>"), "'quoted'");
check("named entity &nbsp; decodes to a plain space (then collapses)", extractVisibleTextFromHtml("<span>a&nbsp;b</span>"), "a b");

// --- 4. Other hex numeric code points beyond apostrophe (generic, not apostrophe-only fix) ---
check("hex numeric entity for a non-apostrophe code point decodes correctly (&#x41; = 'A')", extractVisibleTextFromHtml("<span>&#x41;BC</span>"), "ABC");
check("decimal numeric entity for the same code point still works (&#65; = 'A')", extractVisibleTextFromHtml("<span>&#65;BC</span>"), "ABC");

// --- 5. Mixed hex + decimal + named in one string ---
check("mixed hex/decimal/named entities in one string all decode", extractVisibleTextFromHtml("<p>Owner&#x27;s note: R&amp;D at 100&#37;</p>"), "Owner's note: R&D at 100%");

// --- 6. A malformed/incomplete entity-like sequence is left untouched (never a false match) ---
check("a bare '&' not part of any recognized entity is left as-is", extractVisibleTextFromHtml("<span>Q&A</span>"), "Q&A");
check("an unrecognized hex-looking sequence with no trailing semicolon is left as-is", extractVisibleTextFromHtml("<span>a&#x27b</span>"), "a&#x27b");

// --- 7. Tag stripping + whitespace collapse still work exactly as before, unaffected by the entity fix ---
check("tags are stripped to single spaces and whitespace collapses", extractVisibleTextFromHtml("<div><p>Hello</p>\n  <p>World</p></div>"), "Hello World");
check("style/script blocks are stripped entirely", extractVisibleTextFromHtml("<style>.x{color:red}</style><span>Visible</span><script>alert(1)</script>"), "Visible");

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
