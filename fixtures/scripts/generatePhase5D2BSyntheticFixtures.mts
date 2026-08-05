/*
  Phase 5D.2B - TASK 11 synthetic fixtures. Four anonymized fixture
  pairs (PDF + DOCX), each carrying a distinct KPI/metric-grid shape so
  metricGridExtractor.ts's detection is proven general - never derived
  from or dependent on the private resume's own company names, KPI
  labels, or numbers (see that module's own header comment for the real
  4-column evidence this was built from).

  - f8: 4-column KPI band (currency+suffix, currency+parenthetical,
    short date, arrow-ratio) - the real-evidence shape.
  - f9: 2-column achievement cards (percent, score-out-of-N ratio).
  - f10: 3-column revenue cards (comma-formatted currency, plain count,
    percent).
  - f11: a vertically-stacked single-column "dashboard summary" / score
    panel (3 stacked Value/Label pairs) - proves the vertical-merge path,
    not just the horizontal-row path.

  Run with `npx tsx fixtures/scripts/generatePhase5D2BSyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

type MetricFixture = {
  id: string;
  name: string;
  contact: string;
  metrics: { value: string; label: string }[];
};

const FIXTURES: MetricFixture[] = [
  {
    id: "f8-metric-grid-4col-kpi",
    name: "Taylor Brooks",
    contact: "Calgary, AB | (555) 010-4471 | taylor.brooks@example.com",
    metrics: [
      { value: "$212M+", label: "CUMULATIVE CONTRACT VALUE" },
      { value: "$18.4M (FY2027E)", label: "PROJECTED ANNUAL REVENUE" },
      { value: "Mar 2024", label: "PLATFORM LAUNCH DATE" },
      { value: "3 → 11", label: "TEAM HEADCOUNT GROWTH" },
    ],
  },
  {
    id: "f9-metric-cards-2col",
    name: "Morgan Ellis",
    contact: "Halifax, NS | (555) 010-5582 | morgan.ellis@example.com",
    metrics: [
      { value: "96%", label: "CUSTOMER SATISFACTION SCORE" },
      { value: "4.8/5", label: "AVERAGE CLIENT RATING" },
    ],
  },
  {
    id: "f10-metric-cards-3col",
    name: "Casey Nguyen",
    contact: "Winnipeg, MB | (555) 010-6693 | casey.nguyen@example.com",
    metrics: [
      { value: "$1,250,000", label: "TOTAL REVENUE MANAGED" },
      { value: "12", label: "PROJECTS DELIVERED" },
      { value: "38%", label: "YEAR-OVER-YEAR GROWTH" },
    ],
  },
  {
    id: "f11-metric-score-panel-stacked",
    name: "Jamie Osei",
    contact: "Regina, SK | (555) 010-7724 | jamie.osei@example.com",
    metrics: [
      { value: "27", label: "Volunteer Events Coordinated" },
      { value: "150+", label: "Community Members Reached" },
      { value: "9.2/10", label: "Program Feedback Score" },
    ],
  },
];

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}
function body(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)] });
}
function bullet(text: string): Paragraph {
  return new Paragraph({ text: `• ${text}` });
}

/*
  Value row + label row as a 2-row DOCX table (one column per metric).
  Real finding while building this fixture set (disclosed in the final
  report, not fixed here - Phase 1's own DOCX table handling is out of
  scope this round): unlike f6-docx-table-skills.docx (which only
  exercises Phase 2's *text* coverage of a table, never its per-cell
  *geometry*), this pipeline's DOCX -> HTML -> Playwright render step
  collapses an entire DOCX table into ONE flattened block per row with
  no per-cell bbox (confirmed by direct inspection - every DOCX table
  row becomes a single "unknown"/merged block spanning the full page
  width). A multi-column KPI grid is therefore only geometrically
  representable via the PDF path in this pipeline today - DOCX table
  fixtures below intentionally still exercise this path (proving the
  detector safely finds 0 grids, not a crash or a false positive) rather
  than being dropped.
*/
function metricTable(fixture: MetricFixture): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: fixture.metrics.map((m) => new TableCell({ children: [new Paragraph(m.value)] })) }),
      new TableRow({ children: fixture.metrics.map((m) => new TableCell({ children: [new Paragraph(m.label)] })) }),
    ],
  });
}

