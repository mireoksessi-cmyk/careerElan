/*
  Phase 6I.6.33 - Golden QA & Cross-Format Rendering Lockdown (Part D).

  12 additional synthetic, PII-free ResumeStructuredModel fixtures
  covering the structural SHAPES the existing single "Jordan Ellis"
  fixture (fixtures/resumes/template-preview/jordanEllisFixture.ts)
  does not exercise: 1-page/junior, sparse, education-heavy,
  project-heavy, long-string, Unicode, dense-bullet, volunteer-gap, and
  blank/noisy-entry shapes. Jordan Ellis itself already covers the
  "senior/3-4 page, every section populated, hierarchical content"
  shape and is reused unmodified as Fixture 3 (senior) by the 6I.6.33
  test suite rather than being duplicated here.

  No real person, no real company - every name below is invented for
  this fixture file. Follows the same hand-authored StructuredTextValue/
  SourceTrace conventions as jordanEllisFixture.ts so both fixture
  files can be consumed identically by the render engine.
*/
import { RESUME_STRUCTURED_SCHEMA_VERSION } from "../../../lib/documentPreservation/resumeStructured/types";
import type {
  AwardEntry,
  CredentialEntry,
  CustomResumeSection,
  EducationEntry,
  EntryContentBlock,
  ExperienceEntry,
  ExtractionMethod,
  ProjectEntry,
  PublicationEntry,
  ResumeStructuredModel,
  SkillGroup,
  SourceTrace,
  StructuredBullet,
  StructuredTextValue,
} from "../../../lib/documentPreservation/resumeStructured/types";

function trace(sectionId: string, blockIds: string[] = []): SourceTrace {
  return { sourceSectionId: sectionId, sourceBlockIds: blockIds, sourceElementIds: [] };
}

function tv(value: string, sectionId = "sec", method: ExtractionMethod = "explicit-label"): StructuredTextValue {
  return { value, confidence: 0.9, extractionMethod: method, source: trace(sectionId) };
}

function b(id: string, text: string, sectionId = "sec-exp"): StructuredBullet {
  return { id, text, source: trace(sectionId) };
}

function cBullet(id: string, text: string, sectionId = "sec-exp"): EntryContentBlock {
  return { id, kind: "bullet", text, source: trace(sectionId) };
}

function cParagraph(id: string, text: string, sectionId = "sec-exp"): EntryContentBlock {
  return { id, kind: "paragraph", text, source: trace(sectionId) };
}

