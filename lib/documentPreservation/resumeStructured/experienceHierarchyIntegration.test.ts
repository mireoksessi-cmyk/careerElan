/*
  Phase 5D.7 TASK C gate test - integration layer. hierarchicalGrouping.test.ts
  already covers the detection algorithm directly (51 assertions across
  numbering shapes, depth, and negative controls); this file instead
  drives the SAME fixtures through the real extractExperienceEntries
  entry point (header/body segmentation + hierarchy detection wired
  together, exactly as production calls it), across the round's
  required category diversity (Executive, Academic, Consulting,
  Research, Engineering, Medical, Government, Military, Startup,
  Project Portfolio, Nested Program) plus its explicit negative
  controls at the ENTRY level (plain bullets, plain paragraphs - never
  synthesized into a false hierarchy). All organization/people names
  are placeholder text, never a real company (per the round's own
  explicit prohibition). Run with
  `npx tsx lib/documentPreservation/resumeStructured/experienceHierarchyIntegration.test.ts`.
*/
import { extractExperienceEntries } from "./experienceExtractor";
import type { SemanticContentBlock, SemanticBlockType } from "../losslessSemantic/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

let counter = 0;
function block(text: string, opts: { type?: SemanticBlockType; x?: number; weight?: number | string } = {}): SemanticContentBlock {
  const i = counter++;
  return {
    id: `blk-p0-b${i}`,
    sourceElementIds: [`el-p0-e${i}`],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: i,
    bbox: opts.x !== undefined ? { x: opts.x, y: i * 20, width: 260, height: 12 } : undefined,
    style: opts.weight !== undefined ? { fontWeight: opts.weight } : undefined,
    blockType: opts.type ?? "paragraph",
  };
}

function header(role: string, org: string, dateRange: string): SemanticContentBlock[] {
  return [block(role), block(`${org}, Toronto, ON - ${dateRange}`)];
}

