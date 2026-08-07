/*
  Phase 6C - shared hand-authored test fixtures for mappers.test.ts/
  roundTrip.test.ts/negativeControls.test.ts. Not itself a *.test.ts
  file (no assertions here) so it is never picked up by the test runner
  directly - only imported. Every value below is written by hand, never
  generated from a mapper's own output (this round's own explicit
  instruction: "Hand-authored expected values 사용. 현재 mapper output으로
  expected 자동 생성 금지").
*/
import type { CanonicalResumeRuntime } from "../runtime/types";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeSourceDocument, createRuntimeVersion } from "../runtime/factory";
import { applyOverlay } from "../runtime/overlayRuntime";
import type { ResumeStructuredModel, SourceTrace } from "../../documentPreservation/resumeStructured/types";

export function trace(sectionId: string, blockIds: string[] = [], elementIds: string[] = []): SourceTrace {
  return { sourceSectionId: sectionId, sourceBlockIds: blockIds, sourceElementIds: elementIds };
}

export function buildFixtureResume(): ResumeStructuredModel {
  return {
    schemaVersion: "resume-structured-v1",
    source: { fileName: "jordan-lee-resume.pdf", fileType: "pdf" },
    identity: {
      fullName: { value: "JordanÉlan Lee", confidence: 0.98, extractionMethod: "explicit-label", source: trace("sec-identity", ["blk-1"]) },
      headline: { value: "Opérations Coordinator", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-identity", ["blk-2"]) },
      email: { value: "jordan.lee@example.com", confidence: 0.99, extractionMethod: "pattern-rule", source: trace("sec-identity", ["blk-3"]) },
      otherContactLines: [{ value: "Montréal, QC • +1 (514) 555-0182", confidence: 0.7, extractionMethod: "context-rule", source: trace("sec-identity", ["blk-4"]) }],
    },
    professionalSummary: {
      text: "Bilingual operations coordinator with 6+ years managing cross-functional logistics for mid-size manufacturers.",
      source: trace("sec-summary", ["blk-5"]),
    },
    skillGroups: [
      { label: "Core", skills: ["Supply Chain", "Lean Six Sigma", "SAP"], source: trace("sec-skills", ["blk-6"]) },
      { label: undefined, skills: ["Bilingüe (EN/FR)"], source: trace("sec-skills", ["blk-7"]) },
    ],
    professionalExperience: [
      {
        id: "exp-acme-ops",
        organization: { value: "Acme Manufacturing", confidence: 0.95, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-8"]) },
        role: { value: "Senior Operations Coordinator", confidence: 0.92, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-8"]) },
        location: { value: "Montréal, QC", confidence: 0.6, extractionMethod: "context-rule", source: trace("sec-exp", ["blk-8"]) },
        startDateText: { value: "Jan 2020", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-8"]) },
        endDateText: { value: "Present", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-8"]) },
        dateRangeText: { value: "Jan 2020 – Present", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-8"]) },
        bullets: [
          { id: "exp-acme-ops-b1", text: "Reduced shipment delays by 32% through carrier scorecard program.", source: trace("sec-exp", ["blk-9"]) },
          { id: "exp-acme-ops-b2", text: "Led a team of 5 planners across two warehouses.", source: trace("sec-exp", ["blk-10"]) },
        ],
        descriptionParagraphs: [],
        content: [
          { id: "exp-acme-ops-c1", kind: "bullet", text: "Reduced shipment delays by 32% through carrier scorecard program.", source: trace("sec-exp", ["blk-9"]) },
          { id: "exp-acme-ops-c2", kind: "bullet", text: "Led a team of 5 planners across two warehouses.", source: trace("sec-exp", ["blk-10"]) },
        ],
        hierarchicalContent: [
          {
            id: "exp-acme-ops-h1",
            kind: "subheading",
            text: "Warehouse Program",
            depth: 0,
            numberingLabel: "1.",
            children: [
              { id: "exp-acme-ops-h1-c1", kind: "bullet", text: "Reduced shipment delays by 32% through carrier scorecard program.", depth: 1, children: [], source: trace("sec-exp", ["blk-9"]) },
              { id: "exp-acme-ops-h1-c2", kind: "bullet", text: "Led a team of 5 planners across two warehouses.", depth: 1, children: [], source: trace("sec-exp", ["blk-10"]) },
            ],
            source: trace("sec-exp", ["blk-9"]),
          },
        ],
        hasHierarchicalStructure: true,
        rawHeaderText: "Senior Operations Coordinator — Acme Manufacturing — Montréal, QC — Jan 2020 – Present",
        source: trace("sec-exp", ["blk-8"]),
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
      {
        id: "exp-beta-analyst",
        organization: { value: "Beta Logistics", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-11"]) },
        role: { value: "Logistics Analyst", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-11"]) },
        dateRangeText: { value: "Jun 2017 – Dec 2019", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-11"]) },
        bullets: [{ id: "exp-beta-analyst-b1", text: "Built weekly KPI dashboards for regional distribution.", source: trace("sec-exp", ["blk-12"]) }],
        descriptionParagraphs: [],
        content: [{ id: "exp-beta-analyst-c1", kind: "bullet", text: "Built weekly KPI dashboards for regional distribution.", source: trace("sec-exp", ["blk-12"]) }],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Logistics Analyst — Beta Logistics — Jun 2017 – Dec 2019",
        source: trace("sec-exp", ["blk-11"]),
        isVolunteer: false,
        isUncertain: true,
        reasonCodes: ["ambiguous-date-format"],
      },
    ],
    volunteerExperience: [
      {
        id: "exp-foodbank",
        organization: { value: "Montréal Food Bank", confidence: 0.7, extractionMethod: "explicit-label", source: trace("sec-vol", ["blk-13"]) },
        role: { value: "Volunteer Coordinator", confidence: 0.7, extractionMethod: "explicit-label", source: trace("sec-vol", ["blk-13"]) },
        bullets: [{ id: "exp-foodbank-b1", text: "Organized monthly food drives.", source: trace("sec-vol", ["blk-14"]) }],
        descriptionParagraphs: [],
        content: [{ id: "exp-foodbank-c1", kind: "bullet", text: "Organized monthly food drives.", source: trace("sec-vol", ["blk-14"]) }],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Volunteer Coordinator — Montréal Food Bank",
        source: trace("sec-vol", ["blk-13"]),
        isVolunteer: true,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    education: [
      {
        id: "edu-mcgill",
        institution: { value: "McGill University", confidence: 0.95, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-15"]) },
        credential: { value: "B.Com., Operations Management", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-15"]) },
        credentials: [
          { value: "B.Com., Operations Management", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-15"]) },
          { value: "Minor in Statistics", confidence: 0.75, extractionMethod: "context-rule", source: trace("sec-edu", ["blk-15"]) },
        ],
        fieldsOfStudy: [{ value: "Operations Management", confidence: 0.8, extractionMethod: "context-rule", source: trace("sec-edu", ["blk-15"]) }],
        institutions: [{ value: "McGill University", confidence: 0.95, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-15"]) }],
        dateRangeText: { value: "2013 – 2017", confidence: 0.85, extractionMethod: "pattern-rule", source: trace("sec-edu", ["blk-15"]) },
        honors: [{ value: "Dean's List", confidence: 0.6, extractionMethod: "fallback", source: trace("sec-edu", ["blk-16"]) }],
        details: [],
        rawHeaderText: "B.Com., Operations Management — McGill University — 2013 – 2017",
        source: trace("sec-edu", ["blk-15"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    credentials: [
      {
        id: "cred-pmp",
        name: { value: "Project Management Professional (PMP)", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-17"]) },
        issuer: { value: "PMI", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-17"]) },
        issueDateText: { value: "2021", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-cred", ["blk-17"]) },
        names: [{ value: "Project Management Professional (PMP)", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-17"]) }],
        issuers: [{ value: "PMI", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-17"]) }],
        details: [],
        kind: "certification",
        rawHeaderText: "Project Management Professional (PMP) — PMI — 2021",
        source: trace("sec-cred", ["blk-17"]),
        isUncertain: false,
        reasonCodes: [],
      },
      {
        id: "cred-forklift",
        name: { value: "Forklift Operator License", confidence: 0.55, extractionMethod: "fallback", source: trace("sec-cred", ["blk-18"]) },
        names: [{ value: "Forklift Operator License", confidence: 0.55, extractionMethod: "fallback", source: trace("sec-cred", ["blk-18"]) }],
        issuers: [],
        details: [],
        kind: "license",
        rawHeaderText: "Forklift Operator License",
        source: trace("sec-cred", ["blk-18"]),
        isUncertain: true,
        reasonCodes: ["low-confidence-header"],
      },
    ],
    projects: [
      {
        id: "proj-erp",
        name: { value: "ERP Migration", confidence: 0.8, extractionMethod: "explicit-label", source: trace("sec-proj", ["blk-19"]) },
        role: { value: "Project Lead", confidence: 0.75, extractionMethod: "context-rule", source: trace("sec-proj", ["blk-19"]) },
        dateRangeText: { value: "2022", confidence: 0.7, extractionMethod: "pattern-rule", source: trace("sec-proj", ["blk-19"]) },
        technologies: [{ value: "SAP S/4HANA", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-proj", ["blk-19"]) }],
        bullets: [{ id: "proj-erp-b1", text: "Migrated legacy inventory system with zero downtime.", source: trace("sec-proj", ["blk-20"]) }],
        descriptionParagraphs: [],
        content: [{ id: "proj-erp-c1", kind: "bullet", text: "Migrated legacy inventory system with zero downtime.", source: trace("sec-proj", ["blk-20"]) }],
        rawHeaderText: "ERP Migration — Project Lead — 2022",
        source: trace("sec-proj", ["blk-19"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    awards: [
      {
        id: "award-mvp",
        name: { value: "Operations MVP 2021", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-award", ["blk-21"]) },
        issuer: { value: "Acme Manufacturing", confidence: 0.8, extractionMethod: "context-rule", source: trace("sec-award", ["blk-21"]) },
        names: [{ value: "Operations MVP 2021", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-award", ["blk-21"]) }],
        dateText: { value: "2021", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-award", ["blk-21"]) },
        details: [],
        content: [],
        rawHeaderText: "Operations MVP 2021 — Acme Manufacturing",
        source: trace("sec-award", ["blk-21"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    publications: [
      {
        id: "pub-supplychain",
        title: { value: "Resilient Supply Chains in Mid-Size Manufacturing", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-22"]) },
        titles: [{ value: "Resilient Supply Chains in Mid-Size Manufacturing", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-22"]) }],
        authors: [{ value: "J. Lee", confidence: 0.7, extractionMethod: "context-rule", source: trace("sec-pub", ["blk-22"]) }],
        publisherOrVenue: { value: "Canadian Logistics Review", confidence: 0.75, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-22"]) },
        dateText: { value: "2023", confidence: 0.7, extractionMethod: "pattern-rule", source: trace("sec-pub", ["blk-22"]) },
        urlOrDoi: {
          value: "https://example.com/journal/canadian-logistics-review/2023/vol-14/issue-3/resilient-supply-chains-mid-size-manufacturing-case-study-quebec-ontario-corridor?utm_source=index&utm_campaign=archive",
          confidence: 0.6,
          extractionMethod: "pattern-rule",
          source: trace("sec-pub", ["blk-22"]),
        },
        details: [],
        content: [],
        rawHeaderText: "Resilient Supply Chains in Mid-Size Manufacturing — Canadian Logistics Review — 2023",
        source: trace("sec-pub", ["blk-22"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    customSections: [
      {
        id: "custom-langs",
        originalHeading: "Langues",
        displayHeading: "Languages",
        paragraphs: [{ value: "Français (natif), Anglais (courant), Espagnol (intermédiaire)", confidence: 0.7, extractionMethod: "explicit-label", source: trace("sec-custom", ["blk-23"]) }],
        bullets: [],
        content: [{ id: "custom-langs-c1", kind: "paragraph", text: "Français (natif), Anglais (courant), Espagnol (intermédiaire)", source: trace("sec-custom", ["blk-23"]) }],
        sourceOrder: 0,
        source: trace("sec-custom", ["blk-23"]),
      },
    ],
    metricGrids: [
      {
        id: "metrics-1",
        entries: [
          { id: "metric-1", value: { value: "32%", confidence: 0.9, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-24"]) }, label: { value: "Delay Reduction", confidence: 0.85, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-25"]) } },
        ],
        columns: 1,
        source: trace("sec-metrics", ["blk-24"]),
      },
    ],
    slotAvailability: {
      identity: true,
      professional_summary: true,
      core_skills: true,
      professional_experience: true,
      volunteer_experience: true,
      education: true,
      certifications_licenses: true,
      projects: true,
      awards: true,
      publications: true,
      additional_information: true,
    },
    validation: {
      passed: true,
      sourceSectionCount: 12,
      representedSectionCount: 12,
      missingSectionIds: [],
      sourceBlockCount: 25,
      representedBlockCount: 25,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };
}

export function buildFixtureRuntime(): CanonicalResumeRuntime {
  const resume = buildFixtureResume();
  const sourceDocuments = [
    createRuntimeSourceDocument({ id: "doc-1", fileName: "jordan-lee-resume.pdf", fileType: "pdf", contentHash: "sha256-aaa", addedAt: "2026-01-01T00:00:00.000Z" }),
    createRuntimeSourceDocument({ id: "doc-2", fileName: "jordan-lee-resume-v2.docx", fileType: "docx", contentHash: "sha256-bbb", addedAt: "2026-01-05T00:00:00.000Z" }),
  ];
  const version = createRuntimeVersion({ id: "version-1", reason: "initial", createdAt: "2026-01-01T00:05:00.000Z" });
  const metadata = createRuntimeMetadata({ schemaVersion: resume.schemaVersion, parserVersion: "pdf-parser-v3", serializerVersion: "career-memory-runtime-v1" });
  let runtime = createCanonicalRuntime({ resume, version, sourceDocuments, metadata, overlayState: createRuntimeOverlayState() });

  const overlay = {
    schemaVersion: "resume-structured-v1",
    professionalSummaryText: "Bilingual operations leader tailored for a supply-chain director role.",
    entries: [{ entryId: "exp-acme-ops", bullets: [{ id: "exp-acme-ops-b1", text: "Cut shipment delays 32% via a new carrier scorecard program." }, { text: "Coordinated cross-border freight for the Québec–Ontario corridor." }] }],
  };
  const applied = applyOverlay(runtime, overlay);
  runtime = applied.runtime;

  return runtime;
}