function exp(id: string, overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id,
    organization: undefined,
    role: undefined,
    location: undefined,
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: undefined,
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    hierarchicalContent: [],
    hasHierarchicalStructure: false,
    rawHeaderText: "",
    source: trace("sec-exp"),
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

/*
  Codebase invariant (see EducationEntry's own type comment in
  resumeStructured/types.ts): the singular institution/credential/
  fieldOfStudy fields must ALWAYS equal institutions[0]/credentials[0]/
  fieldsOfStudy[0] whenever the corresponding array is non-empty - a
  real extractor always populates both in sync. These builders default
  each array from the singular field so every fixture in this file
  satisfies that invariant by construction, unless a caller explicitly
  passes a different array override (e.g. Fixture 5's multi-credential/
  multi-field entries).
*/
function edu(id: string, overrides: Partial<EducationEntry> = {}): EducationEntry {
  return {
    id,
    institution: undefined,
    credential: undefined,
    fieldOfStudy: undefined,
    location: undefined,
    credentials: overrides.credential ? [overrides.credential] : [],
    fieldsOfStudy: overrides.fieldOfStudy ? [overrides.fieldOfStudy] : [],
    institutions: overrides.institution ? [overrides.institution] : [],
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: undefined,
    gpa: undefined,
    honors: [],
    details: [],
    rawHeaderText: "",
    source: trace("sec-edu"),
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function cred(id: string, overrides: Partial<CredentialEntry> = {}): CredentialEntry {
  return {
    id,
    name: undefined,
    issuer: undefined,
    credentialId: undefined,
    issueDateText: undefined,
    expiryDateText: undefined,
    location: undefined,
    names: overrides.name ? [overrides.name] : [],
    issuers: overrides.issuer ? [overrides.issuer] : [],
    details: [],
    kind: "certification",
    rawHeaderText: "",
    source: trace("sec-cred"),
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function proj(id: string, overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id,
    name: undefined,
    role: undefined,
    dateRangeText: undefined,
    technologies: [],
    bullets: [],
    descriptionParagraphs: [],
    content: [],
    rawHeaderText: "",
    source: trace("sec-proj"),
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function award(id: string, overrides: Partial<AwardEntry> = {}): AwardEntry {
  return {
    id,
    name: undefined,
    issuer: undefined,
    names: overrides.name ? [overrides.name] : [],
    dateText: undefined,
    details: [],
    content: [],
    rawHeaderText: "",
    source: trace("sec-award"),
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function pub(id: string, overrides: Partial<PublicationEntry> = {}): PublicationEntry {
  return {
    id,
    title: undefined,
    titles: overrides.title ? [overrides.title] : [],
    authors: [],
    publisherOrVenue: undefined,
    dateText: undefined,
    urlOrDoi: undefined,
    details: [],
    content: [],
    rawHeaderText: "",
    source: trace("sec-pub"),
    isUncertain: false,
    reasonCodes: [],
    ...overrides,
  };
}

function customSection(id: string, overrides: Partial<CustomResumeSection> = {}): CustomResumeSection {
  return {
    id,
    originalHeading: null,
    displayHeading: null,
    paragraphs: [],
    bullets: [],
    content: [],
    sourceOrder: 0,
    source: trace("sec-custom"),
    ...overrides,
  };
}

function skillGroup(label: string | undefined, skills: string[]): SkillGroup {
  return { label, skills, source: trace("sec-skills") };
}

function base(overrides: Partial<ResumeStructuredModel>): ResumeStructuredModel {
  return {
    schemaVersion: RESUME_STRUCTURED_SCHEMA_VERSION,
    source: { fileName: "synthetic-golden-qa.pdf", fileType: "pdf" },
    skillGroups: [],
    professionalExperience: [],
    volunteerExperience: [],
    education: [],
    credentials: [],
    projects: [],
    awards: [],
    publications: [],
    customSections: [],
    metricGrids: [],
    slotAvailability: {
      identity: true,
      professional_summary: true,
      core_skills: true,
      professional_experience: true,
      volunteer_experience: false,
      education: true,
      certifications_licenses: false,
      projects: false,
      awards: false,
      publications: false,
      additional_information: false,
    },
    validation: {
      passed: true,
      sourceSectionCount: 0,
      representedSectionCount: 0,
      missingSectionIds: [],
      sourceBlockCount: 0,
      representedBlockCount: 0,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
    ...overrides,
  };
}

/* Fixture 1 - Junior / 1-page: summary, 1 experience, education, skills,
   no projects/certifications/awards. */
export function buildJuniorFixture(): ResumeStructuredModel {
  return base({
    identity: {
      fullName: tv("Priya Nakamura", "sec-identity"),
      headline: tv("Junior Marketing Coordinator", "sec-identity"),
      email: tv("priya.nakamura@example.com", "sec-identity"),
      phone: tv("+1 (604) 555-0110", "sec-identity"),
      location: tv("Vancouver, BC", "sec-identity"),
      otherContactLines: [],
    },
    professionalSummary: { text: "Recent marketing graduate with hands-on internship experience in social media campaign coordination.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Marketing", ["Content Calendars", "Canva", "Google Analytics"]), skillGroup("Tools", ["Hootsuite", "Mailchimp"])],
    professionalExperience: [
      exp("exp-brightpath", {
        organization: tv("Brightpath Media Co.", "sec-exp"),
        role: tv("Marketing Coordinator", "sec-exp"),
        dateRangeText: tv("Jun 2024 – Present", "sec-exp"),
        bullets: [b("jr-b1", "Scheduled and published 40+ social posts per month across 3 platforms."), b("jr-b2", "Assisted in launching an email campaign that grew the newsletter list by 18%.")],
        content: [cBullet("jr-c1", "Scheduled and published 40+ social posts per month across 3 platforms."), cBullet("jr-c2", "Assisted in launching an email campaign that grew the newsletter list by 18%.")],
        rawHeaderText: "Marketing Coordinator — Brightpath Media Co. — Jun 2024 – Present",
      }),
    ],
    education: [edu("jr-edu-1", { institution: tv("Simon Fraser University", "sec-edu"), credential: tv("BA, Communication", "sec-edu"), dateRangeText: tv("2020 – 2024", "sec-edu"), institutions: [tv("Simon Fraser University", "sec-edu")], rawHeaderText: "BA, Communication — Simon Fraser University" })],
  });
}

/* Fixture 2 - Standard / 2-page: summary, 3 experiences, education,
   skills, 1 project, 1 certification. */
export function buildStandardFixture(): ResumeStructuredModel {
  return base({
    identity: {
      fullName: tv("Marcus Delgado", "sec-identity"),
      headline: tv("Software Engineer", "sec-identity"),
      email: tv("marcus.delgado@example.com", "sec-identity"),
      phone: tv("+1 (416) 555-0177", "sec-identity"),
      location: tv("Toronto, ON", "sec-identity"),
      linkedin: tv("linkedin.com/in/marcusdelgado", "sec-identity"),
      otherContactLines: [],
    },
    professionalSummary: { text: "Full-stack engineer with 6 years building and scaling web applications for mid-size SaaS companies.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Languages", ["TypeScript", "Python", "Go"]), skillGroup("Frameworks", ["React", "Next.js", "Django"])],
    professionalExperience: [
      exp("std-exp-1", { organization: tv("Vantage Software", "sec-exp"), role: tv("Senior Software Engineer", "sec-exp"), dateRangeText: tv("2021 – Present", "sec-exp"), bullets: [b("std-b1", "Led migration of the billing service to a microservice architecture."), b("std-b2", "Reduced average API latency by 35% through query optimization.")], content: [cBullet("std-c1", "Led migration of the billing service to a microservice architecture."), cBullet("std-c2", "Reduced average API latency by 35% through query optimization.")], rawHeaderText: "Senior Software Engineer — Vantage Software" }),
      exp("std-exp-2", { organization: tv("Redwood Analytics", "sec-exp"), role: tv("Software Engineer", "sec-exp"), dateRangeText: tv("2019 – 2021", "sec-exp"), bullets: [b("std-b3", "Built a real-time dashboard used by 200+ internal analysts.")], content: [cBullet("std-c3", "Built a real-time dashboard used by 200+ internal analysts.")], rawHeaderText: "Software Engineer — Redwood Analytics" }),
      exp("std-exp-3", { organization: tv("Northgate Retail", "sec-exp"), role: tv("Junior Developer", "sec-exp"), dateRangeText: tv("2017 – 2019", "sec-exp"), bullets: [b("std-b4", "Maintained the inventory management web portal.")], content: [cBullet("std-c4", "Maintained the inventory management web portal.")], rawHeaderText: "Junior Developer — Northgate Retail" }),
    ],
    education: [edu("std-edu-1", { institution: tv("University of Waterloo", "sec-edu"), credential: tv("BSc, Computer Science", "sec-edu"), dateRangeText: tv("2013 – 2017", "sec-edu"), institutions: [tv("University of Waterloo", "sec-edu")], rawHeaderText: "BSc, Computer Science — University of Waterloo" })],
    projects: [proj("std-proj-1", { name: tv("Open-source CLI resume linter", "sec-proj"), technologies: [tv("Node.js", "sec-proj"), tv("TypeScript", "sec-proj")], bullets: [b("std-pb1", "Published a CLI tool with 1,200+ npm downloads.", "sec-proj")], content: [cBullet("std-pc1", "Published a CLI tool with 1,200+ npm downloads.", "sec-proj")], rawHeaderText: "Open-source CLI resume linter" })],
    credentials: [cred("std-cred-1", { name: tv("AWS Certified Solutions Architect", "sec-cred"), issuer: tv("Amazon Web Services", "sec-cred"), issueDateText: tv("2022", "sec-cred"), names: [tv("AWS Certified Solutions Architect", "sec-cred")], rawHeaderText: "AWS Certified Solutions Architect — Amazon Web Services" })],
  });
}

/* Fixture 4 - Experience-heavy: many jobs, long bullets, no projects,
   no awards. */
export function buildExperienceHeavyFixture(): ResumeStructuredModel {
  const employers = ["Falcon Freight Ltd.", "Cascade Manufacturing", "Union Retail Group", "Beacon Consulting", "Ironclad Logistics", "Prairie Foods Inc.", "Silverline Contractors", "Harbor Point Shipping"];
  const experiences = employers.map((employer, i) =>
    exp(`eh-exp-${i}`, {
      organization: tv(employer, "sec-exp"),
      role: tv(i === 0 ? "Operations Supervisor" : "Operations Associate", "sec-exp"),
      dateRangeText: tv(`${2008 + i * 2} – ${2010 + i * 2}`, "sec-exp"),
      bullets: [
        b(`eh-b${i}-1`, `Coordinated daily operations across a team of ${10 + i} staff while maintaining a 99% on-time delivery record for ${employer}'s regional distribution network spanning multiple provinces.`),
        b(`eh-b${i}-2`, `Implemented a new scheduling process that reduced overtime costs by ${5 + i}% within the first two quarters of adoption.`),
      ],
      content: [cBullet(`eh-c${i}-1`, `Coordinated daily operations across a team of ${10 + i} staff while maintaining a 99% on-time delivery record for ${employer}'s regional distribution network spanning multiple provinces.`), cBullet(`eh-c${i}-2`, `Implemented a new scheduling process that reduced overtime costs by ${5 + i}% within the first two quarters of adoption.`)],
      rawHeaderText: `Operations Associate — ${employer}`,
    })
  );
  return base({
    identity: { fullName: tv("Diane Okafor", "sec-identity"), headline: tv("Operations Professional", "sec-identity"), email: tv("diane.okafor@example.com", "sec-identity"), phone: tv("+1 (204) 555-0199", "sec-identity"), location: tv("Winnipeg, MB", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "20-year operations career spanning logistics, manufacturing, and retail distribution.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Operations", ["Scheduling", "Inventory Control", "Team Leadership"])],
    professionalExperience: experiences,
    education: [edu("eh-edu-1", { institution: tv("Red River College", "sec-edu"), credential: tv("Diploma, Business Administration", "sec-edu"), institutions: [tv("Red River College", "sec-edu")], rawHeaderText: "Diploma, Business Administration — Red River College" })],
  });
}

/* Fixture 5 - Education-heavy: multiple degrees, honors/details,
   credentials, minimal experience. */
export function buildEducationHeavyFixture(): ResumeStructuredModel {
  return base({
    identity: { fullName: tv("Elena Vasquez", "sec-identity"), headline: tv("Doctoral Candidate, Biochemistry", "sec-identity"), email: tv("elena.vasquez@example.com", "sec-identity"), phone: tv("+1 (613) 555-0142", "sec-identity"), location: tv("Ottawa, ON", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "Biochemistry researcher with a strong academic record and 1 year of lab teaching experience.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Lab Skills", ["Chromatography", "PCR", "Spectroscopy"])],
    professionalExperience: [exp("edh-exp-1", { organization: tv("Carleton University", "sec-exp"), role: tv("Teaching Assistant", "sec-exp"), dateRangeText: tv("2023 – 2024", "sec-exp"), bullets: [b("edh-b1", "Led weekly lab sections for 30 undergraduate students.")], content: [cBullet("edh-c1", "Led weekly lab sections for 30 undergraduate students.")], rawHeaderText: "Teaching Assistant — Carleton University" })],
    education: [
      edu("edh-edu-1", { institution: tv("University of Ottawa", "sec-edu"), credential: tv("PhD, Biochemistry (In Progress)", "sec-edu"), dateRangeText: tv("2022 – Present", "sec-edu"), institutions: [tv("University of Ottawa", "sec-edu")], honors: [tv("Dean's Research Fellowship", "sec-edu")], details: [tv("Dissertation: Enzymatic pathways in cold-adapted organisms.", "sec-edu")], rawHeaderText: "PhD, Biochemistry (In Progress) — University of Ottawa" }),
      edu("edh-edu-2", { institution: tv("McGill University", "sec-edu"), credential: tv("MSc, Biochemistry", "sec-edu"), dateRangeText: tv("2020 – 2022", "sec-edu"), institutions: [tv("McGill University", "sec-edu")], honors: [tv("Summa Cum Laude", "sec-edu")], rawHeaderText: "MSc, Biochemistry — McGill University" }),
      edu("edh-edu-3", { institution: tv("Queen's University", "sec-edu"), credential: tv("BSc (Honours), Chemistry", "sec-edu"), dateRangeText: tv("2016 – 2020", "sec-edu"), institutions: [tv("Queen's University", "sec-edu")], gpa: tv("3.9 / 4.0", "sec-edu"), details: [tv("Minor in Mathematics", "sec-edu")], rawHeaderText: "BSc (Honours), Chemistry — Queen's University" }),
    ],
    credentials: [
      cred("edh-cred-1", { name: tv("Certified Laboratory Safety Officer", "sec-cred"), issuer: tv("CSSE", "sec-cred"), names: [tv("Certified Laboratory Safety Officer", "sec-cred")], rawHeaderText: "Certified Laboratory Safety Officer — CSSE" }),
      cred("edh-cred-2", { name: tv("First Aid & CPR", "sec-cred"), issuer: tv("Canadian Red Cross", "sec-cred"), names: [tv("First Aid & CPR", "sec-cred")], rawHeaderText: "First Aid & CPR — Canadian Red Cross" }),
    ],
  });
}

/* Fixture 6 - Project-heavy: many projects, technologies, long
   descriptions. */
export function buildProjectHeavyFixture(): ResumeStructuredModel {
  const projectNames = ["Route Optimizer", "Inventory Sync Service", "Team Availability Bot", "Expense Report Parser", "Static Site Generator", "Offline-first Notes App"];
  const projects = projectNames.map((name, i) =>
    proj(`ph-proj-${i}`, {
      name: tv(name, "sec-proj"),
      technologies: [tv("TypeScript", "sec-proj"), tv(i % 2 === 0 ? "React" : "Vue", "sec-proj"), tv("PostgreSQL", "sec-proj")],
      dateRangeText: tv(`${2021 + i}`, "sec-proj"),
      bullets: [b(`ph-pb${i}`, `Designed and shipped ${name.toLowerCase()}, a side project exploring ${i % 2 === 0 ? "event-driven architecture" : "offline-first data sync"} used by a small group of beta testers.`, "sec-proj")],
      content: [cBullet(`ph-pc${i}`, `Designed and shipped ${name.toLowerCase()}, a side project exploring ${i % 2 === 0 ? "event-driven architecture" : "offline-first data sync"} used by a small group of beta testers.`, "sec-proj")],
      rawHeaderText: name,
    })
  );
  return base({
    identity: { fullName: tv("Tomasz Wachowski", "sec-identity"), headline: tv("Independent Software Developer", "sec-identity"), email: tv("tomasz.wachowski@example.com", "sec-identity"), phone: tv("+1 (587) 555-0166", "sec-identity"), location: tv("Calgary, AB", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "Independent developer with a portfolio of shipped side projects spanning web and mobile.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Languages", ["TypeScript", "Dart", "SQL"])],
    professionalExperience: [exp("ph-exp-1", { organization: tv("Freelance", "sec-exp"), role: tv("Independent Contractor", "sec-exp"), dateRangeText: tv("2021 – Present", "sec-exp"), bullets: [b("ph-b1", "Delivered 6 client web applications on a contract basis.")], content: [cBullet("ph-c1", "Delivered 6 client web applications on a contract basis.")], rawHeaderText: "Independent Contractor — Freelance" })],
    education: [edu("ph-edu-1", { institution: tv("Mount Royal University", "sec-edu"), credential: tv("Diploma, Software Development", "sec-edu"), institutions: [tv("Mount Royal University", "sec-edu")], rawHeaderText: "Diploma, Software Development — Mount Royal University" })],
    projects,
  });
}

/* Fixture 7 - Sparse: only meaningful experience + skills, every
   optional section intentionally empty. */
export function buildSparseFixture(): ResumeStructuredModel {
  return base({
    identity: { fullName: tv("Casey Whitfield", "sec-identity"), email: tv("casey.whitfield@example.com", "sec-identity"), otherContactLines: [] },
    skillGroups: [skillGroup(undefined, ["Customer Service", "Point of Sale Systems"])],
    professionalExperience: [exp("sp-exp-1", { organization: tv("Corner Market Grocers", "sec-exp"), role: tv("Cashier", "sec-exp"), dateRangeText: tv("2023 – Present", "sec-exp"), bullets: [b("sp-b1", "Processed customer transactions accurately during high-volume shifts.")], content: [cBullet("sp-c1", "Processed customer transactions accurately during high-volume shifts.")], rawHeaderText: "Cashier — Corner Market Grocers" })],
  });
}

/* Fixture 8 - Long strings: long employer/title/degree/project/cert
   names, long URL/email. */
export function buildLongStringsFixture(): ResumeStructuredModel {
  const longEmployer = "The International Consortium for Advanced Renewable Energy Systems Integration and Grid Modernization Research";
  const longTitle = "Senior Principal Cross-Functional Program Manager, Global Renewable Energy Grid Modernization Initiatives";
  const longDegree = "Master of Applied Science in Sustainable Energy Systems Engineering and Environmental Policy Analysis";
  const longProject = "Multi-Region Distributed Energy Resource Forecasting and Load-Balancing Simulation Platform";
  const longCert = "Certified International Project Management Professional in Renewable Energy Infrastructure Development";
  const longUrl = "https://portfolio.example.com/case-studies/2026/grid-modernization-initiative-full-technical-writeup-and-appendices/index.html";
  return base({
    identity: {
      fullName: tv("Alexandra Constantinou-Papadopoulos", "sec-identity"),
      headline: tv(longTitle, "sec-identity"),
      email: tv("alexandra.constantinou-papadopoulos.professional@example-longdomainname.com", "sec-identity"),
      phone: tv("+1 (403) 555-0188", "sec-identity"),
      location: tv("Calgary, AB", "sec-identity"),
      portfolio: tv(longUrl, "sec-identity"),
      otherContactLines: [],
    },
    professionalSummary: { text: "Program manager specializing in cross-border renewable energy grid integration projects.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Program Management", ["Stakeholder Alignment", "Regulatory Compliance"])],
    professionalExperience: [exp("ls-exp-1", { organization: tv(longEmployer, "sec-exp"), role: tv(longTitle, "sec-exp"), dateRangeText: tv("2019 – Present", "sec-exp"), bullets: [b("ls-b1", "Directed a multi-year, multi-country renewable energy grid modernization program spanning 4 provincial jurisdictions.")], content: [cBullet("ls-c1", "Directed a multi-year, multi-country renewable energy grid modernization program spanning 4 provincial jurisdictions.")], rawHeaderText: `${longTitle} — ${longEmployer}` })],
    education: [edu("ls-edu-1", { institution: tv("University of Calgary", "sec-edu"), credential: tv(longDegree, "sec-edu"), institutions: [tv("University of Calgary", "sec-edu")], rawHeaderText: `${longDegree} — University of Calgary` })],
    projects: [proj("ls-proj-1", { name: tv(longProject, "sec-proj"), rawHeaderText: longProject })],
    credentials: [cred("ls-cred-1", { name: tv(longCert, "sec-cred"), names: [tv(longCert, "sec-cred")], rawHeaderText: longCert })],
  });
}

/* Fixture 9 - Unicode / international: Korean name, accented Latin
   text, mixed Unicode punctuation. Invented person, not a real
   individual. */
export function buildUnicodeFixture(): ResumeStructuredModel {
  return base({
    identity: {
      fullName: tv("김민준 (Minjun Kim)", "sec-identity"),
      headline: tv("프로그램 코디네이터 — Program Coordinator", "sec-identity"),
      email: tv("minjun.kim@example.com", "sec-identity"),
      phone: tv("+1 (514) 555-0123", "sec-identity"),
      location: tv("Montréal, QC", "sec-identity"),
      otherContactLines: [tv("Bilingue — français / English", "sec-identity")],
    },
    professionalSummary: { text: "Coordinateur de programme with 5 years' expérience leading community engagement initiatives across Québec — “trusted by partners, community-first.”", source: trace("sec-summary") },
    skillGroups: [skillGroup("Langues", ["Français", "English", "한국어"]), skillGroup(undefined, ["Gestion de projet", "Community Outreach"])],
    professionalExperience: [
      exp("uc-exp-1", {
        organization: tv("Ville de Montréal — Bureau d'Élan Communautaire", "sec-exp"),
        role: tv("Coordinateur de programme", "sec-exp"),
        location: tv("Montréal, QC", "sec-exp"),
        dateRangeText: tv("2021 – Présent", "sec-exp"),
        bullets: [b("uc-b1", "Coordonné des ateliers bilingues pour plus de 300 résidents — un succès reconnu par la Ville."), b("uc-b2", "Managed a bilingual newsletter reaching 1,200+ subscribers — “community-first” engagement model.")],
        content: [cBullet("uc-c1", "Coordonné des ateliers bilingues pour plus de 300 résidents — un succès reconnu par la Ville."), cBullet("uc-c2", "Managed a bilingual newsletter reaching 1,200+ subscribers — “community-first” engagement model.")],
        rawHeaderText: "Coordinateur de programme — Ville de Montréal",
      }),
    ],
    education: [edu("uc-edu-1", { institution: tv("Université de Montréal", "sec-edu"), credential: tv("Baccalauréat ès arts", "sec-edu"), institutions: [tv("Université de Montréal", "sec-edu")], rawHeaderText: "Baccalauréat ès arts — Université de Montréal" })],
    customSections: [customSection("uc-custom-1", { originalHeading: "Langues", displayHeading: "Langues", paragraphs: [tv("한국어 (모국어), Français (courant), English (fluent)", "sec-custom")], content: [cParagraph("uc-cc1", "한국어 (모국어), Français (courant), English (fluent)", "sec-custom")], sourceOrder: 0 })],
  });
}

/* Fixture 10 - Dense bullets: one entry with many bullets, plus
   hierarchical continuation content. */
export function buildDenseBulletsFixture(): ResumeStructuredModel {
  const bulletTexts = Array.from({ length: 14 }, (_, i) => `Delivered initiative #${i + 1} contributing measurable improvement to program throughput.`);
  const bullets = bulletTexts.map((text, i) => b(`db-b${i}`, text));
  const content = bulletTexts.map((text, i) => cBullet(`db-c${i}`, text));
  return base({
    identity: { fullName: tv("Renata Souza", "sec-identity"), headline: tv("Program Manager", "sec-identity"), email: tv("renata.souza@example.com", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "Program manager with a dense track record of shipped initiatives.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Skills", ["Program Management", "Cross-team Coordination"])],
    professionalExperience: [
      exp("db-exp-1", {
        organization: tv("Solstice Programs Group", "sec-exp"),
        role: tv("Senior Program Manager", "sec-exp"),
        dateRangeText: tv("2018 – Present", "sec-exp"),
        bullets,
        content,
        hierarchicalContent: [
          { id: "db-h1", kind: "subheading", text: "Initiatives 1-7", depth: 0, children: bullets.slice(0, 7).map((bu) => ({ id: `${bu.id}-h`, kind: "bullet" as const, text: bu.text, depth: 1, children: [], source: trace("sec-exp") })), source: trace("sec-exp") },
          { id: "db-h2", kind: "subheading", text: "Initiatives 8-14", depth: 0, children: bullets.slice(7).map((bu) => ({ id: `${bu.id}-h`, kind: "bullet" as const, text: bu.text, depth: 1, children: [], source: trace("sec-exp") })), source: trace("sec-exp") },
        ],
        hasHierarchicalStructure: true,
        rawHeaderText: "Senior Program Manager — Solstice Programs Group",
      }),
    ],
    education: [edu("db-edu-1", { institution: tv("York University", "sec-edu"), credential: tv("BA, Public Administration", "sec-edu"), institutions: [tv("York University", "sec-edu")], rawHeaderText: "BA, Public Administration — York University" })],
  });
}

/* Fixture 11 - Volunteer + professional experience, specifically
   interleaved by date to cover the prior excessive-gap bug class
   (volunteer entries must not be mistaken for a professional
   employment gap or dropped/merged). */
export function buildVolunteerGapFixture(): ResumeStructuredModel {
  return base({
    identity: { fullName: tv("Owen Fitzgerald", "sec-identity"), headline: tv("Community Program Lead", "sec-identity"), email: tv("owen.fitzgerald@example.com", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "Nonprofit professional balancing paid program management with sustained volunteer leadership.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Skills", ["Volunteer Coordination", "Grant Writing"])],
    professionalExperience: [
      exp("vg-exp-1", { organization: tv("Riverside Community Foundation", "sec-exp"), role: tv("Program Manager", "sec-exp"), dateRangeText: tv("2022 – Present", "sec-exp"), bullets: [b("vg-b1", "Managed a $500K annual grant portfolio across 12 community partners.")], content: [cBullet("vg-c1", "Managed a $500K annual grant portfolio across 12 community partners.")], rawHeaderText: "Program Manager — Riverside Community Foundation" }),
      exp("vg-exp-2", { organization: tv("Lakeshore Youth Services", "sec-exp"), role: tv("Program Coordinator", "sec-exp"), dateRangeText: tv("2019 – 2022", "sec-exp"), bullets: [b("vg-b2", "Coordinated after-school programming for 150+ youth participants.")], content: [cBullet("vg-c2", "Coordinated after-school programming for 150+ youth participants.")], rawHeaderText: "Program Coordinator — Lakeshore Youth Services" }),
    ],
    volunteerExperience: [
      exp("vg-vol-1", { organization: tv("Habitat for Humanity (local chapter)", "sec-exp"), role: tv("Volunteer Build Lead", "sec-exp"), dateRangeText: tv("2020 – Present", "sec-exp"), bullets: [b("vg-vb1", "Led weekend volunteer build teams of 8-15 people on 6 residential projects.")], content: [cBullet("vg-vc1", "Led weekend volunteer build teams of 8-15 people on 6 residential projects.")], rawHeaderText: "Volunteer Build Lead — Habitat for Humanity (local chapter)", isVolunteer: true }),
      exp("vg-vol-2", { organization: tv("Community Food Bank", "sec-exp"), role: tv("Volunteer Shift Supervisor", "sec-exp"), dateRangeText: tv("2018 – 2020", "sec-exp"), bullets: [b("vg-vb2", "Supervised weekly volunteer shifts sorting and distributing food donations.")], content: [cBullet("vg-vc2", "Supervised weekly volunteer shifts sorting and distributing food donations.")], rawHeaderText: "Volunteer Shift Supervisor — Community Food Bank", isVolunteer: true }),
    ],
    education: [edu("vg-edu-1", { institution: tv("Dalhousie University", "sec-edu"), credential: tv("BA, Sociology", "sec-edu"), institutions: [tv("Dalhousie University", "sec-edu")], rawHeaderText: "BA, Sociology — Dalhousie University" })],
  });
}

/* Fixture 12 - Blank/noisy structured entries: a whitespace-only
   project, a blank credential, a blank education detail, and blank
   bullets mixed in with valid ones inside a real experience entry.
   Every "valid" sibling item must survive filtering; every blank one
   must be dropped (Part G). */
export function buildBlankNoisyFixture(): ResumeStructuredModel {
  return base({
    identity: { fullName: tv("Harriet Lindqvist", "sec-identity"), headline: tv("Financial Analyst", "sec-identity"), email: tv("harriet.lindqvist@example.com", "sec-identity"), otherContactLines: [] },
    professionalSummary: { text: "Financial analyst with 4 years of experience in corporate budgeting.", source: trace("sec-summary") },
    skillGroups: [skillGroup("Skills", ["Excel", "  ", "Financial Modeling"])],
    professionalExperience: [
      exp("bn-exp-1", {
        organization: tv("Meadowbrook Financial Group", "sec-exp"),
        role: tv("Financial Analyst", "sec-exp"),
        dateRangeText: tv("2021 – Present", "sec-exp"),
        bullets: [b("bn-b1", "Built the annual budgeting model used by 3 business units."), b("bn-b2", "   "), b("bn-b3", "Reduced month-end close time by 2 business days.")],
        content: [cBullet("bn-c1", "Built the annual budgeting model used by 3 business units."), cBullet("bn-c2", "   "), cBullet("bn-c3", "Reduced month-end close time by 2 business days.")],
        rawHeaderText: "Financial Analyst — Meadowbrook Financial Group",
      }),
    ],
    education: [
      edu("bn-edu-1", { institution: tv("Brock University", "sec-edu"), credential: tv("BComm, Finance", "sec-edu"), institutions: [tv("Brock University", "sec-edu")], details: [tv("   ", "sec-edu"), tv("Dean's List, 2020", "sec-edu")], rawHeaderText: "BComm, Finance — Brock University" }),
      edu("bn-edu-2", { rawHeaderText: "" }),
    ],
    credentials: [cred("bn-cred-1", {}), cred("bn-cred-2", { name: tv("CFA Level II Candidate", "sec-cred"), names: [tv("CFA Level II Candidate", "sec-cred")], rawHeaderText: "CFA Level II Candidate" })],
    projects: [proj("bn-proj-1", { name: tv("   ", "sec-proj"), rawHeaderText: "   " })],
  });
}
