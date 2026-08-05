/*
  TASK 11 - Phase-5B-specific synthetic ProfessionalAtsAssemblyDocument
  scenarios not covered by Phase 4's own syntheticScenarios.ts (which
  Phase 5B's own syntheticStress.test.ts also reuses verbatim, per
  Phase 5A's established precedent). These cover content classes that
  only matter once real OOXML text-escaping and font-fallback are in
  play: Korean (CJK run/eastAsia font), French accented Latin text, raw
  XML special characters that must survive DOCX's own escaping, a
  URL/LinkedIn-style long unbroken token, and an empty-name identity
  (filename fallback). Built with the exact same hand-authoring pattern
  as Phase 4's syntheticScenarios.ts - same real defaultBlockPolicy()
  and PROFESSIONAL_ATS_SECTION_LABELS lookups, read-only reuse, not a
  reimplementation of Phase 3's own policy.
*/
import { defaultBlockPolicy } from "../professionalAtsAssembly/breakPolicy";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type { AssemblyBlock, AssemblyBlockKind, ProfessionalAtsAssemblyDocument, ProfessionalAtsAssemblySection, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { ResumeIdentity, ResumeSummary, SkillGroup, ExperienceEntry, StructuredTextValue, StructuredBullet } from "../resumeStructured/types";

const SECTION_ORDER: ProfessionalAtsSectionKey[] = [
  "identity",
  "professional_summary",
  "core_skills",
  "professional_experience",
  "volunteer_experience",
  "education",
  "certifications_licenses",
  "projects",
  "awards",
  "publications",
  "additional_information",
];

function trace(id: string) {
  return { sourceSectionId: id, sourceBlockIds: [id], sourceElementIds: [id] };
}

function tv(value: string, id: string): StructuredTextValue {
  return { value, confidence: 0.9, extractionMethod: "pattern-rule", source: trace(id) };
}

function bullet(text: string, id: string): StructuredBullet {
  return { id, text, source: trace(id) };
}

function block(id: string, kind: AssemblyBlockKind, payload: unknown, input: { bulletCount?: number; paragraphCount?: number; detailCount?: number } = {}): AssemblyBlock {
  const policy = defaultBlockPolicy(kind, input);
  return {
    id,
    kind,
    sourceEntryId: id,
    sourceSectionIds: [id],
    sourceBlockIds: [id],
    estimatedContentUnits: 10,
    minVisibleContentUnits: 2,
    ...policy,
    priority: 1,
    isOptional: false,
    isUncertain: false,
    payload,
  };
}

function identityBlock(identity: ResumeIdentity): AssemblyBlock {
  return block("synthetic-identity", "identity", identity);
}

function makeSection(key: ProfessionalAtsSectionKey, blocks: AssemblyBlock[]): ProfessionalAtsAssemblySection {
  return {
    key,
    label: PROFESSIONAL_ATS_SECTION_LABELS[key],
    order: SECTION_ORDER.indexOf(key),
    visible: blocks.length > 0,
    visibilityReason: blocks.length > 0 ? "has-content" : "empty",
    blocks,
    keepHeadingWithFirstBlock: true,
    breakBefore: "allow",
    breakAfter: "allow",
    minBlocksToShow: 1,
    sourceSectionIds: [key],
  };
}

function assembleDocument(sectionsByKey: Partial<Record<ProfessionalAtsSectionKey, AssemblyBlock[]>>): ProfessionalAtsAssemblyDocument {
  const sections = SECTION_ORDER.map((key) => makeSection(key, sectionsByKey[key] ?? []));
  const visibleSectionKeys = sections.filter((s) => s.visible).map((s) => s.key);
  const hiddenSectionKeys = sections.filter((s) => !s.visible).map((s) => s.key);
  return {
    schemaVersion: "1.0.0",
    templateId: "professional-ats-v1",
    sourceModelVersion: "synthetic-2.0.0",
    sections,
    visibleSectionKeys,
    hiddenSectionKeys,
    defaultDensity: "comfortable",
    compactionPolicy: {
      allowedDensities: ["comfortable", "balanced", "compact", "ultra-compact"],
      canReduceSectionSpacing: true,
      canReduceEntrySpacing: true,
      canReduceBulletSpacing: true,
      canTightenSkillLayout: true,
      canTrimContent: false,
      canDropSections: false,
      canDropEntries: false,
      canDropBullets: false,
    },
    validation: {
      passed: true,
      visibleSectionKeys,
      hiddenSectionKeys,
      orderViolations: [],
      volunteerPlacementViolations: [],
      missingEntryIds: [],
      duplicateEntryIds: [],
      invalidHiddenSectionsWithBlocks: [],
      destructiveCompactionFlags: [],
      warnings: [],
    },
  };
}

function experienceEntry(id: string, role: string, org: string, bulletTexts: string[]): ExperienceEntry {
  return {
    id,
    organization: tv(org, id),
    role: tv(role, id),
    location: tv("Remote", id),
    dateRangeText: tv("2019 - Present", id),
    bullets: bulletTexts.map((t, i) => bullet(t, `${id}-b${i}`)),
    descriptionParagraphs: [],
    content: bulletTexts.map((t, i) => ({ id: `${id}-content-${i}`, kind: "bullet" as const, text: t, source: trace(id) })),
    rawHeaderText: `${role} | ${org}`,
    source: trace(id),
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  };
}

/* Scenario A: Korean identity/summary/skills/experience - exercises
   the eastAsia font fallback (Malgun Gothic) end to end, not just on
   an isolated string. */
export function koreanText(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("김민준", "identity"),
    email: tv("minjun.kim@example.com", "identity"),
    phone: tv("010-1234-5678", "identity"),
    location: tv("서울특별시 강남구", "identity"),
    otherContactLines: [],
  };
  const summary: ResumeSummary = { text: "고객 경험 개선과 데이터 기반 의사결정에 강점을 가진 프로덕트 매니저입니다.", source: trace("synthetic-kr-summary") };
  const skills: SkillGroup = { label: "기술", skills: ["제품 전략", "데이터 분석", "팀 리더십"], source: trace("synthetic-kr-skills") };
  const exp = experienceEntry("synthetic-kr-exp", "프로덕트 매니저", "한빛 테크놀로지", ["신규 결제 기능 출시로 전환율 15% 개선.", "8명 규모의 크로스펑셔널 팀 리드."]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_summary: [block("synthetic-kr-summary", "summary", summary)],
    core_skills: [block("synthetic-kr-skills", "skill-group", skills)],
    professional_experience: [block("synthetic-kr-exp", "experience-entry", exp, { bulletCount: 2 })],
  });
}