/*
  f11 alone is generated as plain alternating paragraphs (value line,
  label line, value line, label line, ...) instead of a table - every
  DOCX paragraph in this pipeline's geometry model shares the same
  full-page-width bbox (only y differs), which is exactly the shape a
  vertically-stacked single-column Score Panel needs and is the one KPI
  shape DOCX documents genuinely CAN prove through this pipeline's
  current DOCX geometry (row/y-adjacency, no column/x-differentiation
  required).
*/
async function writeDocx(fixture: MetricFixture) {
  const metricChildren =
    fixture.id === "f11-metric-score-panel-stacked"
      ? [heading("Program Impact"), ...fixture.metrics.flatMap((m) => [body(m.value), body(m.label)])]
      : [metricTable(fixture)];
  const doc = new Document({
    sections: [
      {
        children: [
          body(fixture.name),
          body(fixture.contact),
          ...metricChildren,
          heading("Summary"),
          body("Results-driven professional with a track record of measurable, disclosed impact across cross-functional teams."),
          heading("Experience"),
          body(`Program Lead, Northbridge Collective, ${fixture.contact.split(",")[0]} — 2021 to Present`),
          bullet("Led planning and delivery for multiple concurrent initiatives."),
          bullet("Partnered with stakeholders across finance, operations, and community outreach."),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, `${fixture.id}.docx`), buffer);
  console.log("wrote", `${fixture.id}.docx`, buffer.length, "bytes");
}

/*
  Value row + label row rendered as a CSS flex/grid band - real bbox
  comes from pdfjs's own layout analysis of the rendered PDF, exactly
  as it would for a real Canva/Word-exported resume's own KPI band -
  never hand-injected coordinates.
*/
function metricGridHtml(fixture: MetricFixture): string {
  const columns = fixture.metrics
    .map(
      (m) => `<div class="col"><div class="value">${m.value}</div><div class="label">${m.label}</div></div>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
    h1 { font-size: 16px; margin: 16px 0 8px; }
    .metric-band { display: flex; gap: 40px; margin: 16px 0; }
    .col { display: flex; flex-direction: column; align-items: flex-start; min-width: 230px; }
    .value { font-size: 18px; font-weight: bold; }
    .label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.03em; margin-top: 2px; }
  </style></head><body>
    <div>${fixture.name}</div>
    <div>${fixture.contact}</div>
    <div class="metric-band">${columns}</div>
    <h1>Summary</h1>
    <div>Results-driven professional with a track record of measurable, disclosed impact across cross-functional teams.</div>
    <h1>Experience</h1>
    <div>Program Lead, Northbridge Collective, ${fixture.contact.split(",")[0]} &mdash; 2021 to Present</div>
    <div>&bull; Led planning and delivery for multiple concurrent initiatives.</div>
    <div>&bull; Partnered with stakeholders across finance, operations, and community outreach.</div>
  </body></html>`;
}

/*
  f11's stacked score panel is deliberately laid out as N separate
  value/label ROW PAIRS stacked vertically (one metric per line, no
  side-by-side columns) - the shape mergeAdjacentRowPairMatches exists
  to recover as a single grid.
*/
function scorePanelHtml(fixture: MetricFixture): string {
  const rows = fixture.metrics
    .map((m) => `<div class="value">${m.value}</div><div class="label">${m.label}</div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
    h1 { font-size: 16px; margin: 16px 0 8px; }
    .value { font-size: 16px; font-weight: bold; margin-top: 10px; }
    .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; }
  </style></head><body>
    <div>${fixture.name}</div>
    <div>${fixture.contact}</div>
    <h1>Program Impact</h1>
    ${rows}
    <h1>Summary</h1>
    <div>Results-driven professional with a track record of measurable, disclosed impact across cross-functional teams.</div>
    <h1>Experience</h1>
    <div>Program Lead, Northbridge Collective, ${fixture.contact.split(",")[0]} &mdash; 2021 to Present</div>
    <div>&bull; Led planning and delivery for multiple concurrent initiatives.</div>
    <div>&bull; Partnered with stakeholders across finance, operations, and community outreach.</div>
  </body></html>`;
}

async function writePdf(fixture: MetricFixture) {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  const html = fixture.id === "f11-metric-score-panel-stacked" ? scorePanelHtml(fixture) : metricGridHtml(fixture);
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
  await page.close();
  fs.writeFileSync(path.join(OUT_DIR, `${fixture.id}.pdf`), pdfBytes);
  console.log("wrote", `${fixture.id}.pdf`, pdfBytes.length, "bytes");
}

async function main() {
  for (const fixture of FIXTURES) {
    await writeDocx(fixture);
    await writePdf(fixture);
  }
  await closeSharedBrowser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
