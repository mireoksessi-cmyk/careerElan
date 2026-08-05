/*
  Phase 5D.3D - Generic Academic Composite Parsing & Full Resume Engine
  Capability Audit. One anonymized PDF + DOCX pair covering 85+
  patterns: Double Degree, Double Major, Joint Program, and Inline
  Institution/Location composite headers, PLUS the round's own required
  false-positive controls (phrases that must NEVER be treated as a
  double value) and cross-combination shapes.

  All institution/company/award/publication/authority names below are
  invented and unrelated to any real entity - never a hardcoded specific
  proper noun the parser depends on.

  Run with `npx tsx fixtures/scripts/generatePhase5D3DSyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE_ID = "f15-academic-composite";
const NAME = "Avery Nakamura";
const CONTACT = "Halifax, NS | (555) 720-4481 | avery.nakamura@example.com";

type Line = { text: string; kind: "heading" | "entry" };

const EDUCATION_LINES: Line[] = [
  { text: "Education", kind: "heading" },
  // --- Double Degree: comma ---
  { text: "B.Sc., M.Sc.", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Double Degree: slash ---
  { text: "Bachelor of Science / Master of Science", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- Double Degree: ampersand ---
  { text: "B.A. & B.Sc.", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- Double Degree: and, with majors ("in X") ---
  { text: "B.A. in Economics and B.Sc. in Computer Science", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // --- Double Degree: pipe ---
  { text: "B.Comm. | M.Comm.", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2013 - 2018", kind: "entry" },
  // --- Double Degree: semicolon ---
  { text: "Diploma; Certificate", kind: "entry" },
  { text: "Example Institute", kind: "entry" },
  { text: "2013 - 2015", kind: "entry" },
  // --- Double Degree: separate lines, with majors ---
  { text: "Bachelor of Arts in History", kind: "entry" },
  { text: "Master of Arts in History", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2010 - 2016", kind: "entry" },
  // --- Joint Program: two institutions, slash, explicit label ---
  { text: "Joint Degree:", kind: "entry" },
  { text: "Example College / Example Institute", kind: "entry" },
  { text: "Bachelor of Science", kind: "entry" },
  { text: "2018 - 2022", kind: "entry" },
  // --- Double Degree: same major both degrees ---
  { text: "B.A. in Computer Science and B.Sc. in Computer Science", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2019 - 2023", kind: "entry" },
  // --- Degree + Certificate combo ---
  { text: "Bachelor of Science, Certificate in Data Analytics", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Degree + Diploma combo ---
  { text: "Bachelor of Arts, Diploma in Public Relations", kind: "entry" },
  { text: "Example College", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // --- Joint Program label + and ---
  { text: "Joint Program:", kind: "entry" },
  { text: "Bachelor of Science and Bachelor of Arts", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- Concurrent Program: two credentials on separate lines ---
  { text: "Concurrent Program:", kind: "entry" },
  { text: "Bachelor of Engineering", kind: "entry" },
  { text: "Diploma in Management", kind: "entry" },
  { text: "Example Institute", kind: "entry" },
  { text: "2014 - 2019", kind: "entry" },
  // --- Double Major: label + slash ---
  { text: "Dual Major:", kind: "entry" },
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Economics / Political Science", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // --- Double Major: label + and ---
  { text: "Double Major:", kind: "entry" },
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Biology and Chemistry", kind: "entry" },
  { text: "Example College", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Double Major: label + ampersand ---
  { text: "Double Major:", kind: "entry" },
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "History & Philosophy", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // --- Honours + single major ---
  { text: "Bachelor of Arts (Honours)", kind: "entry" },
  { text: "Sociology", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2011 - 2015", kind: "entry" },
  // --- Major/Minor phrasing (preserved as one text, not split) ---
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Major: Chemistry, Minor: Biology", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- Concentration ---
  { text: "Bachelor of Business Administration", kind: "entry" },
  { text: "Concentration in Finance", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- Inline Institution/Location: pipe ---
  { text: "Example University | Toronto, ON", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Inline: em dash ---
  { text: "Example University — Vancouver, BC", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- Inline: en dash ---
  { text: "Example College – Ottawa, ON", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // --- Inline: hyphen-minus + Remote ---
  { text: "Example Institute - Remote", kind: "entry" },
  { text: "2020 - 2022", kind: "entry" },
  // --- Inline: fullwidth dash ---
  { text: "Example University － Regina, SK", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // --- Inline: figure dash ---
  { text: "Example College ‒ Halifax, NS", kind: "entry" },
  { text: "2011 - 2015", kind: "entry" },
  // --- Inline: horizontal bar ---
  { text: "Example Institute ― Winnipeg, MB", kind: "entry" },
  { text: "2010 - 2014", kind: "entry" },
  // --- Inline: middle dot ---
  { text: "Example University · Montreal, QC", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // --- Inline: bullet ---
  { text: "Example College • Calgary, AB", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- Inline: slash institution/location ---
  { text: "Example University / Toronto, ON", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Inline: parentheses ---
  { text: "Example Institute (Vancouver, BC)", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- Inline: trailing comma ---
  { text: "Example University, Ottawa, ON", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // --- Inline: 3-segment campus + city (pipe) ---
  { text: "Example Institute | Downtown Campus | Vancouver, BC", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // --- Inline: city + country ---
  { text: "Example University | Paris, France", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Inline: Remote (pipe) ---
  { text: "Example Institute | Remote", kind: "entry" },
  { text: "2021 - 2023", kind: "entry" },
  // --- Inline: Hybrid (pipe) ---
  { text: "Example College | Hybrid", kind: "entry" },
  { text: "2020 - 2022", kind: "entry" },
  // --- Inline: Remote + country ---
  { text: "Example University | Remote, Canada", kind: "entry" },
  { text: "2019 - 2021", kind: "entry" },
  // --- Inline: multiple locations ---
  { text: "Example Institute | Toronto, ON and Vancouver, BC", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- False positive: institution + sub-school comma (real-bug regression anchor) ---
  { text: "Example University, School of Business", kind: "entry" },
  { text: "Master of Business Administration", kind: "entry" },
  { text: "2018 - 2020", kind: "entry" },
  // --- False positive: "Research & Development" as field of study ---
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Research & Development", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- False positive: "Sales and Marketing" ---
  { text: "Bachelor of Business Administration", kind: "entry" },
  { text: "Sales and Marketing", kind: "entry" },
  { text: "Example College", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- False positive: "Health & Safety" ---
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Health & Safety", kind: "entry" },
  { text: "Example Institute", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // --- False positive: "Arts and Science Faculty" (org-unit trailing word) ---
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Arts and Science Faculty", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // --- False positive: "Business/Technology Division" ---
  { text: "Bachelor of Commerce", kind: "entry" },
  { text: "Business/Technology Division", kind: "entry" },
  { text: "Example College", kind: "entry" },
  { text: "2011 - 2015", kind: "entry" },
  // --- False positive: 3-item Oxford-comma list, not 3 majors ---
  { text: "Bachelor of Commerce", kind: "entry" },
  { text: "Strategy, Operations, and Finance", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // --- False positive: "Oil & Gas" ---
  { text: "Bachelor of Engineering", kind: "entry" },
  { text: "Oil & Gas", kind: "entry" },
  { text: "Example Institute", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // --- False positive: "Design and Development" ---
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Design and Development", kind: "entry" },
  { text: "Example University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // --- Cross-combination: double degree + inline location ---
  { text: "B.Sc., M.Sc.", kind: "entry" },
  { text: "Example University | Toronto, ON", kind: "entry" },
  { text: "2015 - 2020", kind: "entry" },
  // --- Cross-combination: double major + campus detail ---
  { text: "Double Major:", kind: "entry" },
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Economics and Sociology", kind: "entry" },
  { text: "Example Institute | Downtown Campus | Vancouver, BC", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // --- Cross-combination: joint program + two institutions + date-first ---
  { text: "2018 - 2022", kind: "entry" },
  { text: "Joint Program:", kind: "entry" },
  { text: "Example College / Example University", kind: "entry" },
  { text: "Bachelor of Arts", kind: "entry" },
  // --- Cross-combination: Expected Graduation + double degree ---
  { text: "Expected Graduation 2026", kind: "entry" },
  { text: "B.Sc. / B.A.", kind: "entry" },
  { text: "Example University", kind: "entry" },
  // --- Cross-combination: Present + inline location ---
  { text: "Example Institute | Hybrid", kind: "entry" },
  { text: "2022 - Present", kind: "entry" },
];

const CREDENTIAL_LINES: Line[] = [
  { text: "Certifications", kind: "heading" },
  // --- Multiple certificates on separate lines ---
  { text: "Certified Financial Planner", kind: "entry" },
  { text: "Certified Investment Manager", kind: "entry" },
  { text: "Financial Standards Board", kind: "entry" },
  { text: "2019", kind: "entry" },
  // --- Multiple certificates, same line, semicolon ---
  { text: "Certified Scrum Master; Certified Product Owner", kind: "entry" },
  { text: "2020", kind: "entry" },
  // --- Inline authority + location, pipe ---
  { text: "Project Management Institute | Toronto, ON", kind: "entry" },
  { text: "Project Management Professional", kind: "entry" },
  { text: "2018", kind: "entry" },
  // --- False positive: authority body with "and" not split ---
  { text: "Certified Health and Safety Officer", kind: "entry" },
  { text: "Workplace Standards Authority", kind: "entry" },
  { text: "2017", kind: "entry" },
];

const AWARD_LINES: Line[] = [
  { text: "Awards", kind: "heading" },
  // --- Multiple awards, same line, semicolon ---
  { text: "Excellence Award; Innovation Award", kind: "entry" },
  { text: "Industry Recognition Council", kind: "entry" },
  { text: "2021", kind: "entry" },
  // --- False positive: award title with "and" not split ---
  { text: "Research and Development Award", kind: "entry" },
  { text: "Science Innovation Board", kind: "entry" },
  { text: "2019", kind: "entry" },
];

const ALL_LINES: Line[] = [...EDUCATION_LINES, ...CREDENTIAL_LINES, ...AWARD_LINES];

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