/*
  Each scenario: header (role/org/date, always plain-text so entry
  boundary detection is unaffected) + a body shaped like one of the
  round's required category/numbering combinations. Asserts exactly
  one entry, hasHierarchicalStructure, top-level count, and that flat
  content[] is UNCHANGED in length/order (additive-only guarantee).
*/
const scenarios: { name: string; body: SemanticContentBlock[]; expectTopLevel: number }[] = [
  {
    name: "Executive - numbered strategic pillars",
    body: [
      block("1. Corporate Strategy", { x: 50 }),
      block("Set the five-year growth plan for the enterprise.", { type: "bullet", x: 70 }),
      block("2. Stakeholder Relations", { x: 50 }),
      block("Represented the company before the board and major investors.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Academic - Roman-numeral research areas",
    body: [
      block("I. Materials Science", { x: 50 }),
      block("Led a five-person lab studying thin-film degradation.", { type: "bullet", x: 70 }),
      block("II. Undergraduate Instruction", { x: 50 }),
      block("Taught two sections of introductory materials engineering.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Consulting - lettered practice areas",
    body: [
      block("A. Financial Services Practice", { x: 50 }),
      block("Advised regional banks on core-system modernization.", { type: "bullet", x: 70 }),
      block("B. Public Sector Practice", { x: 50 }),
      block("Supported a provincial ministry's digital transformation.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Research - Programs -> named sub-areas (nested, no numbering, bold DOCX-style)",
    body: [
      block("Research Programs", { x: 40, weight: 700 }),
      block("Applied Photonics", { x: 55, weight: 700 }),
      block("Published four peer-reviewed papers on waveguide loss.", { type: "bullet", x: 75 }),
      block("Computational Imaging", { x: 55, weight: 700 }),
      block("Developed a reconstruction algorithm adopted by two partner labs.", { type: "bullet", x: 75 }),
    ],
    expectTopLevel: 1,
  },
  {
    name: "Engineering - numbered work-streams",
    body: [
      block("1. Platform Reliability", { x: 50 }),
      block("Reduced production incident rate by half over one year.", { type: "bullet", x: 70 }),
      block("2. Developer Tooling", { x: 50 }),
      block("Built an internal CLI adopted by the whole engineering org.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Medical - numbered clinical/administrative split",
    body: [
      block("1. Clinical Duties", { x: 50 }),
      block("Managed a caseload of 25 inpatients per rotation.", { type: "bullet", x: 70 }),
      block("2. Administrative Duties", { x: 50 }),
      block("Chaired the department's quality-improvement committee.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Government - alphabetic policy areas",
    body: [
      block("A. Regulatory Policy", { x: 50 }),
      block("Drafted amendments to two provincial regulations.", { type: "bullet", x: 70 }),
      block("B. Intergovernmental Affairs", { x: 50 }),
      block("Coordinated a joint working group with three neighbouring provinces.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Military - Roman-numeral command areas",
    body: [
      block("I. Operations Planning", { x: 50 }),
      block("Coordinated logistics for a multi-unit field exercise.", { type: "bullet", x: 70 }),
      block("II. Personnel Readiness", { x: 50 }),
      block("Oversaw training certification for a 60-person unit.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Startup - numbered founder responsibilities",
    body: [
      block("1. Product", { x: 50 }),
      block("Shipped the initial MVP in under three months.", { type: "bullet", x: 70 }),
      block("2. Fundraising", { x: 50 }),
      block("Closed a pre-seed round from two institutional investors.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Project Portfolio - numbered projects under one role",
    body: [
      block("1. Regional Distribution Upgrade", { x: 50 }),
      block("Delivered a warehouse automation project three weeks early.", { type: "bullet", x: 70 }),
      block("2. Vendor Consolidation Initiative", { x: 50 }),
      block("Reduced the active vendor list from 40 to 12.", { type: "bullet", x: 70 }),
    ],
    expectTopLevel: 2,
  },
  {
    name: "Nested Program - Programs -> numbered sub-programs -> bullets (2-level)",
    body: [
      block("Community Programs", { x: 40, weight: 700 }),
      block("1. Youth Mentorship", { x: 60 }),
      block("Paired 30 volunteer mentors with local youth.", { type: "bullet", x: 80 }),
      block("2. Financial Literacy Workshops", { x: 60 }),
      block("Delivered workshops to over 200 participants.", { type: "bullet", x: 80 }),
    ],
    expectTopLevel: 1,
  },
];

scenarios.forEach((s) => {
  counter = 0;
  const blocks = [...header("Program Director", "Placeholder Org", "2019 - Present"), ...s.body];
  const entries = extractExperienceEntries("s1", blocks, false);
  check(`${s.name}: exactly one entry`, entries.length, 1);
  const entry = entries[0];
  check(`${s.name}: hasHierarchicalStructure true`, entry?.hasHierarchicalStructure, true);
  check(`${s.name}: top-level node count`, entry?.hierarchicalContent.length, s.expectTopLevel);
  check(`${s.name}: flat content[] length unchanged (additive-only)`, entry?.content.length, s.body.length);
  check(
    `${s.name}: flat content[] order unchanged`,
    entry?.content.map((c) => c.text),
    s.body.map((b) => b.rawText)
  );
});

// ==================== Negative controls at the entry level ====================
{
  counter = 0;
  const blocks = [
    ...header("Sales Representative", "Placeholder Retailer", "2021 - Present"),
    block("Exceeded quarterly sales targets in five consecutive quarters.", { type: "bullet", x: 50 }),
    block("Trained three new hires on the point-of-sale system.", { type: "bullet", x: 50 }),
    block("Maintained a 98% customer satisfaction rating.", { type: "bullet", x: 50 }),
  ];
  const entries = extractExperienceEntries("s1", blocks, false);
  check("negative entry - plain bullet list: hasHierarchicalStructure false", entries[0]?.hasHierarchicalStructure, false);
  check("negative entry - plain bullet list: hierarchicalContent empty", entries[0]?.hierarchicalContent.length, 0);
  check("negative entry - plain bullet list: bullets[] still populated (unaffected)", entries[0]?.bullets.length, 3);
}
{
  counter = 0;
  const blocks = [
    ...header("Freelance Writer", "Self-Employed", "2020 - 2022"),
    block("Contributed long-form articles to several regional publications covering local business news."),
    block("Built a modest freelance client base through referrals and direct outreach over two years."),
  ];
  const entries = extractExperienceEntries("s1", blocks, false);
  check("negative entry - plain paragraphs: hasHierarchicalStructure false", entries[0]?.hasHierarchicalStructure, false);
  check("negative entry - plain paragraphs: descriptionParagraphs[] still populated (unaffected)", entries[0]?.descriptionParagraphs.length, 2);
}
{
  // multi-role-same-employer boundary (Round-2-era shape) must still split into two
  // distinct entries and neither should invent a hierarchy from a single plain body line.
  counter = 0;
  const blocks = [
    block("Operations Manager"),
    block("Placeholder Distribution Co, Calgary, AB - Mar 2020 - Present"),
    block("Oversee daily operations of a large distribution centre."),
    block("Assistant Operations Manager"),
    block("Placeholder Distribution Co, Calgary, AB - Jul 2017 - Feb 2020"),
    block("Supervised a team of 18 warehouse associates across two shifts."),
  ];
  const entries = extractExperienceEntries("s1", blocks, false);
  check("negative entry - multi-role boundary preserved: two entries", entries.length, 2);
  check("negative entry - multi-role: entry0 hasHierarchicalStructure false", entries[0]?.hasHierarchicalStructure, false);
  check("negative entry - multi-role: entry1 hasHierarchicalStructure false", entries[1]?.hasHierarchicalStructure, false);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
