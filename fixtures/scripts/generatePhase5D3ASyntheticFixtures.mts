/*
  Phase 5D.3A - Mixed Block Rendering Hardening synthetic fixtures. One
  anonymized PDF + DOCX pair, each Experience/Project/Custom-Section
  entry deliberately mixing bullet and plain-paragraph blocks in a
  specific order, so entry.content's order-preservation is proven
  general across every combination this round's spec (section 10)
  requires - never derived from any real resume's own text.

  Entries below (see each entry's own header comment for the exact
  shape it targets):
  - exp-1: bullet + continuation paragraph
  - exp-2: bullet + paragraph + bullet
  - exp-3: paragraph + bullet
  - exp-4: subheading-like short paragraph + bullet
  - exp-5: wrapped bullet continuation (bullet with no terminal
    punctuation, immediately followed by the paragraph that completes
    the sentence - the exact real-fixture shape Phase 5D.3 UAT found)
  - exp-6: multiple consecutive continuation paragraphs after one bullet
  - proj-1: project entry mixing bullet + paragraph (projectExtractor.ts's
    own name-line segmentation, not date-anchored)
  - custom section mixing paragraph + bullet + paragraph
  - one award + one publication entry (included for type-level
    consistency verification only - both extractors mirror their own
    `details` 1:1 into `content` today, no genuine multi-block body;
    see Phase 5D.3A's own final report for why that's a disclosed scope
    boundary, not a gap)

  Run with `npx tsx fixtures/scripts/generatePhase5D3ASyntheticFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes/lossless-synthetic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE_ID = "f12-mixed-entry-content";
const NAME = "Riley Chen";
const CONTACT = "London, ON | (555) 010-8836 | riley.chen@example.com";

type Line = { text: string; kind: "heading" | "role" | "orgDate" | "bullet" | "paragraph" | "name" };

const EXPERIENCE_LINES: Line[] = [
  { text: "Experience", kind: "heading" },

  // exp-1: bullet + continuation paragraph
  { text: "Operations Lead", kind: "role" },
  { text: "Bullet-Then-Paragraph Corp, Toronto, ON - 2022 - Present", kind: "orgDate" },
  { text: "Directed daily operations for a 40-person distribution center.", kind: "bullet" },
  {
    text: "This included direct oversight of receiving, inventory accuracy audits, and last-mile carrier coordination across the western region.",
    kind: "paragraph",
  },

  // exp-2: bullet + paragraph + bullet
  { text: "Project Coordinator", kind: "role" },
  { text: "Bullet-Paragraph-Bullet LLC, Ottawa, ON - 2020 - 2022", kind: "orgDate" },
  { text: "Coordinated cross-functional project timelines for six concurrent client engagements.", kind: "bullet" },
  { text: "Client feedback consistently cited responsiveness and clarity of weekly status reporting as a key differentiator.", kind: "paragraph" },
  { text: "Reduced average project delivery time by two weeks through improved intake screening.", kind: "bullet" },

  // exp-3: paragraph + bullet
  { text: "Field Representative", kind: "role" },
  { text: "Paragraph-Then-Bullet Group, Hamilton, ON - 2018 - 2020", kind: "orgDate" },
  { text: "Represented the organization at regional trade events and partner site visits throughout the fiscal year.", kind: "paragraph" },
  { text: "Logged and triaged over 200 partner inquiries with a same-week response rate above 90%.", kind: "bullet" },

  // exp-4: subheading-like short paragraph + bullet
  { text: "Regional Manager", kind: "role" },
  { text: "Subheading-Bullet Holdings, Kitchener, ON - 2015 - 2018", kind: "orgDate" },
  { text: "Key Initiative: Regional Onboarding Redesign", kind: "paragraph" },
  { text: "Piloted a redesigned onboarding curriculum across four branch locations.", kind: "bullet" },

  // exp-5: wrapped bullet continuation - bullet has no terminal
  // punctuation, the following plain paragraph completes the sentence
  // (the real Phase 5D.3 UAT shape - a bullet's own PDF/DOCX line-wrap
  // Phase 1 tags as a new "paragraph" block).
  { text: "Senior Analyst", kind: "role" },
  { text: "Wrapped-Continuation Partners, Waterloo, ON - 2012 - 2015", kind: "orgDate" },
  { text: "Owned monthly variance reporting for a $40M operating budget across five cost centers,", kind: "bullet" },
  { text: "flagging anomalies to finance leadership before the quarterly close.", kind: "paragraph" },

  // exp-6: multiple consecutive continuation paragraphs after one bullet
  { text: "Program Analyst", kind: "role" },
  { text: "Multi-Continuation Alliance, Guelph, ON - 2010 - 2012", kind: "orgDate" },
  { text: "Managed data collection for a multi-year regional impact study spanning four provinces.", kind: "bullet" },
  { text: "Findings were later cited in two provincial policy briefings on youth employment outcomes.", kind: "paragraph" },
  { text: "The study also informed a follow-on funding request that was ultimately approved.", kind: "paragraph" },
];

const PROJECT_LINES: Line[] = [
  { text: "Projects", kind: "heading" },
  { text: "Fleet Routing Optimizer", kind: "name" },
  { text: "Built a routing optimizer that cut average delivery time by 12% across the pilot fleet.", kind: "bullet" },
  { text: "Adoption expanded to two additional regional fleets within the same fiscal year.", kind: "paragraph" },
];

const AWARD_LINES: Line[] = [
  { text: "Awards", kind: "heading" },
  { text: "Regional Service Excellence Award, 2021", kind: "paragraph" },
];

const PUBLICATION_LINES: Line[] = [
  { text: "Publications", kind: "heading" },
  { text: "Chen, R. (2022). Field coordination patterns in mid-market logistics. Ontario Operations Review, 9(1).", kind: "paragraph" },
];

const CUSTOM_LINES: Line[] = [
  { text: "Board Memberships", kind: "heading" },
  { text: "Active volunteer with a regional food-security nonprofit since 2019.", kind: "paragraph" },
  { text: "Coordinated quarterly volunteer recruitment drives, growing the roster by 35%.", kind: "bullet" },
  { text: "Serves on the nonprofit's outreach subcommittee, providing input on annual engagement strategy.", kind: "paragraph" },
];

const ALL_LINES: Line[] = [...EXPERIENCE_LINES, ...PROJECT_LINES, ...AWARD_LINES, ...PUBLICATION_LINES, ...CUSTOM_LINES];

async function writeDocx() {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: NAME, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun(CONTACT)] }),
  ];
  for (const line of ALL_LINES) {
    if (line.kind === "heading") {
      paragraphs.push(new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_1 }));
    } else if (line.kind === "bullet") {
      paragraphs.push(new Paragraph({ text: `• ${line.text}` }));
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
    .map((line) => {
      if (line.kind === "heading") return `<h1>${line.text}</h1>`;
      if (line.kind === "bullet") return `<div>&bull; ${line.text}</div>`;
      return `<div>${line.text}</div>`;
    })
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
