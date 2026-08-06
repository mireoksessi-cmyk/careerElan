/*
  Phase 5D.6D TASK D2 gate test - blockAdapter.ts's lineText()
  gap-aware space join. Pure synthetic (no real PDF needed) - builds a
  minimal LayoutAnalysisResult with hand-placed ElementMetadata
  geometry (x/width/height, the exact fields pdfLayoutAnalyzer.ts
  already captures from pdfjs) and calls the real, exported
  adaptLayoutToBlocks(). Hand-authored expected rawText throughout.

  Covers every ligature shape the round names (fi/fl/ff/ffi/ffl) at
  word start/middle/end, adjacent punctuation, French accented words,
  and - just as important - the round's own explicit "must still
  insert a real space" acceptance cases ("office file", "profile
  file", "staff office", "official document") proving the fix never
  swallows a genuine word boundary.

  Run with `npx tsx lib/documentPreservation/losslessSemantic/lineTextSpacing.test.ts`.
*/
import { adaptLayoutToBlocks } from "./blockAdapter";
import type { ElementMetadata, LayoutAnalysisResult } from "../layoutAnalysis/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

const FONT_SIZE = 12;
const CHAR_WIDTH = 7; // rough monospace-equivalent glyph advance for these synthetic tests

function el(text: string, x: number, width: number): ElementMetadata {
  return {
    type: "text",
    text,
    x,
    y: 100,
    width,
    height: FONT_SIZE,
    fontSize: FONT_SIZE,
    fontFamily: "Arial",
    fontWeight: null,
    color: null,
  };
}

function layoutFromElements(elements: ElementMetadata[]): LayoutAnalysisResult {
  return {
    documentType: "resume",
    pageCount: 1,
    pages: [{ pageNumber: 0, width: 612, height: 792, orientation: "portrait", elements }],
    metadata: { sourceFormat: "pdf", pageCount: 1, parserVersion: null },
  };
}

function rawTextOf(elements: ElementMetadata[]): string {
  return adaptLayoutToBlocks(layoutFromElements(elements)).blocks[0]?.rawText ?? "";
}

/* Two adjacent TextItems with essentially no real gap (touching/kerned,
   exactly the shape pdfjs produces when it splits one word into two
   glyph runs at a ligature boundary) - must join with NO space. */
function touchingPair(prefix: string, suffix: string): ElementMetadata[] {
  const prefixWidth = prefix.length * CHAR_WIDTH;
  return [el(prefix, 0, prefixWidth), el(suffix, prefixWidth - 0.2, suffix.length * CHAR_WIDTH)];
}

/* Two genuinely separate words with a real word-space gap (~30% of
   font size, comfortably above SPACE_GAP_RATIO) - must join WITH a
   space, proving the fix never swallows a real word boundary. */
function realWordGapPair(first: string, second: string): ElementMetadata[] {
  const firstWidth = first.length * CHAR_WIDTH;
  const gap = FONT_SIZE * 0.3;
  return [el(first, 0, firstWidth), el(second, firstWidth + gap, second.length * CHAR_WIDTH)];
}

function checkMerge(label: string, prefix: string, suffix: string) {
  check(`${label}: touching split glyph-run joins with no space`, rawTextOf(touchingPair(prefix, suffix)), prefix + suffix);
}

function checkPreservedSpace(label: string, first: string, second: string) {
  check(`${label}: real word-space gap preserved`, rawTextOf(realWordGapPair(first, second)), `${first} ${second}`);
}

// --- fi ligature: word start/middle/end ---
checkMerge("fi-word-start", "fi", "le");
checkMerge("fi-word-middle", "pro", "file");
checkMerge("fi-word-middle-2", "of", "fice");
checkMerge("fi-word-end", "identi", "fi");
checkMerge("fi-french-profil", "pro", "fil");
checkMerge("fi-french-fichier", "fi", "chier");

// --- fl ligature: word start/middle/end ---
checkMerge("fl-word-start", "fl", "ow");
checkMerge("fl-word-middle", "work", "flow");
checkMerge("fl-word-middle-2", "in", "flate");
checkMerge("fl-word-end", "confl", "ict");

// --- ff ligature: word start/middle/end ---
checkMerge("ff-word-start", "ff", "set");
checkMerge("ff-word-middle", "sta", "ff");
checkMerge("ff-word-middle-2", "o", "ffice");
checkMerge("ff-word-end", "sheri", "ff");

// --- ffi ligature ---
checkMerge("ffi-word-middle", "o", "ffice");
checkMerge("ffi-word-middle-2", "e", "fficient");
checkMerge("ffi-word-middle-3", "a", "ffiliated");
checkMerge("ffi-word-end", "sta", "ffi");

// --- ffl ligature ---
checkMerge("ffl-word-middle", "sta", "ffling");
checkMerge("ffl-word-middle-2", "shu", "ffle");

// --- Round's own named words ---
checkMerge("named-file", "fi", "le");
checkMerge("named-profile", "pro", "file");
checkMerge("named-office", "of", "fice");
checkMerge("named-official", "of", "ficial");
checkMerge("named-efficient", "e", "fficient");
checkMerge("named-affinity", "a", "ffinity");
checkMerge("named-workflow", "work", "flow");
checkMerge("named-staff", "sta", "ff");
checkMerge("named-affiliated", "a", "ffiliated");
checkMerge("named-fulfill", "fulfi", "ll");
checkMerge("named-officiel-french", "offici", "el");
checkMerge("named-efficacite-french", "effica", "cité");
checkMerge("named-affiliation", "a", "ffiliation");

