/*
  Phase 5D.4 - Production Readiness QA. Small French / English-French
  bilingual academic header fixture, closing a real coverage gap the
  85-Pattern Gate audit found: neither f14 (5D.3C) nor f15 (5D.3D)
  exercised a French-language degree/institution line.

  This fixture exists to OBSERVE actual behavior, not to assert full
  French support - DEGREE_KEYWORD_RE/INSTITUTION_KEYWORD_RE in
  headerWindow.ts are English-keyword-only regexes (bachelor/master/.../
  b.a./b.sc./...; university/college/institute/...), so a bare French
  term like "Baccalauréat" or "Université" independently matches
  NEITHER list. The gate test's hand-authored expected values reflect
  this real, current limitation (raw-text preservation / partial
  positional fallback), not an aspirational claim of French support -
  see the Phase 5D.4 QA report's Known Limitations section for the
  disclosed finding this fixture backs.

  Run with `npx tsx fixtures/scripts/generatePhase5D4FrenchFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE_ID = "f16-french-academic";
const NAME = "Camille Tremblay";
const CONTACT = "Québec, QC | (555) 340-2291 | camille.tremblay@example.com";

type Line = { text: string; kind: "heading" | "entry" };

const EDUCATION_LINES: Line[] = [
  { text: "Formation", kind: "heading" },
  // --- Pure French: degree + institution + French-accented location ---
  { text: "Baccalauréat ès arts", kind: "entry" },
  { text: "Université de Montréal", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Pure French: Maîtrise + institution, inline pipe location ---
  { text: "Université Laval | Québec, QC", kind: "entry" },
  { text: "Maîtrise en administration des affaires", kind: "entry" },
  { text: "2018 - 2020", kind: "entry" },
  { text: "2018 - 2020", kind: "entry" },
  // --- Pure French: double degree, comma-joined French abbreviations ---
  { text: "B.Sc., M.Sc.", kind: "entry" },
  { text: "Université de Sherbrooke", kind: "entry" },
  { text: "2016 - 2021", kind: "entry" },
  // --- English/French mixed: English degree keyword, French institution/location ---
  { text: "Bachelor of Commerce", kind: "entry" },
  { text: "Université du Québec à Montréal | Montréal, QC", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- English/French mixed: French field-of-study label line ---
  { text: "Double Major:", kind: "entry" },
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Économie et Science politique", kind: "entry" },
  { text: "Université d'Ottawa", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // --- Pure French: Diplôme + accented city, dash form ---
  { text: "Collège de Rimouski – Rimouski, QC", kind: "entry" },
  { text: "Diplôme d'études collégiales", kind: "entry" },
  { text: "2012 - 2014", kind: "entry" },
];

const ALL_LINES: Line[] = [...EDUCATION_LINES];

async function writeDocx() {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: NAME, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun(CONTACT)] }),
  ];
  for (const line of ALL_LINES) {
    if (line.kind === "heading") {
      paragraphs.push(new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_1 }));
    } else {
      paragraphs.push(new Paragraph({ children: [new TextRun(line.text)] }));
    }
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, `${FIXTURE_ID}.docx`), buffer);
  console.log("wrote", `${FIXTURE_ID}.docx`, buffer.length, "bytes");
}

function fixtureHtml(): string {
  const body = ALL_LINES
    .map((line) => (line.kind === "heading" ? `<h1>${line.text}</h1>` : `<div>${line.text}</div>`))
    .join("\n    ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
    h1 { font-size: 16px; margin: 16px 0 8px; }
  </style></head><body>
    <div>${NAME}</div>
    <div>${CONTACT}</div>
    ${body}
  </body></html>`;
}

async function writePdf() {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  await page.setContent(fixtureHtml(), { waitUntil: "networkidle" });
  const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
  await page.close();
  fs.writeFileSync(path.join(OUT_DIR, `${FIXTURE_ID}.pdf`), pdfBytes);
  console.log("wrote", `${FIXTURE_ID}.pdf`, pdfBytes.length, "bytes");
}

async function main() {
  await writeDocx();
  await writePdf();
  await closeSharedBrowser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
