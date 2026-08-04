/*
  E2E fixture generator (Phase 1-4 Hardening follow-up: real PDF/DOCX E2E
  verification round). Produces REAL binary DOCX/PDF files - not text
  placeholders - using libraries already in this project's own
  dependencies (`docx` for DOCX, Playwright's real Chromium print-to-pdf
  for PDF, the same engine already used by the DPE measurement harness).

  Not a new product feature - test-only fixture data, per this round's
  explicit "Placeholder Fixture를 사용할 수 있도록 구성" instruction.
*/
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..");

const PERSON = {
  name: "Emily Tran",
  email: "emily.tran@example.com",
  phone: "(604) 555-0182",
  linkedin: "linkedin.com/in/emilytran",
  city: "Vancouver, BC",
};

/* ---------- 1. Word DOCX Resume (corporate style: heading styles + a real table for skills) ---------- */
async function buildWordDocxResume() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: PERSON.name, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `${PERSON.city} | ${PERSON.phone} | ${PERSON.email} | ${PERSON.linkedin}` }),

          new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            text: "Frontend-focused software developer with 5 years of experience building customer-facing web applications for retail and logistics companies in British Columbia.",
          }),

          new Paragraph({ text: "Experience", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: "Senior Frontend Developer", bold: true })] }),
          new Paragraph({ text: "Northshore Retail Systems, Vancouver, BC — Jan 2022 to Present" }),
          new Paragraph({ text: "- Led the rebuild of the customer order-tracking portal used by 40,000 monthly active users." }),
          new Paragraph({ text: "- Reduced page load time by 38% by introducing code-splitting and image lazy-loading." }),
          new Paragraph({ text: "- Mentored two junior developers and ran weekly code review sessions." }),

          new Paragraph({ children: [new TextRun({ text: "Frontend Developer", bold: true })] }),
          new Paragraph({ text: "Coastal Freight Co., Burnaby, BC — Jun 2019 to Dec 2021" }),
          new Paragraph({ text: "- Built the internal shipment dashboard used by dispatch staff across 6 warehouses." }),
          new Paragraph({ text: "- Migrated the legacy jQuery UI to React, cutting bug reports by half." }),

          new Paragraph({ text: "Education", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "Bachelor of Science in Computer Science" }),
          new Paragraph({ text: "University of British Columbia, Vancouver, BC — 2015 to 2019" }),

          new Paragraph({ text: "Skills", heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("JavaScript / TypeScript")] }),
                  new TableCell({ children: [new Paragraph("React")] }),
                  new TableCell({ children: [new Paragraph("Node.js")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("CSS / Tailwind")] }),
                  new TableCell({ children: [new Paragraph("REST APIs")] }),
                  new TableCell({ children: [new Paragraph("Git")] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(path.join(OUT_DIR, "resumes", "word-docx-resume.docx"), buffer);
  console.log("wrote word-docx-resume.docx", buffer.length, "bytes");
}

/* ---------- 4. Google-Docs-style DOCX Resume (plain single column, no table, no bold headings styling variety) ---------- */
async function buildGoogleDocsStyleDocxResume() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: "Emily Tran", size: 32, bold: true })] }),
          new Paragraph({ text: `${PERSON.email} · ${PERSON.phone} · ${PERSON.city}` }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun({ text: "Experience", bold: true, size: 26 })] }),
          new Paragraph({ text: "Marketing Coordinator, Pacific Grove Foods, Richmond, BC (2021 - Present)" }),
          new Paragraph({ text: "Manage social media campaigns and email newsletters for a regional grocery brand." }),
          new Paragraph({ text: "Increased newsletter open rate from 18% to 27% over one year." }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Marketing Assistant, Fraser Valley Co-op, Abbotsford, BC (2019 - 2021)" }),
          new Paragraph({ text: "Coordinated in-store promotions and supplier partnership events." }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun({ text: "Education", bold: true, size: 26 })] }),
          new Paragraph({ text: "Bachelor of Commerce, Marketing, Simon Fraser University (2015 - 2019)" }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun({ text: "Skills", bold: true, size: 26 })] }),
          new Paragraph({ text: "Social media marketing, email campaigns, Adobe Photoshop, Google Analytics, copywriting" }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(path.join(OUT_DIR, "resumes", "google-docs-resume.docx"), buffer);
  console.log("wrote google-docs-resume.docx", buffer.length, "bytes");
}

