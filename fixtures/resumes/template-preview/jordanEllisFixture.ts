/*
  Phase 6F - the ONE PII-free synthetic CanonicalResumeRuntime fixture
  every one of the 4 new templates renders (spec section 13). Hand-
  authored, not derived from a real resume. "Jordan Ellis" /
  @example.com throughout - no real person, no real company. Covers
  every checklist item spec section 13 requires: hierarchical executive
  experience, mixed bullet/paragraph content, a double-major education
  entry, 2 credentials, a project, an award, a publication with a long
  URL, skill groups, a language-proficiency custom section (with
  accented French AND Korean text), a second custom section, and a
  4-entry metric grid.
*/
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeOverlayState, createRuntimeSourceDocument, createRuntimeVersion } from "../../../lib/careerMemory/runtime/factory";
import type { CanonicalResumeRuntime } from "../../../lib/careerMemory/runtime/types";
import type { ResumeStructuredModel, SourceTrace } from "../../../lib/documentPreservation/resumeStructured/types";

function trace(sectionId: string, blockIds: string[] = [], elementIds: string[] = []): SourceTrace {
  return { sourceSectionId: sectionId, sourceBlockIds: blockIds, sourceElementIds: elementIds };
}

export function buildJordanEllisResume(): ResumeStructuredModel {
  return {
    schemaVersion: "resume-structured-v1",
    source: { fileName: "jordan-ellis-resume.pdf", fileType: "pdf" },
    identity: {
      fullName: { value: "Jordan Ellis", confidence: 0.99, extractionMethod: "explicit-label", source: trace("sec-identity", ["blk-1"]) },
      headline: { value: "VP of Operations & Strategic Programs", confidence: 0.9, extractionMethod: "layout-rule", source: trace("sec-identity", ["blk-2"]) },
      email: { value: "jordan.ellis@example.com", confidence: 0.99, extractionMethod: "pattern-rule", source: trace("sec-identity", ["blk-3"]) },
      phone: { value: "+1 (416) 555-0134", confidence: 0.95, extractionMethod: "pattern-rule", source: trace("sec-identity", ["blk-4"]) },
      location: { value: "Toronto, ON", confidence: 0.9, extractionMethod: "context-rule", source: trace("sec-identity", ["blk-5"]) },
      linkedin: { value: "linkedin.com/in/jordanellis", confidence: 0.85, extractionMethod: "pattern-rule", source: trace("sec-identity", ["blk-6"]) },
      portfolio: { value: "jordanellis.dev", confidence: 0.7, extractionMethod: "pattern-rule", source: trace("sec-identity", ["blk-7"]) },
      otherContactLines: [{ value: "Fluently bilingual: English / Français", confidence: 0.6, extractionMethod: "context-rule", source: trace("sec-identity", ["blk-8"]) }],
    },
    professionalSummary: {
      text: "Senior operations executive with 14+ years leading multi-site manufacturing and logistics programs across Canada and Québec. Proven record scaling teams from 20 to 200+ while protecting margin through rapid growth.",
      source: trace("sec-summary", ["blk-9"]),
    },
    skillGroups: [
      { label: "Leadership", skills: ["P&L Ownership", "Org Design", "M&A Integration"], source: trace("sec-skills", ["blk-10"]) },
      { label: "Operations", skills: ["Lean Six Sigma", "S&OP", "ERP Transformation (SAP S/4HANA)"], source: trace("sec-skills", ["blk-11"]) },
      { label: undefined, skills: ["Bilingue (EN/FR)"], source: trace("sec-skills", ["blk-12"]) },
    ],
    professionalExperience: [
      {
        id: "exp-northbridge-vp",
        organization: { value: "Northbridge Industries", confidence: 0.97, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-13"]) },
        role: { value: "Vice President, Operations", confidence: 0.95, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-13"]) },
        location: { value: "Toronto, ON", confidence: 0.7, extractionMethod: "context-rule", source: trace("sec-exp", ["blk-13"]) },
        startDateText: { value: "Mar 2018", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-13"]) },
        endDateText: { value: "Present", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-13"]) },
        dateRangeText: { value: "Mar 2018 – Present", confidence: 0.9, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-13"]) },
        bullets: [
          { id: "exp-nb-b1", text: "Consolidated 7 regional warehouses into 4 flagship distribution centers.", source: trace("sec-exp", ["blk-14"]) },
          { id: "exp-nb-b2", text: "Delivered $12M in annualized freight savings.", source: trace("sec-exp", ["blk-14"]) },
          { id: "exp-nb-b3", text: "Stood up a monthly Sales & Operations Planning cycle across 4 business units.", source: trace("sec-exp", ["blk-15"]) },
        ],
        descriptionParagraphs: [],
        content: [
          { id: "exp-nb-c0", kind: "subheading", text: "Network Consolidation Program", source: trace("sec-exp", ["blk-14"]) },
          { id: "exp-nb-c1", kind: "bullet", text: "Consolidated 7 regional warehouses into 4 flagship distribution centers.", source: trace("sec-exp", ["blk-14"]) },
          { id: "exp-nb-c2", kind: "bullet", text: "Delivered $12M in annualized freight savings.", source: trace("sec-exp", ["blk-14"]) },
          { id: "exp-nb-c0b", kind: "subheading", text: "S&OP Transformation", source: trace("sec-exp", ["blk-15"]) },
          { id: "exp-nb-c3", kind: "bullet", text: "Stood up a monthly Sales & Operations Planning cycle across 4 business units.", source: trace("sec-exp", ["blk-15"]) },
        ],
        hierarchicalContent: [
          {
            id: "exp-nb-h1",
            kind: "subheading",
            text: "Network Consolidation Program",
            depth: 0,
            numberingLabel: "1.",
            children: [
              { id: "exp-nb-h1-c1", kind: "bullet", text: "Consolidated 7 regional warehouses into 4 flagship distribution centers.", depth: 1, children: [], source: trace("sec-exp", ["blk-14"]) },
              { id: "exp-nb-h1-c2", kind: "bullet", text: "Delivered $12M in annualized freight savings.", depth: 1, children: [], source: trace("sec-exp", ["blk-14"]) },
            ],
            source: trace("sec-exp", ["blk-14"]),
          },
          {
            id: "exp-nb-h2",
            kind: "subheading",
            text: "S&OP Transformation",
            depth: 0,
            numberingLabel: "2.",
            children: [{ id: "exp-nb-h2-c1", kind: "bullet", text: "Stood up a monthly Sales & Operations Planning cycle across 4 business units.", depth: 1, children: [], source: trace("sec-exp", ["blk-15"]) }],
            source: trace("sec-exp", ["blk-15"]),
          },
        ],
        hasHierarchicalStructure: true,
        rawHeaderText: "Vice President, Operations — Northbridge Industries — Toronto, ON — Mar 2018 – Present",
        source: trace("sec-exp", ["blk-13"]),
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
      {
        id: "exp-meridian-director",
        organization: { value: "Meridian Manufacturing Group", confidence: 0.92, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-16"]) },
        role: { value: "Director, Supply Chain", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-16"]) },
        dateRangeText: { value: "Aug 2013 – Feb 2018", confidence: 0.85, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-16"]) },
        bullets: [{ id: "exp-md-b1", text: "Led the ERP migration from a legacy MRP system to SAP S/4HANA.", source: trace("sec-exp", ["blk-17"]) }],
        descriptionParagraphs: [{ value: "Owned end-to-end supply chain strategy for a $340M manufacturing division spanning Ontario and Québec.", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-exp", ["blk-18"]) }],
        content: [
          { id: "exp-md-c1", kind: "paragraph", text: "Owned end-to-end supply chain strategy for a $340M manufacturing division spanning Ontario and Québec.", source: trace("sec-exp", ["blk-18"]) },
          { id: "exp-md-c2", kind: "bullet", text: "Led the ERP migration from a legacy MRP system to SAP S/4HANA.", source: trace("sec-exp", ["blk-17"]) },
        ],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Director, Supply Chain — Meridian Manufacturing Group — Aug 2013 – Feb 2018",
        source: trace("sec-exp", ["blk-16"]),
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
      {
        id: "exp-atlas-manager",
        organization: { value: "Atlas Freight Co.", confidence: 0.8, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-19"]) },
        role: { value: "Operations Manager", confidence: 0.8, extractionMethod: "explicit-label", source: trace("sec-exp", ["blk-19"]) },
        dateRangeText: { value: "Jul 2010 – Jul 2013", confidence: 0.75, extractionMethod: "pattern-rule", source: trace("sec-exp", ["blk-19"]) },
        bullets: [{ id: "exp-am-b1", text: "Managed daily dispatch operations for a 60-truck regional fleet.", source: trace("sec-exp", ["blk-20"]) }],
        descriptionParagraphs: [],
        content: [{ id: "exp-am-c1", kind: "bullet", text: "Managed daily dispatch operations for a 60-truck regional fleet.", source: trace("sec-exp", ["blk-20"]) }],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Operations Manager — Atlas Freight Co. — Jul 2010 – Jul 2013",
        source: trace("sec-exp", ["blk-19"]),
        isVolunteer: false,
        isUncertain: true,
        reasonCodes: ["ambiguous-date-format"],
      },
    ],
    volunteerExperience: [
      {
        id: "exp-boardseat",
        organization: { value: "Ontario Manufacturing Council", confidence: 0.75, extractionMethod: "explicit-label", source: trace("sec-vol", ["blk-21"]) },
        role: { value: "Board Member", confidence: 0.75, extractionMethod: "explicit-label", source: trace("sec-vol", ["blk-21"]) },
        dateRangeText: { value: "2020 – Present", confidence: 0.7, extractionMethod: "pattern-rule", source: trace("sec-vol", ["blk-21"]) },
        bullets: [{ id: "exp-bs-b1", text: "Advise on workforce-development policy for mid-size manufacturers.", source: trace("sec-vol", ["blk-22"]) }],
        descriptionParagraphs: [],
        content: [{ id: "exp-bs-c1", kind: "bullet", text: "Advise on workforce-development policy for mid-size manufacturers.", source: trace("sec-vol", ["blk-22"]) }],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "Board Member — Ontario Manufacturing Council — 2020 – Present",
        source: trace("sec-vol", ["blk-21"]),
        isVolunteer: true,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    education: [
      {
        id: "edu-york",
        institution: { value: "York University", confidence: 0.93, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-23"]) },
        credential: { value: "Bachelor of Business Administration", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-23"]) },
        credentials: [{ value: "Bachelor of Business Administration", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-23"]) }],
        fieldOfStudy: { value: "Operations Management", confidence: 0.85, extractionMethod: "context-rule", source: trace("sec-edu", ["blk-23"]) },
        fieldsOfStudy: [
          { value: "Operations Management", confidence: 0.85, extractionMethod: "context-rule", source: trace("sec-edu", ["blk-23"]) },
          { value: "Economics", confidence: 0.8, extractionMethod: "context-rule", source: trace("sec-edu", ["blk-23"]) },
        ],
        institutions: [{ value: "York University", confidence: 0.93, extractionMethod: "explicit-label", source: trace("sec-edu", ["blk-23"]) }],
        dateRangeText: { value: "2004 – 2008", confidence: 0.85, extractionMethod: "pattern-rule", source: trace("sec-edu", ["blk-23"]) },
        honors: [{ value: "Summa Cum Laude", confidence: 0.6, extractionMethod: "fallback", source: trace("sec-edu", ["blk-24"]) }],
        details: [],
        rawHeaderText: "Bachelor of Business Administration — York University — 2004 – 2008",
        source: trace("sec-edu", ["blk-23"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    credentials: [
      {
        id: "cred-pmp",
        name: { value: "Project Management Professional (PMP)", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-25"]) },
        issuer: { value: "PMI", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-25"]) },
        issueDateText: { value: "2015", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-cred", ["blk-25"]) },
        names: [{ value: "Project Management Professional (PMP)", confidence: 0.9, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-25"]) }],
        issuers: [{ value: "PMI", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-25"]) }],
        details: [],
        kind: "certification",
        rawHeaderText: "Project Management Professional (PMP) — PMI — 2015",
        source: trace("sec-cred", ["blk-25"]),
        isUncertain: false,
        reasonCodes: [],
      },
      {
        id: "cred-sixsigma",
        name: { value: "Lean Six Sigma Black Belt", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-26"]) },
        issuer: { value: "ASQ", confidence: 0.8, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-26"]) },
        issueDateText: { value: "2012", confidence: 0.75, extractionMethod: "pattern-rule", source: trace("sec-cred", ["blk-26"]) },
        names: [{ value: "Lean Six Sigma Black Belt", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-26"]) }],
        issuers: [{ value: "ASQ", confidence: 0.8, extractionMethod: "explicit-label", source: trace("sec-cred", ["blk-26"]) }],
        details: [],
        kind: "certification",
        rawHeaderText: "Lean Six Sigma Black Belt — ASQ — 2012",
        source: trace("sec-cred", ["blk-26"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    projects: [
      {
        id: "proj-erp",
        name: { value: "ERP Transformation Program", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-proj", ["blk-27"]) },
        role: { value: "Executive Sponsor", confidence: 0.8, extractionMethod: "context-rule", source: trace("sec-proj", ["blk-27"]) },
        dateRangeText: { value: "2016 – 2017", confidence: 0.75, extractionMethod: "pattern-rule", source: trace("sec-proj", ["blk-27"]) },
        technologies: [],
        bullets: [{ id: "proj-erp-b1", text: "Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime.", source: trace("sec-proj", ["blk-28"]) }],
        descriptionParagraphs: [],
        content: [{ id: "proj-erp-c1", kind: "bullet", text: "Sponsored a 14-month, 4-site ERP rollout with zero unplanned downtime.", source: trace("sec-proj", ["blk-28"]) }],
        rawHeaderText: "ERP Transformation Program — Executive Sponsor — 2016 – 2017",
        source: trace("sec-proj", ["blk-27"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    awards: [
      {
        id: "award-leadership",
        name: { value: "Canadian Manufacturing Leadership Award", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-award", ["blk-29"]) },
        issuer: { value: "Canadian Manufacturers & Exporters", confidence: 0.75, extractionMethod: "context-rule", source: trace("sec-award", ["blk-29"]) },
        names: [{ value: "Canadian Manufacturing Leadership Award", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-award", ["blk-29"]) }],
        dateText: { value: "2022", confidence: 0.8, extractionMethod: "pattern-rule", source: trace("sec-award", ["blk-29"]) },
        details: [],
        content: [],
        rawHeaderText: "Canadian Manufacturing Leadership Award — Canadian Manufacturers & Exporters — 2022",
        source: trace("sec-award", ["blk-29"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    publications: [
      {
        id: "pub-resilience",
        title: { value: "Rebuilding Resilient Supply Chains Post-Disruption", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-30"]) },
        titles: [{ value: "Rebuilding Resilient Supply Chains Post-Disruption", confidence: 0.85, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-30"]) }],
        authors: [{ value: "J. Ellis", confidence: 0.7, extractionMethod: "context-rule", source: trace("sec-pub", ["blk-30"]) }],
        publisherOrVenue: { value: "Canadian Manufacturing Review", confidence: 0.75, extractionMethod: "explicit-label", source: trace("sec-pub", ["blk-30"]) },
        dateText: { value: "2023", confidence: 0.7, extractionMethod: "pattern-rule", source: trace("sec-pub", ["blk-30"]) },
        details: [],
        content: [],
        rawHeaderText: "Rebuilding Resilient Supply Chains Post-Disruption — Canadian Manufacturing Review — 2023",
        source: trace("sec-pub", ["blk-30"]),
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    customSections: [
      {
        id: "custom-languages",
        originalHeading: "Langues",
        displayHeading: "Language Proficiency",
        paragraphs: [{ value: "English (Native), Français (Courant), 한국어 (초급)", confidence: 0.7, extractionMethod: "explicit-label", source: trace("sec-custom-lang", ["blk-31"]) }],
        bullets: [],
        content: [{ id: "custom-lang-c1", kind: "paragraph", text: "English (Native), Français (Courant), 한국어 (초급)", source: trace("sec-custom-lang", ["blk-31"]) }],
        sourceOrder: 0,
        source: trace("sec-custom-lang", ["blk-31"]),
      },
      {
        id: "custom-affiliations",
        originalHeading: "Professional Affiliations",
        displayHeading: "Professional Affiliations",
        paragraphs: [],
        bullets: [
          { id: "custom-aff-b1", text: "Member, APICS (Association for Supply Chain Management)", source: trace("sec-custom-aff", ["blk-32"]) },
          { id: "custom-aff-b2", text: "Member, Institute for Supply Management", source: trace("sec-custom-aff", ["blk-33"]) },
          { id: "custom-aff-b3", text: "Published case study:", source: trace("sec-custom-aff", ["blk-42"]) },
          { id: "custom-aff-b4", text: "https://example.com/cmr/2023/v9i2/resilient-supply-chains-case-study", source: trace("sec-custom-aff", ["blk-43"]) },
        ],
        content: [
          { id: "custom-aff-c1", kind: "bullet", text: "Member, APICS (Association for Supply Chain Management)", source: trace("sec-custom-aff", ["blk-32"]) },
          { id: "custom-aff-c2", kind: "bullet", text: "Member, Institute for Supply Management", source: trace("sec-custom-aff", ["blk-33"]) },
          { id: "custom-aff-c3", kind: "bullet", text: "Published case study:", source: trace("sec-custom-aff", ["blk-34"]) },
          { id: "custom-aff-c4", kind: "bullet", text: "https://example.com/cmr/2023/v9i2/resilient-supply-chains-case-study", source: trace("sec-custom-aff", ["blk-44"]) },
        ],
        sourceOrder: 1,
        source: trace("sec-custom-aff", ["blk-32"]),
      },
    ],
    metricGrids: [
      {
        id: "metrics-executive",
        entries: [
          { id: "metric-budget", value: { value: "$180M+", confidence: 0.85, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-34"]) }, label: { value: "Annual Budget Managed", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-35"]) } },
          { id: "metric-reports", value: { value: "220", confidence: 0.85, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-36"]) }, label: { value: "Direct & Indirect Reports", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-37"]) } },
          { id: "metric-cost", value: { value: "38%", confidence: 0.85, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-38"]) }, label: { value: "Cost Reduction (3yr)", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-39"]) } },
          { id: "metric-otd", value: { value: "96%", confidence: 0.85, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-40"]) }, label: { value: "On-Time Delivery Rate", confidence: 0.8, extractionMethod: "layout-rule", source: trace("sec-metrics", ["blk-41"]) } },
        ],
        columns: 4,
        source: trace("sec-metrics", ["blk-34"]),
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
      sourceSectionCount: 13,
      representedSectionCount: 13,
      missingSectionIds: [],
      sourceBlockCount: 41,
      representedBlockCount: 41,
      missingBlockIds: [],
      duplicateBlockIds: [],
      inventedFactValues: [],
      volunteerMixedIntoProfessional: [],
      missingCustomSections: [],
      warnings: [],
    },
  };
}

export function buildJordanEllisRuntime(): CanonicalResumeRuntime {
  const resume = buildJordanEllisResume();
  const sourceDocuments = [
    createRuntimeSourceDocument({ id: "doc-jordan-1", fileName: "jordan-ellis-resume.pdf", fileType: "pdf", contentHash: "sha256-phase6f-aaa", addedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const version = createRuntimeVersion({ id: "version-jordan-1", reason: "initial", createdAt: "2026-01-01T00:05:00.000Z" });
  const metadata = createRuntimeMetadata({ schemaVersion: resume.schemaVersion, parserVersion: "pdf-parser-v3" });
  return createCanonicalRuntime({ resume, version, sourceDocuments, metadata, overlayState: createRuntimeOverlayState() });
}
