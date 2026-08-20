/*
  Phase 3C negative-evidence fixtures. Two PDFs, and only these two - a
  dedicated generator rather than an extension of an existing one,
  because every other generator's main() rewrites its whole fixture set
  and would have re-emitted frozen PDFs (the MetricGrid f8-f11 set in
  particular) as a side effect of adding a scenario here.

  Both fixtures are NEGATIVES for a future page-column/region detector.
  Neither is a multi-column resume; both merely LOOK like one to a naive
  detector that only counts horizontal anchors:

  - single-column-right-metadata-rail.pdf
    An ordinary single-column resume whose Experience entries carry a
    date, and mostly a location, at a stable right anchor. That rail
    repeats down most of the page, so it is geometrically tempting - but
    it is metadata bound to the entry on its left, never an independent
    reading flow: it owns no section heading and no narrative of its
    own.

  - single-column-local-skills-grid.pdf
    An ordinary single-column resume whose Skills section alone is laid
    out as a short two-column "Category: values" grid. The grid is the
    already-supported Phase 3A shape, so this fixture doubles as proof
    that recognising it must not columnise the whole page: ordinary
    single-column content sits above it and Education sits below it.

  Content is synthetic and PII-free (invented names/companies,
  @example.com, 555 numbers), matching the convention the other fixture
  generators already follow. Layout is expressed in ordinary CSS at
  plausible resume proportions - no coordinate is chosen to sit near a
  known parser constant, since the point is evidence, not a rigged pass.

  Run with `npx tsx fixtures/scripts/generatePhase3CNegativeFixtures.mts`.
*/
import fs from "node:fs";
import path from "node:path";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUT_DIR = path.resolve(process.cwd(), "fixtures/resumes");

const SHARED_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 54px 60px; }
  .name { font-size: 20px; font-weight: bold; }
  .title { font-size: 12px; margin-top: 2px; }
  h2 { font-size: 13px; font-weight: bold; margin: 20px 0 8px; }
  p { margin: 0 0 6px; line-height: 1.45; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  li { margin-bottom: 3px; line-height: 1.45; }
`;

/*
  The rail: each entry header is a row whose left half is the real
  role/company text and whose right half is a fixed-width, right-aligned
  metadata cell. The fixed width is what gives the rail a STABLE anchor
  across entries, which is exactly the property that makes it look like
  a column - and the bullets underneath, which span the full width and
  cross that anchor, are what prove it is not one.
*/
function rightMetadataRailHtml(): string {
  const entries = [
    {
      role: "Senior Reliability Engineer",
      org: "Northwind Instruments",
      date: "2023 &ndash; Present",
      place: "Toronto, ON",
      bullets: [
        "Designed an automated regression harness that shortened release verification from four days to one.",
        "Led a cross-functional reliability review covering firmware, hardware, and field-service reporting.",
      ],
    },
    {
      role: "Reliability Engineer",
      org: "Beacon Systems Group",
      date: "2020 &ndash; 2023",
      place: "Ottawa, ON",
      bullets: [
        "Developed accelerated life-test procedures adopted across three product families.",
        "Improved mean time between failures by rebuilding the component qualification workflow.",
      ],
    },
    {
      role: "Test Engineer",
      org: "Gamma Precision Works",
      date: "2018 &ndash; 2020",
      place: "Montreal, QC",
      bullets: [
        "Supported qualification testing for precision assemblies used in regulated environments.",
      ],
    },
  ];

  const entryHtml = entries
    .map(
      (e) => `
      <div class="entry">
        <div class="entry-row"><div class="entry-main">${e.role}</div><div class="entry-meta">${e.date}</div></div>
        <div class="entry-row"><div class="entry-main">${e.org}</div><div class="entry-meta">${e.place}</div></div>
        <ul>${e.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
      </div>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>${SHARED_CSS}
    .entry { margin-bottom: 14px; }
    .entry-row { display: flex; justify-content: space-between; align-items: baseline; }
    .entry-main { font-weight: bold; }
    .entry-row + .entry-row .entry-main { font-weight: normal; }
    .entry-meta { width: 130px; text-align: right; flex: none; }
  </style></head><body>
    <div class="name">Dana Whitfield</div>
    <div class="title">Reliability Engineer</div>

    <h2>Summary</h2>
    <p>Reliability engineer with seven years of experience in test automation, component qualification, and field-failure analysis for regulated instrumentation.</p>

    <h2>Experience</h2>
    ${entryHtml}

    <h2>Education</h2>
    <div class="entry-row"><div class="entry-main">B.A.Sc. in Mechanical Engineering</div><div class="entry-meta">2014 &ndash; 2018</div></div>
    <div class="entry-row"><div class="entry-main">Lakeshore Polytechnic Institute</div><div class="entry-meta">Hamilton, ON</div></div>

    <h2>Skills</h2>
    <p>Test automation, accelerated life testing, failure analysis, statistical process control, technical documentation.</p>
  </body></html>`;
}

/*
  The local grid: only the Skills section is laid out in two cells per
  row. The label cell is fixed-width so the value cells share a stable
  anchor, which is what makes this shape look column-like in isolation -
  but it spans only a few rows, it carries a single Skills heading for
  both sides, and the page returns to one full-width flow immediately
  below it.
*/
function localSkillsGridHtml(): string {
  const rows = [
    { label: "Programming:", values: "Python, Java" },
    { label: "CAD:", values: "CATIA V5, NX" },
    { label: "Simulation:", values: "ANSYS" },
  ];

  const gridHtml = rows
    .map((r) => `<div class="skill-row"><div class="skill-label">${r.label}</div><div class="skill-values">${r.values}</div></div>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>${SHARED_CSS}
    .skill-row { display: flex; margin-bottom: 5px; }
    .skill-label { width: 170px; flex: none; font-weight: bold; }
    .skill-values { flex: 1; }
  </style></head><body>
    <div class="name">Rowan Ashby</div>
    <div class="title">Mechanical Design Engineer</div>

    <h2>Summary</h2>
    <p>Mechanical design engineer focused on thermal systems, structural simulation, and design-for-manufacture across electric-vehicle programs.</p>

    <h2>Experience</h2>
    <p><strong>Mechanical Design Engineer</strong>, Elmridge Mobility &mdash; 2021 to Present</p>
    <ul>
      <li>Developed thermal management assemblies for high-voltage battery packs.</li>
      <li>Ran structural and thermal simulations to support design-review milestones.</li>
    </ul>
    <p><strong>Design Engineer</strong>, Harrow Components &mdash; 2018 to 2021</p>
    <ul>
      <li>Produced detailed assembly drawings and tolerance stack-up analyses.</li>
    </ul>

    <h2>Skills</h2>
    ${gridHtml}

    <h2>Education</h2>
    <p>B.Eng. in Mechanical Engineering, Westbrook University &mdash; 2014 to 2018</p>
    <p>Coursework in finite element analysis, heat transfer, and manufacturing processes.</p>
  </body></html>`;
}

const FIXTURES: { file: string; html: string }[] = [
  { file: "single-column-right-metadata-rail.pdf", html: rightMetadataRailHtml() },
  { file: "single-column-local-skills-grid.pdf", html: localSkillsGridHtml() },
];

async function main() {
  const browser = await getSharedBrowser();
  for (const fixture of FIXTURES) {
    const page = await browser.newPage();
    await page.setContent(fixture.html, { waitUntil: "networkidle" });
    const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
    await page.close();
    fs.writeFileSync(path.join(OUT_DIR, fixture.file), pdfBytes);
    console.log("wrote", fixture.file, pdfBytes.length, "bytes");
  }
  await closeSharedBrowser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
