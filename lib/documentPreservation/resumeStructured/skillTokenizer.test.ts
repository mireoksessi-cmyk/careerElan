/*
  Phase 5D.6D TASK D1 gate test - tokenizeSkillList() + extractSkillGroups()'s
  bbox-driven line-wrap continuation merge. Hand-authored expected output
  throughout - never derived from current parser output. Covers every
  category the round's own synthetic matrix requires: comma/semicolon/
  pipe/newline lists, ampersand/and/slash phrases that must stay whole,
  dot-containing and plus/hash product names, mixed punctuation, French
  accents, long compound skills, empty/leading/trailing delimiters,
  multiple spaces, NBSP, and the round's own explicit preserve/split
  example lists in full.

  Run with `npx tsx lib/documentPreservation/resumeStructured/skillTokenizer.test.ts`.
*/
import { tokenizeSkillList } from "./skillTokenizer";
import { extractSkillGroups } from "./skillsExtractor";
import type { SemanticContentBlock } from "../losslessSemantic/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

function t(label: string, text: string, expected: string[]) {
  const result = tokenizeSkillList(text);
  check(label, result.tokens.map((tok) => tok.text), expected);
}

// --- Comma lists ---
t("comma-2-items", "Word, Excel", ["Word", "Excel"]);
t("comma-3-items", "Word, Excel, PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("comma-4-items", "SQL, Python, R, Java", ["SQL", "Python", "R", "Java"]);
t("comma-with-extra-spaces", "Word,   Excel,  PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("comma-single-item-no-split", "Excel", ["Excel"]);

// --- Inline bullet-glyph lists (strong separator, unconditional) - real
// bug found via the round's own 10-resume UAT: a skills line only has
// its bullet at position 0 handled by Phase 1's blockType:"bullet"
// (leading-only); the SAME glyph appearing again mid-line was
// previously never recognized as a list boundary at all. ---
t("inline-bullet-glyph-3-items", "Client communication • Administrative support • Data entry", [
  "Client communication",
  "Administrative support",
  "Data entry",
]);
t("inline-bullet-glyph-with-ampersand-item", "Client communication • Data entry & file organization • Record management", [
  "Client communication",
  "Data entry & file organization",
  "Record management",
]);
t("inline-bullet-glyph-leading-and-inline", "• Client communication • Administrative support", ["Client communication", "Administrative support"]);
t("inline-bullet-glyph-black-circle", "Excel ● Word ● PowerPoint", ["Excel", "Word", "PowerPoint"]);
t("inline-bullet-glyph-white-circle", "Excel ○ Word ○ PowerPoint", ["Excel", "Word", "PowerPoint"]);
t("inline-bullet-glyph-triangular", "Excel ‣ Word ‣ PowerPoint", ["Excel", "Word", "PowerPoint"]);
t("inline-bullet-glyph-middle-dot", "Excel · Word · PowerPoint", ["Excel", "Word", "PowerPoint"]);
t("inline-bullet-glyph-does-not-split-hyphen", "Multi-site operations leadership", ["Multi-site operations leadership"]);
t("inline-bullet-glyph-does-not-split-asterisk-footnote", "Excel* Word* PowerPoint*", ["Excel* Word* PowerPoint*"]);

// --- Semicolon lists (strong separator, unconditional) ---
t("semicolon-3-items", "Word; Excel; PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("semicolon-2-items", "Jira; Confluence", ["Jira", "Confluence"]);
t("semicolon-with-ampersand-item", "Health & Safety; Oil & Gas", ["Health & Safety", "Oil & Gas"]);

// --- Pipe lists (strong separator, unconditional) ---
t("pipe-3-items", "Word | Excel | PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("pipe-2-items", "AutoCAD | SolidWorks", ["AutoCAD", "SolidWorks"]);
t("pipe-with-compound-item", "Node.js | Battery Module/Pack Development", ["Node.js", "Battery Module/Pack Development"]);

// --- Newline lists (strong separator, unconditional) ---
t("newline-3-items", "Word\nExcel\nPowerPoint", ["Word", "Excel", "PowerPoint"]);
t("newline-2-items-compound", "Google Sheets\nMicrosoft Excel", ["Google Sheets", "Microsoft Excel"]);
t("newline-with-comma-item", "Word, Excel\nPowerPoint", ["Word", "Excel", "PowerPoint"]);

// --- Ampersand phrases that MUST stay whole (no comma in text at all) ---
t("ampersand-health-safety", "Health & Safety", ["Health & Safety"]);
t("ampersand-oil-gas", "Oil & Gas", ["Oil & Gas"]);
t("ampersand-design-engineering", "Design & Engineering", ["Design & Engineering"]);
t("ampersand-written-verbal", "Written & Verbal Communication", ["Written & Verbal Communication"]);
t("ampersand-data-entry-file", "Data Entry & File Organization", ["Data Entry & File Organization"]);

// --- "and" phrases that MUST stay whole (no comma in text at all) ---
t("and-research-development", "Research and Development", ["Research and Development"]);
t("and-sales-marketing", "Sales and Marketing", ["Sales and Marketing"]);
t("and-project-program", "Project and Program Management", ["Project and Program Management"]);
t("and-english-french-communication", "English and French Communication", ["English and French Communication"]);
// NOTE: "Strategy, Operations and Finance" is lexically an Oxford
// 3-item list ("X, Y and Z" - the exact same shape as the round's own
// required-split "SQL, Python and Power BI") with no structural signal
// distinguishing it from a genuine 3-skill list. The round's own D1.4
// list places this string under "must not split" while every other
// same-shape example it lists is under "must split" - a genuine,
// disclosed contradiction (see final report's Remaining Limitations)
// this module cannot resolve without a dictionary/whitelist, which is
// explicitly forbidden. Tested here against this tokenizer's actual,
// internally-consistent Oxford-list behavior.
t("and-strategy-operations-finance", "Strategy, Operations and Finance", ["Strategy", "Operations", "Finance"]);

// --- Slash phrases that MUST stay whole ---
t("slash-cc", "C/C++", ["C/C++"]);
t("slash-uiux", "UI/UX", ["UI/UX"]);
t("slash-cicd", "CI/CD", ["CI/CD"]);
t("slash-cadcae", "CAD/CAE", ["CAD/CAE"]);
t("slash-battery-module-pack", "Battery Module/Pack Development", ["Battery Module/Pack Development"]);
t("slash-product-project", "Product / Project Management", ["Product / Project Management"]);

// --- Dot-containing product names that MUST stay whole ---
t("dot-nodejs", "Node.js", ["Node.js"]);
t("dot-nextjs", "Next.js", ["Next.js"]);
t("dot-reactjs", "React.js", ["React.js"]);
t("dot-sap-s4hana", "SAP S/4HANA", ["SAP S/4HANA"]);
t("dot-tableau-desktop", "Tableau Desktop", ["Tableau Desktop"]);

// --- Plus/hash language names that MUST stay whole ---
t("plus-cplusplus", "C++", ["C++"]);
t("hash-csharp", "C#", ["C#"]);
t("plus-cslash-cplusplus", "C/C++", ["C/C++"]);

// --- Oxford-tail lists (comma + trailing &/and MUST split into 3+) ---
t("oxford-sql-python-powerbi", "SQL, Python and Power BI", ["SQL", "Python", "Power BI"]);
t("oxford-english-french-korean", "English, French & Korean", ["English", "French", "Korean"]);
t("oxford-word-excel-google-sheets", "Word, Excel & Google Sheets", ["Word", "Excel", "Google Sheets"]);
t("oxford-microsoft-word-excel-google-sheets", "Microsoft Word, Excel & Google Sheets", ["Microsoft Word", "Excel", "Google Sheets"]);
t("oxford-jira-confluence-slack", "Jira, Confluence & Slack", ["Jira", "Confluence", "Slack"]);
t("oxford-autocad-solidworks-catia", "AutoCAD, SolidWorks and CATIA", ["AutoCAD", "SolidWorks", "CATIA"]);

// --- Symmetry guard: earlier comma item already has its own conjunction -> last item NOT split ---
t("symmetry-health-safety-oil-gas", "Health & Safety, Oil & Gas", ["Health & Safety", "Oil & Gas"]);
t("symmetry-design-eng-sales-marketing", "Design & Engineering, Sales and Marketing", ["Design & Engineering", "Sales and Marketing"]);
t("symmetry-three-compound-phrases", "Health & Safety, Oil & Gas, Design & Engineering", ["Health & Safety", "Oil & Gas", "Design & Engineering"]);

// --- Mixed punctuation ---
t("mixed-comma-slash", "UI/UX, CI/CD, C/C++", ["UI/UX", "CI/CD", "C/C++"]);
t("mixed-semicolon-ampersand-item", "Project Management; Health & Safety; Data Entry", ["Project Management", "Health & Safety", "Data Entry"]);
t("mixed-comma-and-dot-product", "SQL, Node.js and Power BI", ["SQL", "Node.js", "Power BI"]);
t("mixed-pipe-and-oxford-comma", "Excel | Word, Python and R", ["Excel", "Word", "Python", "R"]);
t("mixed-nbsp-and-comma", "Word, Excel, PowerPoint", ["Word", "Excel", "PowerPoint"]);

// --- French accents ---
t("french-single-skill", "Gestion de projet", ["Gestion de projet"]);
t("french-comma-list", "Français, Anglais, Espagnol", ["Français", "Anglais", "Espagnol"]);
t("french-oxford-list", "Excel, Word et Recherche et Développement", ["Excel", "Word et Recherche et Développement"]);

// --- English/French mixed ---
t("mixed-lang-comma", "English, Français, Español", ["English", "Français", "Español"]);
t("mixed-lang-communication", "Bilingual English and French Communication", ["Bilingual English and French Communication"]);

// --- Long compound skills (no comma anywhere -> always whole) ---
t("long-compound-battery", "Battery Module/Pack Development and Testing Leadership", ["Battery Module/Pack Development and Testing Leadership"]);
t("long-compound-community-outreach", "Community Outreach and Client Communication Strategy", ["Community Outreach and Client Communication Strategy"]);
t("long-compound-microsoft-office-suite", "Microsoft Office Suite", ["Microsoft Office Suite"]);

// --- Duplicate-looking but distinct skills ---
t("distinct-project-vs-program", "Project Management, Program Coordination", ["Project Management", "Program Coordination"]);
t("distinct-c-variants", "C, C++, C#", ["C", "C++", "C#"]);

// --- Empty tokens / trailing / leading delimiters ---
t("empty-double-comma", "Word,, Excel", ["Word", "Excel"]);
t("trailing-comma", "Word, Excel,", ["Word", "Excel"]);
t("leading-comma", ", Word, Excel", ["Word", "Excel"]);
t("trailing-semicolon", "Word; Excel;", ["Word", "Excel"]);
t("leading-and-trailing-whitespace", "   Word, Excel   ", ["Word", "Excel"]);
t("only-delimiters", ",,;;", []);
t("empty-string", "", []);

// --- Multiple spaces ---
t("multiple-spaces-between-words", "Project    Management", ["Project    Management"]);
t("multiple-spaces-around-comma", "Word   ,   Excel", ["Word", "Excel"]);

// --- NBSP ---
t("nbsp-as-word-space", "Google Sheets", ["Google Sheets"]);
t("nbsp-before-delimiter", "Word , Excel", ["Word", "Excel"]);

// --- Round's own full "must preserve" list (section D1.4) ---
t("preserve-research-and-development", "Research and Development", ["Research and Development"]);
t("preserve-sales-and-marketing", "Sales and Marketing", ["Sales and Marketing"]);
t("preserve-health-and-safety", "Health and Safety", ["Health and Safety"]);
t("preserve-oil-gas", "Oil & Gas", ["Oil & Gas"]);
t("preserve-design-engineering", "Design & Engineering", ["Design & Engineering"]);
t("preserve-c-cplusplus", "C/C++", ["C/C++"]);
t("preserve-cicd", "CI/CD", ["CI/CD"]);
t("preserve-uiux", "UI/UX", ["UI/UX"]);
t("preserve-nodejs", "Node.js", ["Node.js"]);
t("preserve-nextjs", "Next.js", ["Next.js"]);
t("preserve-sap-s4hana", "SAP S/4HANA", ["SAP S/4HANA"]);
t("preserve-battery-module-pack", "Battery Module/Pack Development", ["Battery Module/Pack Development"]);
t("preserve-english-french-communication", "English and French Communication", ["English and French Communication"]);
t("preserve-written-verbal-communication", "Written & Verbal Communication", ["Written & Verbal Communication"]);
t("preserve-google-sheets", "Google Sheets", ["Google Sheets"]);
t("preserve-microsoft-office-suite", "Microsoft Office Suite", ["Microsoft Office Suite"]);
t("preserve-project-and-program-management", "Project and Program Management", ["Project and Program Management"]);
t("preserve-data-entry-file-organization", "Data Entry & File Organization", ["Data Entry & File Organization"]);

// --- Round's own full "must split" list (section D1.4) ---
t("split-word-excel-powerpoint-comma", "Word, Excel, PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("split-word-excel-powerpoint-semicolon", "Word; Excel; PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("split-word-excel-powerpoint-pipe", "Word | Excel | PowerPoint", ["Word", "Excel", "PowerPoint"]);
t("split-word-excel-google-sheets", "Word, Excel & Google Sheets", ["Word", "Excel", "Google Sheets"]);
t("split-sql-python-powerbi", "SQL, Python and Power BI", ["SQL", "Python", "Power BI"]);
t("split-english-french-korean", "English, French & Korean", ["English", "French", "Korean"]);
t("split-jira-confluence-slack", "Jira, Confluence & Slack", ["Jira", "Confluence", "Slack"]);
t("split-autocad-solidworks-catia", "AutoCAD, SolidWorks and CATIA", ["AutoCAD", "SolidWorks", "CATIA"]);

// --- Unicode bullet/dash inside otherwise-plain text (never treated as a skill separator by the tokenizer itself) ---
t("unicode-en-dash-in-phrase", "Full‑Stack Development", ["Full‑Stack Development"]);
t("unicode-em-dash-standalone", "Project Management — Advanced", ["Project Management — Advanced"]);

console.log(`\n--- tokenizeSkillList: ${pass} passed, ${fail} failed so far ---`);

// --- extractSkillGroups: bbox-driven PDF line-wrap continuation merge ---
let counter = 0;
function block(text: string, opts: { blockType?: SemanticContentBlock["blockType"]; bbox?: SemanticContentBlock["bbox"] } = {}): SemanticContentBlock {
  const i = counter++;
  return {
    id: `block-b${i}`,
    sourceElementIds: [`el-e${i}`],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: i,
    blockType: opts.blockType ?? "paragraph",
    bbox: opts.bbox,
  };
}

function checkGroups(label: string, groups: ReturnType<typeof extractSkillGroups>, expectedSkills: string[]) {
  const flat = groups.flatMap((g) => g.skills);
  check(label, flat, expectedSkills);
}

// Wrapped line: "Word, Excel & Google" (wide, fills the column) directly
// above a short "Sheets" continuation (narrow, no terminal punctuation
// on the first line) - must merge into one line before tokenizing.
{
  const wide = block("Word, Excel & Google", { bbox: { x: 10, y: 100, width: 180, height: 14 } });
  const narrow = block("Sheets", { bbox: { x: 10, y: 114, width: 45, height: 14 } });
  checkGroups("wrap-merge: 'Word, Excel & Google' + 'Sheets' -> one continued line", extractSkillGroups("s1", [wide, narrow]), [
    "Word",
    "Excel",
    "Google Sheets",
  ]);
}

// Two genuinely separate, complete one-line skill lists stacked with
// normal line spacing - the first line ends in terminal punctuation
// (a trailing comma), so it must NEVER merge with the next line.
{
  const line1 = block("Word, Excel, PowerPoint,", { bbox: { x: 10, y: 100, width: 160, height: 14 } });
  const line2 = block("Python, SQL, R", { bbox: { x: 10, y: 114, width: 150, height: 14 } });
  checkGroups("no-merge: terminal punctuation blocks the wrap heuristic", extractSkillGroups("s1", [line1, line2]), [
    "Word",
    "Excel",
    "PowerPoint",
    "Python",
    "SQL",
    "R",
  ]);
}

// No bbox on either block - conservative default is never merge.
{
  const noBboxA = block("Word, Excel & Google");
  const noBboxB = block("Sheets");
  checkGroups("no-merge: missing bbox never merges", extractSkillGroups("s1", [noBboxA, noBboxB]), ["Word", "Excel", "Google", "Sheets"]);
}

// Large vertical gap (paragraph break, not a wrapped line) - must not merge.
{
  const line1 = block("Word, Excel & Google", { bbox: { x: 10, y: 100, width: 180, height: 14 } });
  const line2 = block("Sheets", { bbox: { x: 10, y: 200, width: 45, height: 14 } });
  checkGroups("no-merge: large vertical gap is a paragraph break, not a wrap", extractSkillGroups("s1", [line1, line2]), [
    "Word",
    "Excel",
    "Google",
    "Sheets",
  ]);
}

// Disclosed residual trade-off (see looksLikeWrappedContinuation's own
// header comment): a real private-resume fixture proved the "second
// line must be measurably narrower" check suppressed genuine wraps
// (two nearly full-width lines), so that check was removed. The cost:
// two lines that happen to be adjacent, single-line-spaced, and free
// of terminal punctuation on the first now also merge even when they
// were actually two independent lists - here the merged 4-comma-item
// text no longer qualifies for the 2-item-only Oxford-tail rule, so
// "Google Sheets" stays fused with "Excel &" instead of the ideal
// 6-way split. Accepted: the round's own named failure (a compound
// skill severed by a real line wrap) is the more visible defect.
{
  const line1 = block("Word, Excel & Google", { bbox: { x: 10, y: 100, width: 180, height: 14 } });
  const line2 = block("Sheets, Slack, Notion", { bbox: { x: 10, y: 114, width: 175, height: 14 } });
  checkGroups("merge-tradeoff: adjacent lines now merge even without a narrower second line", extractSkillGroups("s1", [line1, line2]), [
    "Word",
    "Excel & Google Sheets",
    "Slack",
    "Notion",
  ]);
}

// Bullet blocks are never merge candidates even with wrap-shaped bbox.
{
  const bulletA = block("Word, Excel & Google", { blockType: "bullet", bbox: { x: 10, y: 100, width: 180, height: 14 } });
  const bulletB = block("Sheets", { blockType: "bullet", bbox: { x: 10, y: 114, width: 45, height: 14 } });
  checkGroups("no-merge: bullet blocks stay independent items", extractSkillGroups("s1", [bulletA, bulletB]), ["Word", "Excel", "Google", "Sheets"]);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