/* ---------- PDF generation via real Chromium print-to-pdf (Playwright, already a project dependency) ---------- */
async function renderHtmlToPdf(html: string, outPath: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.pdf({ path: outPath, format: "Letter", printBackground: true });
  await browser.close();
  console.log("wrote", path.basename(outPath));
}

/* ---------- 2. Standard PDF Resume (plain single-column, like a Word-to-PDF export) ---------- */
const STANDARD_PDF_HTML = `
<html><head><style>
  body { font-family: "Times New Roman", serif; font-size: 12pt; margin: 40px; color: #111; }
  h1 { font-size: 20pt; margin-bottom: 2px; }
  .contact { font-size: 10pt; color: #333; margin-bottom: 16px; }
  h2 { font-size: 13pt; border-bottom: 1px solid #333; padding-bottom: 2px; margin-top: 18px; }
  .entry-title { font-weight: bold; margin-top: 8px; }
  .entry-meta { font-style: italic; font-size: 11pt; }
  ul { margin-top: 4px; }
</style></head>
<body>
  <h1>David Nguyen</h1>
  <div class="contact">Calgary, AB | (403) 555-0147 | david.nguyen@example.com | linkedin.com/in/davidnguyen</div>

  <h2>Summary</h2>
  <p>Operations analyst with 4 years of experience improving supply chain workflows for energy-sector logistics companies in Alberta.</p>

  <h2>Experience</h2>
  <div class="entry-title">Operations Analyst</div>
  <div class="entry-meta">Prairie Energy Logistics, Calgary, AB — Mar 2021 to Present</div>
  <ul>
    <li>Redesigned the weekly inventory reconciliation process, cutting manual entry time by 60%.</li>
    <li>Built Excel/Power BI dashboards used by the regional operations team of 15 staff.</li>
  </ul>
  <div class="entry-title">Junior Analyst</div>
  <div class="entry-meta">Foothills Supply Co., Calgary, AB — Jul 2019 to Feb 2021</div>
  <ul>
    <li>Tracked vendor delivery performance across 30+ suppliers.</li>
  </ul>

  <h2>Education</h2>
  <p>Bachelor of Business Administration, Supply Chain Management<br/>University of Calgary — 2015 to 2019</p>

  <h2>Skills</h2>
  <p>Excel, Power BI, SAP, vendor management, process improvement</p>
</body></html>
`;