// --- Adjacent punctuation: touching glyph run immediately followed by punctuation ---
{
  const parts = touchingPair("of", "fice");
  const withComma = [...parts, el(",", parts[1].x! + parts[1].width! - 0.1, 4)];
  check("adjacent-comma: 'office,' - no space before comma, no space inside the split word", rawTextOf(withComma), "office,");
}
{
  const parts = touchingPair("pro", "file");
  const withParen = [...parts, el(")", parts[1].x! + parts[1].width! - 0.1, 4)];
  check("adjacent-paren: 'profile)' - no space before closing paren", rawTextOf(withParen), "profile)");
}
{
  const parts = touchingPair("e", "fficient");
  const withPeriod = [...parts, el(".", parts[1].x! + parts[1].width! - 0.1, 4)];
  check("adjacent-period: 'efficient.' - no space before period", rawTextOf(withPeriod), "efficient.");
}
{
  const parts = touchingPair("sta", "ff");
  const withDash = [...parts, el("-level", parts[1].x! + parts[1].width! - 0.1, 30)];
  check("adjacent-dash: 'staff-level' - no space before attached dash-suffix", rawTextOf(withDash), "staff-level");
}
{
  const beforeSlash = el("of", 0, 14);
  const slash = el("/", 14 - 0.1, 4);
  const afterFice = el("fice", 18 - 0.1, 28);
  check("adjacent-slash: 'of/fice' shape - no spurious space around touching slash+split-word", rawTextOf([beforeSlash, slash, afterFice]), "of/fice");
}

// --- Word-boundary preservation (round's own explicit acceptance cases) ---
checkPreservedSpace("boundary-office-file", "office", "file");
checkPreservedSpace("boundary-profile-file", "profile", "file");
checkPreservedSpace("boundary-staff-office", "staff", "office");
checkPreservedSpace("boundary-official-document", "official", "document");
checkPreservedSpace("boundary-workflow-management", "workflow", "management");
checkPreservedSpace("boundary-efficient-team", "efficient", "team");

// --- Three-element line mixing a genuine word-space with a touching split ---
{
  const wordA = el("Managed", 0, 50);
  const gapToSplit = FONT_SIZE * 0.3;
  const splitPrefix = el("of", wordA.x! + wordA.width! + gapToSplit, 14);
  const splitSuffix = el("fice", splitPrefix.x! + splitPrefix.width! - 0.15, 28);
  check("mixed-line: real word-space before a touching split pair", rawTextOf([wordA, splitPrefix, splitSuffix]), "Managed office");
}
{
  const splitPrefix = el("pro", 0, 21);
  const splitSuffix = el("file", 21 - 0.2, 28);
  const gapToWord = FONT_SIZE * 0.3;
  const wordB = el("updated", splitSuffix.x! + splitSuffix.width! + gapToWord, 50);
  check("mixed-line: touching split pair followed by a real word-space", rawTextOf([splitPrefix, splitSuffix, wordB]), "profile updated");
}

// --- Negative gap (kerning pulls glyphs together, even overlapping slightly) ---
{
  const prefix = el("e", 0, 7);
  const suffix = el("fficient", 6.5, 56); // starts 0.5pt before prefix's right edge - real kerning overlap
  check("negative-gap: overlapping kerned glyph run still merges with no space", rawTextOf([prefix, suffix]), "efficient");
}

// --- Missing bbox falls back to the old always-space behavior (never guesses) ---
{
  const noBboxPrefix: ElementMetadata = { type: "text", text: "of", x: null, y: 100, width: null, height: 12, fontSize: 12, fontFamily: null, fontWeight: null, color: null };
  const noBboxSuffix: ElementMetadata = { type: "text", text: "fice", x: null, y: 100, width: null, height: 12, fontSize: 12, fontFamily: null, fontWeight: null, color: null };
  check("missing-bbox: falls back to always-space (conservative default)", rawTextOf([noBboxPrefix, noBboxSuffix]), "of fice");
}

// --- Additional ligature coverage ---
checkMerge("ff-waffle", "wa", "ffle");
checkMerge("ffi-difficult", "di", "fficult");
checkMerge("fi-classify", "classi", "fy");
checkMerge("fl-reflect", "re", "flect");

// --- URL/contact text nearby a touching split (round's own D2 case) ---
{
  const parts = touchingPair("of", "fice");
  const gap = FONT_SIZE * 0.3;
  const email = el("@example.com", parts[1].x! + parts[1].width! + gap, 70);
  check("url-contact-nearby: 'office' merges, real gap before '@example.com' preserved", rawTextOf([...parts, email]), "office @example.com");
}

// --- Line-wrap: split across two DIFFERENT physical lines (different y) must NOT merge - this is a separate block boundary, never lineText's concern ---
{
  const line1El = el("of", 0, 14);
  const line2El = el("fice", 0, 28);
  line2El.y = 120; // a full line below - genuinely a different line
  const result = adaptLayoutToBlocks(layoutFromElements([line1El, line2El]));
  check("line-wrap: elements on different physical lines become separate blocks, never spliced together", result.blocks.map((b) => b.rawText), ["of", "fice"]);
}

// --- DOCX source format uses the exact same join logic (adaptPage does not branch on sourceFormat) ---
{
  const docxLayout: LayoutAnalysisResult = {
    documentType: "resume",
    pageCount: 1,
    pages: [{ pageNumber: 0, width: 612, height: 792, orientation: "portrait", elements: touchingPair("pro", "file") }],
    metadata: { sourceFormat: "docx", pageCount: 1, parserVersion: null },
  };
  check("docx-source-format: touching split still merges with no space", adaptLayoutToBlocks(docxLayout).blocks[0]?.rawText, "profile");
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