/* Scenario B: French accented Latin text - exercises the primary
   (non-CJK) font path with a broad set of diacritics (é è ê ë à â ô
   ç î ï û ù). */
export function frenchAccentedText(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Éloïse Côté-Bélanger", "identity"),
    email: tv("eloise.cote-belanger@example.com", "identity"),
    phone: tv("+1 514 555 0192", "identity"),
    location: tv("Montréal, QC", "identity"),
    otherContactLines: [],
  };
  const summary: ResumeSummary = {
    text: "Ingénieure en génie logiciel spécialisée dans les systèmes distribués et l'intégration continue.",
    source: trace("synthetic-fr-summary"),
  };
  const exp = experienceEntry("synthetic-fr-exp", "Ingénieure Principale", "Société Générale Québécoise", [
    "Amélioration de la résilience du système grâce à une architecture événementielle.",
    "Encadrement d'une équipe de développeurs juniors dans un environnement agile.",
  ]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_summary: [block("synthetic-fr-summary", "summary", summary)],
    professional_experience: [block("synthetic-fr-exp", "experience-entry", exp, { bulletCount: 2 })],
  });
}

/* Scenario C: raw XML special characters (& < > " ') inside content
   fields - must survive the docx package's own OOXML escaping so the
   generated word/document.xml stays well-formed AND the literal
   characters (not their escaped/entity form) are what a reader gets
   back on re-extraction. */
export function xmlSpecialCharacters(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Chris <Ampersand> O'Reilly & Co.", "identity"),
    email: tv("chris.oreilly@example.com", "identity"),
    phone: tv("(555) 010-3030", "identity"),
    location: tv("Austin, TX", "identity"),
    otherContactLines: [],
  };
  const summary: ResumeSummary = {
    text: `Led R&D for "Project <Alpha>" — delivered results 20% > target while managing a <$2M budget & cross-team dependencies.`,
    source: trace("synthetic-xml-summary"),
  };
  const skills: SkillGroup = { label: "Skills", skills: ["C&C++", "A/B < C/D testing", `"Lean" & Agile`], source: trace("synthetic-xml-skills") };
  const exp = experienceEntry("synthetic-xml-exp", 'Engineer, "Platform" Team', "Smith & Sons <Holdings>", [
    "Reduced latency from 200ms to <50ms for the P95 case.",
    `Owned the "core" service; on-call for >99.9% uptime SLA.`,
  ]);
  return assembleDocument({
    identity: [identityBlock(identity)],
    professional_summary: [block("synthetic-xml-summary", "summary", summary)],
    core_skills: [block("synthetic-xml-skills", "skill-group", skills)],
    professional_experience: [block("synthetic-xml-exp", "experience-entry", exp, { bulletCount: 2 })],
  });
}

/* Scenario D: a long unbroken URL/LinkedIn-style token in an
   otherContactLines entry - exercises a single very long "word" with
   no natural wrap points. */
export function urlAndLinkedIn(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Taylor Morgan", "identity"),
    email: tv("taylor.morgan@example.com", "identity"),
    phone: tv("(555) 010-4040", "identity"),
    location: tv("Remote", "identity"),
    otherContactLines: [tv("linkedin.com/in/taylor-morgan-software-engineer-full-stack-2024", "identity"), tv("https://taylor-morgan-portfolio.example.com/projects/index.html", "identity")],
  };
  return assembleDocument({
    identity: [identityBlock(identity)],
  });
}

/* Scenario E: no applicant name at all (only email/phone) - directly
   exercises buildDocxFileName's fallback path through the full
   orchestrator, not just the isolated helper. */
export function noNameFallback(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("", "identity"),
    email: tv("anonymous.applicant@example.com", "identity"),
    phone: tv("(555) 010-5050", "identity"),
    location: tv("Unknown", "identity"),
    otherContactLines: [],
  };
  return assembleDocument({
    identity: [identityBlock(identity)],
  });
}

export const ALL_MULTILINGUAL_SCENARIOS: { name: string; build: () => ProfessionalAtsAssemblyDocument }[] = [
  { name: "korean-text", build: koreanText },
  { name: "french-accented-text", build: frenchAccentedText },
  { name: "xml-special-characters", build: xmlSpecialCharacters },
  { name: "url-and-linkedin", build: urlAndLinkedIn },
  { name: "no-name-fallback", build: noNameFallback },
];