/* ---------- 3. Canva-style PDF Resume (2-column layout, colored sidebar, avatar circle, header band, dividers) ---------- */
const CANVA_PDF_HTML = `
<html><head><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; color: #222; }
  .page { display: flex; min-height: 1000px; }
  .sidebar { width: 34%; background: #2c3e50; color: #fff; padding: 28px 20px; }
  .avatar { width: 90px; height: 90px; border-radius: 50%; background: #e67e22; margin: 0 auto 16px; }
  .sidebar h2 { font-size: 12pt; border-bottom: 1px solid #e67e22; padding-bottom: 4px; margin-top: 22px; }
  .sidebar p, .sidebar li { font-size: 9.5pt; line-height: 1.5; }
  .main { width: 66%; padding: 28px 30px; }
  .header-band { background: #34495e; color: #fff; padding: 14px 30px; }
  .header-band h1 { margin: 0; font-size: 22pt; }
  .header-band .role { font-size: 11pt; color: #ecf0f1; }
  .main h2 { font-size: 13pt; color: #2c3e50; border-bottom: 2px solid #e67e22; padding-bottom: 3px; margin-top: 20px; }
  .divider { height: 2px; background: #e67e22; margin: 10px 0; width: 60%; }
  .entry-title { font-weight: bold; margin-top: 10px; }
  .entry-meta { font-size: 10pt; color: #555; }
</style></head>
<body>
  <div class="header-band">
    <h1>Sofia Marchetti</h1>
    <div class="role">Graphic &amp; UX Designer</div>
  </div>
  <div class="page">
    <div class="sidebar">
      <div class="avatar"></div>
      <h2>Contact</h2>
      <p>Toronto, ON<br/>(416) 555-0193<br/>sofia.marchetti@example.com<br/>linkedin.com/in/sofiamarchetti</p>
      <h2>Skills</h2>
      <ul><li>Figma</li><li>Adobe Illustrator</li><li>Adobe XD</li><li>Design systems</li><li>User research</li></ul>
      <h2>Languages</h2>
      <p>English (fluent), Italian (native)</p>
    </div>
    <div class="main">
      <h2>Summary</h2>
      <p>UX/graphic designer with 6 years of experience creating brand identities and product interfaces for consumer apps in the Greater Toronto Area.</p>
      <div class="divider"></div>
      <h2>Experience</h2>
      <div class="entry-title">Senior Product Designer</div>
      <div class="entry-meta">Lakeshore Digital Studio, Toronto, ON — Feb 2022 to Present</div>
      <p>Led the visual redesign of a consumer banking app used by 200,000 customers.<br/>Established a shared component library adopted across 4 product teams.</p>
      <div class="entry-title">Graphic Designer</div>
      <div class="entry-meta">Queen West Creative Agency, Toronto, ON — Sep 2018 to Jan 2022</div>
      <p>Designed marketing materials and brand identities for 20+ small business clients.</p>
      <div class="divider"></div>
      <h2>Education</h2>
      <p>Bachelor of Design, OCAD University, Toronto, ON — 2014 to 2018</p>
    </div>
  </div>
</body></html>
`;

/* ---------- 5. PDF Cover Letter ---------- */
const COVER_LETTER_PDF_HTML = `
<html><head><style>
  body { font-family: "Times New Roman", serif; font-size: 12pt; margin: 50px; color: #111; line-height: 1.5; }
  .date { margin-bottom: 24px; }
  .recipient { margin-bottom: 24px; }
  p { margin-bottom: 14px; }
</style></head>
<body>
  <div class="date">March 3, 2026</div>
  <div class="recipient">Hiring Manager<br/>Northshore Retail Systems<br/>Vancouver, BC</div>
  <p>Dear Hiring Manager,</p>
  <p>I am writing to apply for the Senior Frontend Developer position at Northshore Retail Systems. With five years of experience building customer-facing web applications for retail and logistics companies in British Columbia, I am confident I can contribute immediately to your team.</p>
  <p>In my current role, I led the rebuild of a customer order-tracking portal used by 40,000 monthly active users and reduced page load time by 38% through code-splitting and lazy-loading. I also mentor junior developers and run weekly code review sessions, which I understand is a priority for your growing engineering team.</p>
  <p>I would welcome the opportunity to discuss how my experience aligns with your needs. Thank you for your consideration.</p>
  <p>Sincerely,<br/>Emily Tran<br/>emily.tran@example.com<br/>(604) 555-0182</p>
</body></html>
`;

async function main() {
  await mkdir(path.join(OUT_DIR, "resumes"), { recursive: true });
  await mkdir(path.join(OUT_DIR, "coverletters"), { recursive: true });

  await buildWordDocxResume();
  await buildGoogleDocsStyleDocxResume();
  await renderHtmlToPdf(STANDARD_PDF_HTML, path.join(OUT_DIR, "resumes", "standard-pdf-resume.pdf"));
  await renderHtmlToPdf(CANVA_PDF_HTML, path.join(OUT_DIR, "resumes", "canva-pdf-resume.pdf"));
  await renderHtmlToPdf(COVER_LETTER_PDF_HTML, path.join(OUT_DIR, "coverletters", "pdf-cover-letter.pdf"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
