/*
  Phase 5D.3B - Generic Single-Line Header Recovery Hardening synthetic
  fixtures. One anonymized PDF + DOCX pair covering 31 distinct
  Education/Certification/Award/Publication header shapes (>= the 20
  shapes required by this round's spec, several represented more than
  once with a different separator/ordering to prove the fix is truly
  generic - never keyed to any specific institution/company/award name).
  All institution/company/award/publication names below are invented
  and unrelated to any real entity.

  Run with `npx tsx fixtures/scripts/generatePhase5D3BSyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE_ID = "f13-single-line-headers";
const NAME = "Jordan Ellis";
const CONTACT = "Kitchener, ON | (555) 040-2217 | jordan.ellis@example.com";

type Line = { text: string; kind: "heading" | "entry" };

// Each `entry` line (or short run of consecutive `entry` lines) is one
// header shape from this round's spec. Comments tag which of the 20
// required shapes each targets.
const EDUCATION_LINES: Line[] = [
  { text: "Education", kind: "heading" },
  // shape 1: Date \n Institution
  { text: "2019 - 2021", kind: "entry" },
  { text: "Fairview State University", kind: "entry" },
  // shape 2: Institution \n Date
  { text: "Cedar Ridge College", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // shape 3: Date Institution (same line)
  { text: "2018 - 2020 Brightwater Institute", kind: "entry" },
  // shape 4: Institution Date (same line)
  { text: "Lakeshore Academy 2016 - 2020", kind: "entry" },
  // shape 5: Date - Institution
  { text: "2021 - Millbrook Polytechnic", kind: "entry" },
  // shape 6: Institution - Date
  { text: "Ravenswood College - 2017", kind: "entry" },
  // shape 7: Date \n Institution, Location (location on the institution line - the common real-fixture shape; see bench-A/C's own comma-joined institution/location lines)
  { text: "2013 - 2017", kind: "entry" },
  { text: "Thornfield University, Springvale, ON", kind: "entry" },
  // shape 8: Institution, Location \n Date
  { text: "Elmsworth College, Bakersview, AB", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // shape 14: Expected Graduation
  { text: "Hawthorn University - Expected Graduation 2027", kind: "entry" },
  // shape 17: Year only (no range)
  { text: "Crestline College - 2016", kind: "entry" },
  // shape 18: Academic Degree, comma-split single line
  { text: "Bachelor of Science, Riverton University - 2015", kind: "entry" },
  // positional fallback: two lines, no degree/institution keyword on either
  { text: "Meridian Learning Group", kind: "entry" },
  { text: "2011 - 2013", kind: "entry" },
  // 3-segment comma-split + trailing location, single line
  { text: "MBA, Northshore University, Chicago, IL - 2019", kind: "entry" },
  // em-dash separated, single line
  { text: "Diploma in Culinary Arts — Silver Creek Institute — 2017", kind: "entry" },
  // pipe separator + bare year, single line
  { text: "Kingsview Academy | 2013", kind: "entry" },
];

const CERTIFICATION_LINES: Line[] = [
  { text: "Certifications", kind: "heading" },
  // shape 9: Date + Credential
  { text: "2020 - Project Management Professional (PMP)", kind: "entry" },
  // shape 12: Date Range + Institution
  { text: "2019 - 2021 - Northgate Training Center", kind: "entry" },
  // shape 13: Date Range + Credential
  { text: "2018 - 2022 Certified Public Accountant", kind: "entry" },
  // shape 15: Present/Current
  { text: "2022 - Present - Advanced First Aid Certification", kind: "entry" },
  // shape 16: Month Year
  { text: "Jan 2021 - Registered Nurse License", kind: "entry" },
  // shape 19: Training
  { text: "2020 - Leadership Development Training Program", kind: "entry" },
  // shape 20: License
  { text: "2019 - Class A Commercial Driver's License", kind: "entry" },
  // credential with parenthetical abbreviation + date range
  { text: "Certified ScrumMaster (CSM), 2020 - 2022", kind: "entry" },
  // numeric month/year range
  { text: "2016/03 - 2018/09 - Occupational Health and Safety Certificate", kind: "entry" },
];

const AWARD_LINES: Line[] = [
  { text: "Awards", kind: "heading" },
  // shape 10: Date + Award Name
  { text: "2020 Employee of the Year Award", kind: "entry" },
  // date-first with dash separator
  { text: "2018 - Outstanding Volunteer Award", kind: "entry" },
  // award-first with trailing date
  { text: "President's Award for Innovation, 2021", kind: "entry" },
  // date + award + issuer via em-dash
  { text: "2019 Regional Innovation Award — Chamber of Commerce", kind: "entry" },
];

const PUBLICATION_LINES: Line[] = [
  { text: "Publications", kind: "heading" },
  // shape 11: Date + Publication Title
  { text: "2021 - Emerging Trends in Regional Logistics, Journal of Applied Operations", kind: "entry" },
  // title + year parenthetical
  { text: "Advances in Community Health Outreach (2019)", kind: "entry" },
  // title, year, venue comma-joined
  { text: "The Future of Sustainable Packaging, 2020, Industry Insights Quarterly", kind: "entry" },
];

const ALL_LINES: Line[] = [...EDUCATION_LINES, ...CERTIFICATION_LINES, ...AWARD_LINES, ...PUBLICATION_LINES];

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
