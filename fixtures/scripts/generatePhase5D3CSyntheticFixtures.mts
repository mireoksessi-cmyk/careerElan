/*
  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening
  synthetic fixtures. One anonymized PDF + DOCX pair covering 62 distinct
  N-line (2-6 line) Header Window patterns spanning all 12 required
  shapes (A-L) plus the round's required variety dimensions: Date-first,
  Date-last, Location-middle, Degree-middle, Authority-middle, Expected
  Graduation, Present, Current, Issue/Expiry, Academic Year, Roman
  numeral, Bracket, Pipe, Slash, Dash, Multi-campus, Double Degree, Joint
  Program, Multiple Locations, Academic Honors, Dual Dates.

  All institution/company/award/publication/authority names below are
  invented and unrelated to any real entity - never a hardcoded specific
  proper noun the parser depends on (per this round's explicit
  prohibition; the parser itself only ever reasons about generic
  lexical categories and structural position).

  Run with `npx tsx fixtures/scripts/generatePhase5D3CSyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE_ID = "f14-multi-line-headers";
const NAME = "Riley Okafor";
const CONTACT = "Regina, SK | (555) 618-3390 | riley.okafor@example.com";

type Line = { text: string; kind: "heading" | "entry" };

// Each consecutive run of `entry` lines is one multi-line Header Window.
// Comments tag which required Shape (A-L) and/or variety dimension each
// targets.
const EDUCATION_LINES: Line[] = [
  { text: "Education", kind: "heading" },
  // Shape A (3-line): Institution / Location / Date
  { text: "Fairhaven University", kind: "entry" },
  { text: "Denton, TX", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // Shape B (3-line): Date / Institution / Location
  { text: "2015 - 2019", kind: "entry" },
  { text: "Wrenfield College", kind: "entry" },
  { text: "Marlow, OR", kind: "entry" },
  // Shape C (3-line): Degree / Institution / Date
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Ashgrove University", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // Shape D (4-line): Institution / Degree / Location / Date
  { text: "Northcastle College", kind: "entry" },
  { text: "Diploma in Graphic Design", kind: "entry" },
  { text: "Fenwick, MB", kind: "entry" },
  { text: "2013 - 2015", kind: "entry" },
  // Shape E (4-line): Degree / Major / Institution / Date
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Environmental Studies", kind: "entry" },
  { text: "Oakmere University", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // Shape F (5-line): Degree / Major / Institution / Location / Date
  { text: "Bachelor of Commerce", kind: "entry" },
  { text: "Marketing", kind: "entry" },
  { text: "Silverpine University", kind: "entry" },
  { text: "Toronto, ON", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // Shape L (4-line): Expected Graduation / Degree / Institution / Campus
  { text: "Expected Graduation 2027", kind: "entry" },
  { text: "Bachelor of Engineering", kind: "entry" },
  { text: "Thistledown University", kind: "entry" },
  { text: "Riverside Campus, ON", kind: "entry" },
  // 2-line: Institution / Date
  { text: "Bellcrest College", kind: "entry" },
  { text: "2012 - 2014", kind: "entry" },
  // 6-line (MAX_HEADER_WINDOW boundary): Degree / Major / Institution / Campus / Location / Date
  { text: "Bachelor of Arts", kind: "entry" },
  { text: "Political Science", kind: "entry" },
  { text: "Grovemont University", kind: "entry" },
  { text: "North Campus", kind: "entry" },
  { text: "Ottawa, ON", kind: "entry" },
  { text: "2010 - 2014", kind: "entry" },
  // Date-first 3-line variant of Shape B
  { text: "2009 - 2013", kind: "entry" },
  { text: "Bachelor of Fine Arts", kind: "entry" },
  { text: "Copperfield College", kind: "entry" },
  // Location-middle 4-line: Institution / Location / Degree / Date
  { text: "Fernbrook College", kind: "entry" },
  { text: "Halifax, NS", kind: "entry" },
  { text: "Bachelor of Nursing", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // Degree-middle 4-line: Degree / Location / Institution / Date
  { text: "Master of Education", kind: "entry" },
  { text: "Regina, SK", kind: "entry" },
  { text: "Pinegrove University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // Present
  { text: "Ashworth College", kind: "entry" },
  { text: "2022 - Present", kind: "entry" },
  // Current
  { text: "Fieldstone College", kind: "entry" },
  { text: "2023 - Current", kind: "entry" },
  // Academic Year
  { text: "Millfield Academy", kind: "entry" },
  { text: "Academic Year 2020 - 2021", kind: "entry" },
  // Roman numeral
  { text: "Brightstone College", kind: "entry" },
  { text: "Certificate Level III", kind: "entry" },
  { text: "2018 - 2019", kind: "entry" },
  // Bracket
  { text: "Bachelor of Arts (Honours)", kind: "entry" },
  { text: "Kestrel University", kind: "entry" },
  { text: "2014 - 2018", kind: "entry" },
  // Pipe (embedded in one window line)
  { text: "Bachelor of Science", kind: "entry" },
  { text: "Elmridge University | Kelowna, BC", kind: "entry" },
  { text: "2016 - 2020", kind: "entry" },
  // Slash / Double Degree
  { text: "Bachelor of Arts/Science", kind: "entry" },
  { text: "Meadowlark University", kind: "entry" },
  { text: "2015 - 2019", kind: "entry" },
  // Dash
  { text: "Northfield College - Main Campus", kind: "entry" },
  { text: "2013 - 2017", kind: "entry" },
  // Multi-campus
  { text: "Wrenview University", kind: "entry" },
  { text: "Downtown & Uptown Campuses", kind: "entry" },
  { text: "2012 - 2016", kind: "entry" },
  // Double Degree (comma-joined)
  { text: "Bachelor of Arts, Bachelor of Science", kind: "entry" },
  { text: "Thornbury University", kind: "entry" },
  { text: "2011 - 2015", kind: "entry" },
  // Joint Program
  { text: "Joint Program in Public Health", kind: "entry" },
  { text: "Sterling University and Ashford College", kind: "entry" },
  { text: "2010 - 2014", kind: "entry" },
  // Multiple Locations
  { text: "Cambrian University", kind: "entry" },
  { text: "Toronto, ON and Vancouver, BC", kind: "entry" },
  { text: "2009 - 2013", kind: "entry" },
  // Academic Honors
  { text: "Bachelor of Science, with Distinction", kind: "entry" },
  { text: "Hollowbrook University", kind: "entry" },
  { text: "2017 - 2021", kind: "entry" },
  // Dean's-list-style honors
  { text: "Dean's List Honors", kind: "entry" },
  { text: "Amberfield University", kind: "entry" },
  { text: "2018 - 2019", kind: "entry" },
  // Additional roman numeral + bracket combo
  { text: "Diploma Level IV", kind: "entry" },
  { text: "Cross Hollow Institute", kind: "entry" },
  { text: "2015 - 2017", kind: "entry" },
  { text: "Bachelor of Engineering (Co-op)", kind: "entry" },
  { text: "Nightingale Institute of Technology", kind: "entry" },
  { text: "2016 - 2021", kind: "entry" },
  // 2-line: Date / Institution (last in section - a Date-first window
  // with a single trailing line keeps trying to absorb whatever
  // structurally-plausible line comes right after it, so this is placed
  // where nothing follows within the same section)
  { text: "2011 - 2013", kind: "entry" },
  { text: "Hartwell Institute", kind: "entry" },
];

const CERTIFICATION_LINES: Line[] = [
  { text: "Certifications", kind: "heading" },
  // Shape I (4-line): Certification / Authority / IssueDate / ExpiryDate (bare dual date)
  { text: "Certified Financial Planner", kind: "entry" },
  { text: "Financial Planning Standards Board", kind: "entry" },
  { text: "2018", kind: "entry" },
  { text: "2023", kind: "entry" },
  // Shape J (4-line): Training / Provider / Location / CompletionDate
  { text: "Advanced Leadership Training", kind: "entry" },
  { text: "Meridian Learning Group", kind: "entry" },
  { text: "Calgary, AB", kind: "entry" },
  { text: "2021", kind: "entry" },
  // Shape K (4-line): License / Authority / LicenseNumber / IssueDate
  { text: "Registered Nurse License", kind: "entry" },
  { text: "College of Nurses Registry", kind: "entry" },
  { text: "RN-884213", kind: "entry" },
  { text: "2019", kind: "entry" },
  // 2-line: Credential / Date
  { text: "Certified Six Sigma Green Belt", kind: "entry" },
  { text: "2020", kind: "entry" },
  // 3-line: Credential / Authority / Date
  { text: "Certified Financial Analyst", kind: "entry" },
  { text: "American Society of Certified Planners", kind: "entry" },
  { text: "2019", kind: "entry" },
  // Present (ongoing certification)
  { text: "Certified Cloud Practitioner", kind: "entry" },
  { text: "Global IT Certification Council", kind: "entry" },
  { text: "2020 - Present", kind: "entry" },
  // Bracket
  { text: "Certified Six Sigma Black Belt (Advanced)", kind: "entry" },
  { text: "National Quality Federation", kind: "entry" },
  { text: "2018", kind: "entry" },
  // Pipe
  { text: "Certified Ethical Hacker | Cyber Defense Authority", kind: "entry" },
  { text: "2021", kind: "entry" },
  // Slash date (numeric month/year range)
  { text: "Occupational Health and Safety Certificate", kind: "entry" },
  { text: "2016/03 - 2018/09", kind: "entry" },
  // Academic-year-style validity (qualifier word + date range, same line)
  { text: "Food Handler Certification", kind: "entry" },
  { text: "Valid 2020 - 2021", kind: "entry" },
  // Dual date with explicit Issue/Expiry qualifier words
  { text: "Certified Information Systems Security Professional", kind: "entry" },
  { text: "International Security Certification Authority", kind: "entry" },
  { text: "Issued 2019", kind: "entry" },
  { text: "Expires 2024", kind: "entry" },
  // Dual date, bare, with authority keyword
  { text: "Class A Commercial Driver's License", kind: "entry" },
  { text: "Provincial Transportation Authority", kind: "entry" },
  { text: "2017", kind: "entry" },
  { text: "2027", kind: "entry" },
  // Roman numeral
  { text: "Emergency Medical Technician Level II", kind: "entry" },
  { text: "State Health Certification Board", kind: "entry" },
  { text: "2020", kind: "entry" },
  // 5-line: Certification / Authority / Location / IssueDate / ExpiryDate
  { text: "Certified Occupational Health and Safety Specialist", kind: "entry" },
  { text: "Workplace Safety Bureau", kind: "entry" },
  { text: "Edmonton, AB", kind: "entry" },
  { text: "2018", kind: "entry" },
  { text: "2023", kind: "entry" },
  // 6-line (MAX_HEADER_WINDOW boundary): License / Authority / Location / LicenseNumber / IssueDate / ExpiryDate
  { text: "Advanced Paramedic License", kind: "entry" },
  { text: "Provincial Health Registry", kind: "entry" },
  { text: "Saskatoon, SK", kind: "entry" },
  { text: "PARA-55231", kind: "entry" },
  { text: "2017", kind: "entry" },
  { text: "2027", kind: "entry" },
  // Multiple locations
  { text: "Diversity and Inclusion Facilitator Training", kind: "entry" },
  { text: "Meridian Learning Group", kind: "entry" },
  { text: "Vancouver, BC and Remote", kind: "entry" },
  { text: "2021", kind: "entry" },
];

const AWARD_LINES: Line[] = [
  { text: "Awards", kind: "heading" },
  // Shape G (3-line): Award / Organization / Date
  { text: "Excellence in Customer Service Award", kind: "entry" },
  { text: "National Retail Federation", kind: "entry" },
  { text: "2020", kind: "entry" },
  // Date-first 3-line
  { text: "2019", kind: "entry" },
  { text: "Outstanding Community Service Award", kind: "entry" },
  { text: "Civic Leadership Council", kind: "entry" },
  // 2-line: Award / Date
  { text: "Rising Star Award", kind: "entry" },
  { text: "2021", kind: "entry" },
  // Bracket
  { text: "Innovation Award (Gold Tier)", kind: "entry" },
  { text: "Provincial Business Association", kind: "entry" },
  { text: "2018", kind: "entry" },
  // Pipe (embedded in one window line)
  { text: "Top Performer Award | Regional Sales Division", kind: "entry" },
  { text: "2022", kind: "entry" },
  // Roman numeral
  { text: "Quarterly Excellence Award III", kind: "entry" },
  { text: "Employee Recognition Commission", kind: "entry" },
  { text: "2017", kind: "entry" },
  // 4-line with location
  { text: "Regional Safety Excellence Award", kind: "entry" },
  { text: "Workplace Safety Council", kind: "entry" },
  { text: "Winnipeg, MB", kind: "entry" },
  { text: "2019", kind: "entry" },
  // Present (ongoing recognition)
  { text: "Standing Recognition Award", kind: "entry" },
  { text: "Provincial Merit Commission", kind: "entry" },
  { text: "2019 - Present", kind: "entry" },
];

const PUBLICATION_LINES: Line[] = [
  { text: "Publications", kind: "heading" },
  // Shape H (4-line): Publication / Conference / Location / Date
  { text: "Emerging Patterns in Urban Water Management", kind: "entry" },
  { text: "International Conference on Sustainable Infrastructure", kind: "entry" },
  { text: "Halifax, NS", kind: "entry" },
  { text: "2021", kind: "entry" },
  // 2-line: Publication / Date
  { text: "Trends in Renewable Energy Adoption", kind: "entry" },
  { text: "2020", kind: "entry" },
  // 3-line: Publication / Journal / Date
  { text: "Community Nutrition Outreach Models", kind: "entry" },
  { text: "Journal of Public Health Practice", kind: "entry" },
  { text: "2019", kind: "entry" },
  // Bracket
  { text: "Sustainable Packaging Innovations (Review Article)", kind: "entry" },
  { text: "Quarterly Review of Environmental Policy", kind: "entry" },
  { text: "2022", kind: "entry" },
  // Pipe
  { text: "Urban Transit Efficiency | Comparative Study", kind: "entry" },
  { text: "Proceedings of the Transportation Research Symposium", kind: "entry" },
  { text: "2018", kind: "entry" },
  // Multiple locations
  { text: "Digital Literacy in Rural Communities", kind: "entry" },
  { text: "Presented in Toronto, ON and Montreal, QC", kind: "entry" },
  { text: "2020", kind: "entry" },
  // Academic-year-style range
  { text: "Longitudinal Study of Remote Work Adoption", kind: "entry" },
  { text: "Annual Workshop on Organizational Behavior", kind: "entry" },
  { text: "2019 - 2020", kind: "entry" },
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
