/*
  Phase 5C.1 - Long-Token and URL Hardening. Synthetic
  ProfessionalAtsAssemblyDocument scenarios that each put ONE long,
  space-free contact token into identity.otherContactLines - the exact
  field renderers.tsx's IdentityView silently dropped before this
  phase's fix (see canonicalParityManifest.ts's own sibling files for
  the established hand-authoring pattern; helpers duplicated locally
  per this codebase's existing convention of no cross-scenario-file
  coupling for hand-built fixtures).

  Each scenario varies the SHAPE of the long token (plain URL, query
  params, percent-encoding, ampersand, no slashes at all, email-like)
  to exercise different normalization edge cases through the same
  otherContactLines -> IdentityView -> .ats-identity-contact CSS path.
  A French-accented variant guards against the CSS fix (overflow-wrap:
  anywhere) leaking into ordinary space-separated prose.
*/
import { defaultBlockPolicy } from "../professionalAtsAssembly/breakPolicy";
import { PROFESSIONAL_ATS_SECTION_LABELS } from "../professionalAtsAssembly/sectionLabels";
import type { AssemblyBlock, AssemblyBlockKind, ProfessionalAtsAssemblyDocument, ProfessionalAtsAssemblySection, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";
import type { ResumeIdentity, StructuredTextValue } from "../resumeStructured/types";

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

function assembleIdentityOnly(identity: ResumeIdentity): ProfessionalAtsAssemblyDocument {
  const sectionsByKey: Partial<Record<ProfessionalAtsSectionKey, AssemblyBlock[]>> = {
    identity: [block("synthetic-identity", "identity", identity)],
  };
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

function identityWithOtherContact(id: string, otherLine: string): ResumeIdentity {
  return {
    fullName: tv("Morgan Ellis", "identity"),
    email: tv("morgan.ellis@example.com", "identity"),
    phone: tv("(555) 010-9090", "identity"),
    location: tv("Remote", "identity"),
    otherContactLines: [tv(otherLine, id)],
  };
}

/* Scenario A: long LinkedIn-style URL, no protocol, no query params. */
export function longLinkedInUrl(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("long-linkedin", "linkedin.com/in/morgan-ellis-senior-platform-engineer-2024-canada"));
}

/* Scenario B: long portfolio URL with protocol and a deep path. */
export function longPortfolioUrl(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("long-portfolio", "https://morgan-ellis-portfolio.example.com/projects/case-studies/index.html"));
}

/* Scenario C: URL with query parameters. */
export function urlWithQueryParams(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("query-params", "https://example.com/resume?ref=linkedin&utm_source=profile&utm_campaign=2024"));
}

/* Scenario D: percent-encoded URL. */
export function percentEncodedUrl(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("percent-encoded", "https://example.com/search?q=morgan%20ellis%20portfolio%20engineer"));
}

/* Scenario E: URL containing a bare ampersand outside query-string form
   (a raw XML-unsafe character riding along inside a long unbroken
   token, not just a query separator). */
export function urlWithAmpersand(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("ampersand", "https://example.com/portfolio/design&engineering/morgan-ellis"));
}

/* Scenario F: long token with no slashes at all - a bare domain-like
   string with no natural break characters whatsoever. */
export function slashlessLongToken(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("slashless", "morganellisplatformengineeringcanadaprofile.example.com"));
}

/* Scenario G: email-like long token (not the primary identity.email
   field - a second, unusually long address routed through
   otherContactLines). */
export function emailLikeLongToken(): ProfessionalAtsAssemblyDocument {
  return assembleIdentityOnly(identityWithOtherContact("email-like", "morgan.ellis.senior.platform.engineering.canada@example-company-mail.com"));
}

/* Scenario H: French-accented prose immediately adjacent to a long URL
   in the SAME otherContactLines entry - guards against the
   overflow-wrap:anywhere CSS fix leaking into ordinary space-separated
   French text (which must still wrap only at spaces, never mid-word). */
export function frenchTextNearUrl(): ProfessionalAtsAssemblyDocument {
  const identity: ResumeIdentity = {
    fullName: tv("Élodie Bergeron-Fontaine", "identity"),
    email: tv("elodie.bergeron@example.com", "identity"),
    phone: tv("+1 514 555 0177", "identity"),
    location: tv("Québec, QC", "identity"),
    otherContactLines: [tv("Portfolio complet disponible ici: https://elodie-bergeron-portfolio.example.com/travaux/index.html", "french-url")],
  };
  return assembleIdentityOnly(identity);
}

export const ALL_LONG_TOKEN_SCENARIOS: { name: string; build: () => ProfessionalAtsAssemblyDocument }[] = [
  { name: "long-linkedin-url", build: longLinkedInUrl },
  { name: "long-portfolio-url", build: longPortfolioUrl },
  { name: "url-with-query-params", build: urlWithQueryParams },
  { name: "percent-encoded-url", build: percentEncodedUrl },
  { name: "url-with-ampersand", build: urlWithAmpersand },
  { name: "slashless-long-token", build: slashlessLongToken },
  { name: "email-like-long-token", build: emailLikeLongToken },
  { name: "french-text-near-url", build: frenchTextNearUrl },
];
