/*
  Phase 5D.6E TASK B - Synthetic regression matrix for
  classifyWrappedContinuation (skillsExtractor.ts). Minimum 60 cases
  per spec section 3.4: 30+ true continuation (should merge), 30+
  false continuation (should stay separate). Expected decisions are
  hand-authored from the classifier's own documented signal design
  (see skillsExtractor.ts's own header comment on
  classifyWrappedContinuation), never generated from its current
  output.
*/
import { classifyWrappedContinuation } from "./skillsExtractor";
import type { SemanticContentBlock, SemanticBlockBBox } from "../losslessSemantic/types";

let pass = 0;
let fail = 0;

function block(text: string, bbox?: SemanticBlockBBox, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  return {
    id: `block-${text.slice(0, 8)}`,
    sourceElementIds: [],
    text,
    rawText: text,
    pageIndex: 0,
    sourceOrder: 0,
    bbox,
    blockType,
  };
}

// A single "line" of a typical dense skills/list column: y increases by
// lineHeight+gap per line, x/width stay roughly constant (same column).
function line(y: number, width: number, height = 12): SemanticBlockBBox {
  return { x: 42, y, width, height };
}

function check(label: string, actual: string, expected: "merge" | "separate") {
  if (actual === expected) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} - expected ${expected}, got ${actual}`);
  }
}

function checkDecision(label: string, prev: SemanticContentBlock, next: SemanticContentBlock, expected: "merge" | "separate") {
  const result = classifyWrappedContinuation(prev, next);
  check(label, result.decision, expected);
}

// ============================================================
// TRUE CONTINUATION (30+) - a single skill/role list overflows a
// narrow column across two physical PDF lines; must merge.
// ============================================================

checkDecision(
  "true-1: Google / Sheets split by column wrap",
  block("Client communication • Data entry & file organization • Microsoft Word, Excel & Google", line(75, 240)),
  block("Sheets • Email communication", line(90, 230)),
  "merge"
);
checkDecision(
  "true-2: Power / BI split by column wrap",
  block("Data visualization, dashboards, Power", line(75, 235)),
  block("BI, and reporting automation", line(90, 232)),
  "merge"
);
checkDecision(
  "true-3: Project / Management split",
  block("Cross-functional coordination, Agile delivery, Project", line(75, 238)),
  block("Management, and stakeholder communication", line(90, 236)),
  "merge"
);
checkDecision(
  "true-4: Email & / phone communication split",
  block("Client relations, scheduling, Email &", line(75, 220)),
  block("phone communication, and record keeping", line(90, 234)),
  "merge"
);
checkDecision(
  "true-5: multi-line comma list, dangling 'and' wraps",
  block("SQL, Python, Tableau, and", line(75, 165)),
  block("Power BI", line(90, 80)),
  "merge"
);
checkDecision(
  "true-6: PDF line wrap, ampersand dangling",
  block("Budget planning, forecasting, Risk &", line(75, 210)),
  block("Compliance Management", line(90, 190)),
  "merge"
);
checkDecision(
  "true-7: DOCX line wrap, comma list dangling 'and'",
  block("Adobe Photoshop, Illustrator, and", line(75, 205)),
  block("InDesign", line(90, 70)),
  "merge"
);
checkDecision(
  "true-8: sidebar narrow column, comma list dangling '&'",
  block("Skills: JavaScript, TypeScript &", line(75, 155)),
  block("React", line(90, 55)),
  "merge"
);
checkDecision(
  "true-9: two-column layout, comma list dangling 'and'",
  block("Core Competencies: Negotiation, Leadership, and", line(75, 245)),
  block("Team Building", line(90, 115)),
  "merge"
);
checkDecision(
  "true-10: table cell continuity, comma list dangling 'and'",
  block("Certifications: PMP, Six Sigma, and", line(75, 220)),
  block("ITIL", line(90, 40)),
  "merge"
);
checkDecision(
  "true-11: French accented compound, comma list dangling 'et'",
  block("Compétences: gestion de projet, communication et", line(75, 260)),
  block("résolution de problèmes", line(90, 175)),
  "merge"
);
checkDecision(
  "true-12: long skill phrase wraps mid-and",
  block("Research and", line(75, 90)),
  block("Development strategy, and product lifecycle management", line(90, 300)),
  "merge"
);
checkDecision(
  "true-13: punctuation continuation, dash list dangling 'and'",
  block("Tools: Git, Docker, and", line(75, 155)),
  block("Kubernetes", line(90, 65)),
  "merge"
);
checkDecision(
  "true-14: bullet-glyph list already inline, wraps",
  block("Client communication • Administrative support • Data entry &", line(75, 260)),
  block("file organization • Call management", line(90, 220)),
  "merge"
);
checkDecision(
  "true-15: comma list wraps twice (second pair), dangling 'and'",
  block("Languages: English, French, and", line(75, 190)),
  block("Spanish", line(90, 65)),
  "merge"
);
checkDecision(
  "true-16: Slack / Notion, dangling 'and'",
  block("Collaboration tools: Slack, Notion, and", line(75, 220)),
  block("Confluence", line(90, 90)),
  "merge"
);
checkDecision(
  "true-17: AutoCAD / SolidWorks, dangling 'and'",
  block("CAD Software: AutoCAD, SolidWorks, and", line(75, 240)),
  block("CATIA", line(90, 55)),
  "merge"
);
checkDecision(
  "true-18: marketing tools, dangling 'and'",
  block("Marketing Stack: HubSpot, Mailchimp, and", line(75, 245)),
  block("Google Analytics", line(90, 150)),
  "merge"
);
checkDecision(
  "true-19: cloud platforms, dangling 'and'",
  block("Cloud Platforms: AWS, Azure, and", line(75, 215)),
  block("Google Cloud", line(90, 115)),
  "merge"
);
checkDecision(
  "true-20: databases, dangling 'and'",
  block("Databases: PostgreSQL, MySQL, and", line(75, 200)),
  block("MongoDB", line(90, 90)),
  "merge"
);
checkDecision(
  "true-21: soft skills, dangling 'and'",
  block("Interpersonal Skills: Active Listening, Empathy, and", line(75, 290)),
  block("Adaptability", line(90, 100)),
  "merge"
);
checkDecision(
  "true-22: office suite, dangling 'and'",
  block("Software: Microsoft Word, Excel, and", line(75, 240)),
  block("PowerPoint", line(90, 90)),
  "merge"
);
checkDecision(
  "true-23: bare trailing ampersand wraps",
  block("Client Communication &", line(75, 155)),
  block("Relationship Management", line(90, 195)),
  "merge"
);
checkDecision(
  "true-24: analytics tools, dangling 'and'",
  block("Analytics: Google Analytics, Mixpanel, and", line(75, 255)),
  block("Amplitude", line(90, 90)),
  "merge"
);
checkDecision(
  "true-25: frameworks, dangling 'and'",
  block("Frameworks: React, Angular, and", line(75, 195)),
  block("Vue", line(90, 35)),
  "merge"
);
checkDecision(
  "true-26: design tools, dangling 'and'",
  block("Design: Figma, Sketch, and", line(75, 175)),
  block("Adobe XD", line(90, 75)),
  "merge"
);
checkDecision(
  "true-27: project mgmt tools, dangling 'and'",
  block("PM Tools: Jira, Asana, and", line(75, 190)),
  block("Trello", line(90, 55)),
  "merge"
);
checkDecision(
  "true-28: negative vertical gap (tight kerning-like line spacing) still merges",
  block("Data Entry, File Organization, and", line(75, 225)),
  block("Scheduling", line(82, 90)),
  "merge"
);
checkDecision(
  "true-29: security tools, dangling 'and'",
  block("Security: Nmap, Wireshark, and", line(75, 195)),
  block("Metasploit", line(90, 90)),
  "merge"
);
checkDecision(
  "true-30: ampersand-and-comma mixed wrap, dangling 'and'",
  block("Budgeting & Forecasting, Vendor Management, and", line(75, 290)),
  block("Contract Negotiation", line(90, 145)),
  "merge"
);

// ============================================================
// FALSE CONTINUATION (30+) - two genuinely INDEPENDENT adjacent
// entries stacked with ordinary list spacing; must stay separate.
// ============================================================

checkDecision(
  "false-1: role + organization (Board Director / BC Manufacturing Association)",
  block("Board Director", line(75, 82)),
  block("BC Manufacturing Association - 2021 - Present", line(92, 201)),
  "separate"
);
checkDecision(
  "false-2: board role + association",
  block("Advisory Board Member", line(158, 135)),
  block("BCIT School of Business Manufacturing Program - 2019 - Present", line(175, 280)),
  "separate"
);
checkDecision(
  "false-3: skill title + institution",
  block("Guest Lecturer", line(75, 100)),
  block("University of Toronto - 2020 - 2022", line(90, 210)),
  "separate"
);
checkDecision(
  "false-4: title + location",
  block("Regional Sales Manager", line(75, 175)),
  block("Vancouver, British Columbia", line(90, 190)),
  "separate"
);
checkDecision(
  "false-5: credential + issuer",
  block("Project Management Professional", line(75, 220)),
  block("Project Management Institute - 2019", line(90, 210)),
  "separate"
);
checkDecision(
  "false-6: award + organization",
  block("Employee of the Year", line(75, 175)),
  block("Acme Corporation - 2021", line(90, 165)),
  "separate"
);
checkDecision(
  "false-7: department + company",
  block("Finance Department", line(75, 135)),
  block("Global Trade Partners Inc. - 2018 - 2020", line(90, 250)),
  "separate"
);
checkDecision(
  "false-8: date + next entry (prev ends with dash-date shape)",
  block("Senior Consultant - 2015 - 2019", line(75, 200)),
  block("Operations Lead", line(90, 130)),
  "separate"
);
checkDecision(
  "false-9: short Title Case + long independent line",
  block("Past President", line(242, 77)),
  block("Vancouver Chapter, Association for Supply Chain Management (ASCM) - 2015 - 2019", line(259, 362)),
  "separate"
);
checkDecision(
  "false-10: two adjacent bullets (bullet excluded)",
  block("Managed client accounts", line(75, 200), "bullet"),
  block("Led weekly team standups", line(90, 210), "bullet"),
  "separate"
);
checkDecision(
  "false-11: two adjacent skills, no dangling signal",
  block("Client Relations", line(75, 110)),
  block("Inventory Management", line(90, 170)),
  "separate"
);
checkDecision(
  "false-12: heading + body (title case heading, unrelated body text)",
  block("Volunteer Experience", line(75, 155)),
  block("Coordinated food drives for 200+ families", line(90, 260)),
  "separate"
);
checkDecision(
  "false-13: same font, different semantic role (title + date range)",
  block("Treasurer", line(75, 75)),
  block("Rotary Club of Downtown - 2016 - 2018", line(90, 220)),
  "separate"
);
checkDecision(
  "false-14: narrow column independent items",
  block("Team Lead", line(75, 70)),
  block("Northwind Traders - 2017 - 2020", line(90, 190)),
  "separate"
);
checkDecision(
  "false-15: chair role + committee",
  block("Committee Chair", line(75, 115)),
  block("Downtown Business Association - 2014 - 2016", line(90, 260)),
  "separate"
);
checkDecision(
  "false-16: founder role + company",
  block("Founder", line(75, 60)),
  block("Bright Path Consulting - 2012 - Present", line(90, 210)),
  "separate"
);
checkDecision(
  "false-17: mentor role + program",
  block("Volunteer Mentor", line(75, 130)),
  block("Big Brothers Big Sisters - 2019 - Present", line(90, 235)),
  "separate"
);
checkDecision(
  "false-18: coach role + team",
  block("Head Coach", line(75, 90)),
  block("Riverside Youth Soccer League - 2020 - 2022", line(90, 240)),
  "separate"
);
checkDecision(
  "false-19: editor role + publication",
  block("Editor in Chief", line(75, 125)),
  block("Campus Literary Review - 2013 - 2015", line(90, 220)),
  "separate"
);
checkDecision(
  "false-20: organizer role + event",
  block("Event Organizer", line(75, 125)),
  block("Annual Charity Gala - 2018 - 2021", line(90, 200)),
  "separate"
);
checkDecision(
  "false-21: liaison role + org",
  block("Community Liaison", line(75, 140)),
  block("City of Burnaby - 2017 - 2019", line(90, 190)),
  "separate"
);
checkDecision(
  "false-22: two independent short titles stacked",
  block("Vice President", line(75, 105)),
  block("Secretary", line(90, 70)),
  "separate"
);
checkDecision(
  "false-23: ambassador role + program",
  block("Student Ambassador", line(75, 135)),
  block("Faculty of Engineering - 2015 - 2016", line(90, 220)),
  "separate"
);
checkDecision(
  "false-24: captain role + team, prev ends without punctuation",
  block("Team Captain", line(75, 100)),
  block("Varsity Rowing Club - 2011 - 2013", line(90, 205)),
  "separate"
);
checkDecision(
  "false-25: director role + nonprofit",
  block("Program Director", line(75, 125)),
  block("Youth Outreach Society - 2016 - 2020", line(90, 220)),
  "separate"
);
checkDecision(
  "false-26: prev terminal punctuation blocks merge outright",
  block("Senior Analyst.", line(75, 110)),
  block("Meridian Capital Group - 2014 - 2018", line(90, 220)),
  "separate"
);
checkDecision(
  "false-27: missing bbox on next never merges",
  block("Board Member", line(75, 100)),
  block("Chamber of Commerce - 2013 - 2015", undefined),
  "separate"
);
checkDecision(
  "false-28: large vertical gap is a paragraph break, not a wrap",
  block("Advisor", line(75, 65)),
  block("Northgate Innovation Fund - 2019 - 2021", line(250, 220)),
  "separate"
);
checkDecision(
  "false-29: representative role + association",
  block("Student Representative", line(75, 150)),
  block("Faculty Council - 2014 - 2015", line(90, 175)),
  "separate"
);
checkDecision(
  "false-30: judge role + competition",
  block("Guest Judge", line(75, 90)),
  block("National Case Competition - 2020", line(90, 210)),
  "separate"
);
checkDecision(
  "false-31: two-word title with 'of' connector still reads as complete",
  block("Director of Operations", line(75, 165)),
  block("Lakeside Manufacturing - 2017 - 2021", line(90, 220)),
  "separate"
);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
