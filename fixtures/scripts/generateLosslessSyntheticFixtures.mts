/*
  TASK 8 - generates the 6 synthetic DOCX fixtures the spec's Fixture
  Strategy section calls for (minimally added only for genuinely missing
  diversity types - see the final report's Fixture Inventory section for
  which real fixtures already covered which types). All content is
  synthetic and PII-free: @example.com emails, 555 phone numbers,
  invented names/companies, per the spec's own convention.

  Run with `npx tsx fixtures/scripts/generateLosslessSyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}
function body(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)] });
}
function bullet(text: string): Paragraph {
  return new Paragraph({ text: `• ${text}` });
}

async function write(fileName: string, children: (Paragraph | Table)[]) {
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, fileName), buffer);
  console.log("wrote", fileName, buffer.length, "bytes");
}

async function main() {
  // F1 - Career Profile + Employment History + Awards + one unknown custom heading
  await write("f1-career-profile-awards-custom.docx", [
    body("Rachel Kim"),
    body("Toronto, ON | (555) 010-2231 | rachel.kim@example.com"),
    heading("Career Profile"),
    body("Marketing coordinator with 5 years of experience running B2B campaigns for mid-size Canadian firms."),
    heading("Employment History"),
    body("Marketing Coordinator, Northline Media, Toronto, ON — Jan 2021 to Present"),
    bullet("Managed a quarterly content calendar across four channels."),
    bullet("Grew newsletter subscriber base by 40% in one year."),
    body("Marketing Assistant, Bluepeak Agency, Toronto, ON — Jun 2018 to Dec 2020"),
    bullet("Supported campaign reporting for six client accounts."),
    heading("Awards"),
    bullet("Northline Media Rising Star Award, 2022"),
    bullet("Bluepeak Agency Client Excellence Award, 2019"),
    heading("Speaking & Media Appearances"),
    body("Guest panelist, Toronto Marketing Week — 2023"),
    body("Interviewed for a regional marketing podcast on newsletter growth tactics — 2022"),
  ]);

  // F2 - Work History + Licenses-only + Community Involvement
  await write("f2-work-history-licenses-community.docx", [
    body("Daniel Osei"),
    body("Winnipeg, MB | (555) 010-4471 | daniel.osei@example.com"),
    heading("Work History"),
    body("Electrician, Prairie Electric Ltd., Winnipeg, MB — Mar 2019 to Present"),
    bullet("Performed residential and light-commercial electrical installations."),
    heading("Licenses"),
    bullet("Certificate of Qualification, Construction and Maintenance Electrician, Manitoba — 2019"),
    bullet("Red Seal Endorsement — 2020"),
    heading("Community Involvement"),
    body("Volunteer instructor, Winnipeg Trades Youth Program — 2021 to Present"),
    bullet("Led monthly hands-on electrical safety workshops for high school students."),
  ]);

  // F3 - combined "Licenses & Certifications" heading + Professional Development + Publications
  await write("f3-combined-licenses-certifications.docx", [
    body("Priya Chandran"),
    body("Halifax, NS | (555) 010-7782 | priya.chandran@example.com"),
    heading("Summary"),
    body("Registered dietitian focused on community nutrition programs across Nova Scotia."),
    heading("Licenses & Certifications"),
    bullet("Registered Dietitian, Nova Scotia — 2017 to Present"),
    bullet("Certified Diabetes Educator — 2019"),
    heading("Professional Development"),
    bullet("Advanced Clinical Nutrition Workshop Series, Dalhousie University — 2022"),
    heading("Publications"),
    body("Chandran, P. (2021). Community nutrition outreach in rural Nova Scotia. Atlantic Health Journal, 14(2)."),
  ]);

  // F4 - Projects section (no employer/date-range entry shape)
  await write("f4-projects.docx", [
    body("Marcus Bellefeuille"),
    body("Ottawa, ON | (555) 010-9013 | marcus.bellefeuille@example.com"),
    heading("Summary"),
    body("Software developer building small internal tools and open-source utilities."),
    heading("Projects"),
    body("Shift Scheduler"),
    bullet("Built a small web app for volunteer shift scheduling using TypeScript, React, PostgreSQL."),
    body("Transit Delay Tracker"),
    bullet("Developed a script that polls a public transit API and logs delay patterns."),
    heading("Skills"),
    body("TypeScript, React, PostgreSQL, Python"),
  ]);

  // F5 - zero section headings (whole document is one continuous narrative)
  await write("f5-no-heading-document.docx", [
    body("Angela Fortin"),
    body(
      "Angela is a bilingual customer support specialist based in Quebec City with six years of experience helping clients resolve billing and account issues by phone and email."
    ),
    body(
      "Most recently she worked at a regional telecom provider, where she consistently exceeded first-call resolution targets and trained three new hires on the support ticketing system."
    ),
    body(
      "Before that she worked at a retail call centre handling order and shipping inquiries, and she completed a college diploma in office administration in Quebec City."
    ),
    body("She is comfortable working in both French and English and is looking for a similar bilingual support role."),
  ]);

  // F6 - DOCX table-based resume (skills as a real Word table, not a bullet list)
  const skillsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("Skill")] }),
          new TableCell({ children: [new Paragraph("Level")] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("Excel")] }),
          new TableCell({ children: [new Paragraph("Advanced")] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("SQL")] }),
          new TableCell({ children: [new Paragraph("Intermediate")] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("Power BI")] }),
          new TableCell({ children: [new Paragraph("Advanced")] }),
        ],
      }),
    ],
  });
  await write("f6-docx-table-skills.docx", [
    body("Simone Tremblay"),
    body("Quebec City, QC | (555) 010-3345 | simone.tremblay@example.com"),
    heading("Summary"),
    body("Data analyst with a background in retail reporting and dashboard design."),
    heading("Experience"),
    body("Data Analyst, Laurent Retail Group, Quebec City, QC — 2020 to Present"),
    bullet("Built weekly sales dashboards used by regional managers."),
    heading("Skills"),
    skillsTable,
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
