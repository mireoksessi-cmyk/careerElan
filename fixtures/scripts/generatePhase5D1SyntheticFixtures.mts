/*
  Phase 5D.1 - TASK 6 synthetic fixtures. Two files, PDF and DOCX,
  carrying the SAME logical content (anonymized, PII-free) as the real
  private entry-level resume that drove this round: two Volunteer
  Experience entries dated with U+FF0D (fullwidth hyphen-minus), an
  embedded "Education and Training" heading with a single bullet-only
  item, and an embedded "Certifications & Licenses" heading with two
  bullet credential items - the exact shape
  embeddedSubsectionSplitter.ts and the Unicode date-separator fix in
  dateRangeParsing.ts exist to recover.

  Run with `npx tsx fixtures/scripts/generatePhase5D1SyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAME = "Jordan Ellis";
const CONTACT = "Ottawa, ON | (555) 010-2299 | jordan.ellis@example.com";

/*
  Fullwidth hyphen-minus (U+FF0D), matching the real resume's exact
  separator - the whole reason this fixture exists.
*/
const DASH = "－";

async function writeDocx() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun(NAME)] }),
          new Paragraph({ children: [new TextRun(CONTACT)] }),
          new Paragraph({ text: "Volunteer Experience", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun(`Community Outreach Assistant, 05/2026 ${DASH} Current`)] }),
          new Paragraph({ children: [new TextRun(`Northside Community Network ${DASH} Ottawa, ON`)] }),
          new Paragraph({ text: "• Coordinated weekly outreach calls for local residents." }),
          new Paragraph({ text: "• Maintained volunteer scheduling records." }),
          new Paragraph({ children: [new TextRun(`Program Assistant , 04/2026 ${DASH} 05/2026`)] }),
          new Paragraph({ children: [new TextRun(`Riverside Youth Mentorship Program ${DASH} Ottawa, ON`)] }),
          new Paragraph({ text: "• Assisted with intake for new mentorship participants." }),
          new Paragraph({ text: "• Organized supply donations for weekly sessions." }),
          new Paragraph({ text: "• Supported event setup for two community fundraisers." }),
          new Paragraph({ children: [new TextRun("Education and Training")] }),
          new Paragraph({ text: `• Community Support Worker (Algonquin College) Expected in 04/2027 ${DASH} Ottawa, ON` }),
          new Paragraph({ children: [new TextRun("Certifications & Licenses")] }),
          new Paragraph({ text: "• Standard First Aid and CPR-C" }),
          new Paragraph({ text: "• Food Handler Certification (Ontario)" }),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, "f7-embedded-education-certifications.docx"), buffer);
  console.log("wrote f7-embedded-education-certifications.docx", buffer.length, "bytes");
}

function fixtureHtml(): string {
  const line = (text: string) => `<div>${text}</div>`;
  const bullet = (text: string) => `<div>• ${text}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
    h1 { font-size: 16px; margin: 16px 0 8px; }
  </style></head><body>
    ${line(NAME)}
    ${line(CONTACT)}
    <h1>Volunteer Experience</h1>
    ${line(`Community Outreach Assistant, 05/2026 ${DASH} Current`)}
    ${line(`Northside Community Network ${DASH} Ottawa, ON`)}
    ${bullet("Coordinated weekly outreach calls for local residents.")}
    ${bullet("Maintained volunteer scheduling records.")}
    ${line(`Program Assistant , 04/2026 ${DASH} 05/2026`)}
    ${line(`Riverside Youth Mentorship Program ${DASH} Ottawa, ON`)}
    ${bullet("Assisted with intake for new mentorship participants.")}
    ${bullet("Organized supply donations for weekly sessions.")}
    ${bullet("Supported event setup for two community fundraisers.")}
    ${line("Education and Training")}
    ${bullet(`Community Support Worker (Algonquin College) Expected in 04/2027 ${DASH} Ottawa, ON`)}
    ${line("Certifications & Licenses")}
    ${bullet("Standard First Aid and CPR-C")}
    ${bullet("Food Handler Certification (Ontario)")}
  </body></html>`;
}

async function writePdf() {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  await page.setContent(fixtureHtml(), { waitUntil: "networkidle" });
  const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
  await page.close();
  fs.writeFileSync(path.join(OUT_DIR, "f7-embedded-education-certifications.pdf"), pdfBytes);
  console.log("wrote f7-embedded-education-certifications.pdf", pdfBytes.length, "bytes");
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
