/*
  Phase 6F - the ONE content adapter every template's HTML/DOCX
  renderer consumes, instead of each of the 8 renderer files (4
  templates x HTML/DOCX) independently doing `block.payload as
  ExperienceEntry` field selection. Converts ResumeStructuredModel's
  StructuredTextValue-wrapped fields into plain strings and its
  EntryContentBlock[]/HierarchicalContentNode[] dual representation
  into ONE normalized tree shape (NormalizedContentItem[]), so a
  template only ever has to walk one shape regardless of whether the
  source entry had detected hierarchical structure or not.

  This is a pure, read-only projection - it never drops a field ResumeStructuredModel
  populates (every top-level array/section is normalized), and it
  never invents text: every string here traces back to exactly one
  StructuredTextValue.value or EntryContentBlock.text/
  HierarchicalContentNode.text already present in the source model.
*/
import type {
  AwardEntry,
  CredentialEntry,
  CustomResumeSection,
  EducationEntry,
  EntryContentBlock,
  ExperienceEntry,
  HierarchicalContentNode,
  MetricGrid,
  ProjectEntry,
  PublicationEntry,
  ResumeStructuredModel,
  SkillGroup,
  StructuredTextValue,
} from "../../documentPreservation/resumeStructured/types";

export function textValue(v: StructuredTextValue | undefined | null): string {
  return v?.value ?? "";
}

export function textValues(values: StructuredTextValue[] | undefined | null): string[] {
  return (values ?? []).map((v) => v.value).filter((v) => v.trim().length > 0);
}

function nonBlank(s: string): boolean {
  return s.trim().length > 0;
}

export type NormalizedContentItem = {
  id: string;
  kind: "bullet" | "paragraph" | "subheading";
  text: string;
  depth: number;
  numberingLabel?: string;
  children: NormalizedContentItem[];
};

function normalizeHierarchicalNode(node: HierarchicalContentNode): NormalizedContentItem {
  return {
    id: node.id,
    kind: node.kind,
    text: node.text,
    depth: node.depth,
    numberingLabel: node.numberingLabel,
    children: node.children.map(normalizeHierarchicalNode),
  };
}

function normalizeFlatBlock(block: EntryContentBlock): NormalizedContentItem {
  return { id: block.id, kind: block.kind, text: block.text, depth: 0, children: [] };
}

/*
  A node with blank/whitespace-only text and no (recursively pruned)
  children carries nothing displayable - dropping it here is what
  keeps a blank bullet/paragraph out of every template's rendered
  output (PART D: no <li></li>, no bullet-marker-only item), without
  each of the 4 templates re-implementing the same blank check.
*/
function pruneBlankContentItems(items: NormalizedContentItem[]): NormalizedContentItem[] {
  return items
    .map((item) => ({ ...item, children: pruneBlankContentItems(item.children) }))
    .filter((item) => nonBlank(item.text) || item.children.length > 0);
}

/*
  hasHierarchicalStructure===true -> walk hierarchicalContent (already
  a tree). Otherwise -> walk content[] flat, depth 0 each - the
  documented safe default (resumeStructured/types.ts's own comment on
  HierarchicalContentNode).
*/
export function normalizeContentItems(content: EntryContentBlock[], hierarchicalContent: HierarchicalContentNode[], hasHierarchicalStructure: boolean): NormalizedContentItem[] {
  const items = hasHierarchicalStructure && hierarchicalContent.length > 0 ? hierarchicalContent.map(normalizeHierarchicalNode) : content.map(normalizeFlatBlock);
  return pruneBlankContentItems(items);
}

export type NormalizedIdentity = {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  otherContactLines: string[];
};

export type NormalizedExperienceEntry = {
  id: string;
  organization: string;
  role: string;
  location: string;
  dateRangeText: string;
  items: NormalizedContentItem[];
  hasHierarchy: boolean;
  isVolunteer: boolean;
  rawHeaderText: string;
};

export type NormalizedEducationEntry = {
  id: string;
  institution: string;
  credential: string;
  fieldOfStudy: string;
  institutions: string[];
  credentials: string[];
  fieldsOfStudy: string[];
  dateRangeText: string;
  gpa: string;
  honors: string[];
  details: string[];
  rawHeaderText: string;
};

export type NormalizedCredentialEntry = {
  id: string;
  name: string;
  names: string[];
  issuer: string;
  issuers: string[];
  credentialId: string;
  issueDateText: string;
  expiryDateText: string;
  location: string;
  details: string[];
  kind: CredentialEntry["kind"];
  rawHeaderText: string;
};

export type NormalizedProjectEntry = {
  id: string;
  name: string;
  role: string;
  dateRangeText: string;
  technologies: string[];
  items: NormalizedContentItem[];
  rawHeaderText: string;
};

export type NormalizedAwardEntry = {
  id: string;
  name: string;
  names: string[];
  issuer: string;
  dateText: string;
  details: string[];
  rawHeaderText: string;
};

export type NormalizedPublicationEntry = {
  id: string;
  title: string;
  titles: string[];
  authors: string[];
  publisherOrVenue: string;
  dateText: string;
  urlOrDoi: string;
  details: string[];
  rawHeaderText: string;
};

export type NormalizedCustomSection = {
  id: string;
  heading: string;
  items: NormalizedContentItem[];
  sourceOrder: number;
};

export type NormalizedMetricEntry = { id: string; value: string; label: string };
export type NormalizedMetricGrid = { id: string; columns: number; entries: NormalizedMetricEntry[] };

export type NormalizedSkillGroup = { label: string; skills: string[] };

export type NormalizedResume = {
  schemaVersion: string;
  identity: NormalizedIdentity;
  summary: string;
  skillGroups: NormalizedSkillGroup[];
  professionalExperience: NormalizedExperienceEntry[];
  volunteerExperience: NormalizedExperienceEntry[];
  education: NormalizedEducationEntry[];
  credentials: NormalizedCredentialEntry[];
  projects: NormalizedProjectEntry[];
  awards: NormalizedAwardEntry[];
  publications: NormalizedPublicationEntry[];
  customSections: NormalizedCustomSection[];
  metricGrids: NormalizedMetricGrid[];
};

function normalizeExperience(entry: ExperienceEntry): NormalizedExperienceEntry {
  return {
    id: entry.id,
    organization: textValue(entry.organization),
    role: textValue(entry.role),
    location: textValue(entry.location),
    dateRangeText: textValue(entry.dateRangeText),
    items: normalizeContentItems(entry.content, entry.hierarchicalContent, entry.hasHierarchicalStructure),
    hasHierarchy: entry.hasHierarchicalStructure,
    isVolunteer: entry.isVolunteer,
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizeEducation(entry: EducationEntry): NormalizedEducationEntry {
  return {
    id: entry.id,
    institution: textValue(entry.institution),
    credential: textValue(entry.credential),
    fieldOfStudy: textValue(entry.fieldOfStudy),
    institutions: textValues(entry.institutions),
    credentials: textValues(entry.credentials),
    fieldsOfStudy: textValues(entry.fieldsOfStudy),
    dateRangeText: textValue(entry.dateRangeText),
    gpa: textValue(entry.gpa),
    honors: textValues(entry.honors),
    details: textValues(entry.details),
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizeCredential(entry: CredentialEntry): NormalizedCredentialEntry {
  return {
    id: entry.id,
    name: textValue(entry.name),
    names: textValues(entry.names),
    issuer: textValue(entry.issuer),
    issuers: textValues(entry.issuers),
    credentialId: textValue(entry.credentialId),
    issueDateText: textValue(entry.issueDateText),
    expiryDateText: textValue(entry.expiryDateText),
    location: textValue(entry.location),
    details: textValues(entry.details),
    kind: entry.kind,
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizeProject(entry: ProjectEntry): NormalizedProjectEntry {
  return {
    id: entry.id,
    name: textValue(entry.name),
    role: textValue(entry.role),
    dateRangeText: textValue(entry.dateRangeText),
    technologies: textValues(entry.technologies),
    items: normalizeContentItems(entry.content, [], false),
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizeAward(entry: AwardEntry): NormalizedAwardEntry {
  return {
    id: entry.id,
    name: textValue(entry.name),
    names: textValues(entry.names),
    issuer: textValue(entry.issuer),
    dateText: textValue(entry.dateText),
    details: textValues(entry.details),
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizePublication(entry: PublicationEntry): NormalizedPublicationEntry {
  return {
    id: entry.id,
    title: textValue(entry.title),
    titles: textValues(entry.titles),
    authors: textValues(entry.authors),
    publisherOrVenue: textValue(entry.publisherOrVenue),
    dateText: textValue(entry.dateText),
    urlOrDoi: textValue(entry.urlOrDoi),
    details: textValues(entry.details),
    rawHeaderText: entry.rawHeaderText,
  };
}

function normalizeCustomSection(section: CustomResumeSection): NormalizedCustomSection {
  return {
    id: section.id,
    heading: section.displayHeading ?? section.originalHeading ?? "Additional Information",
    items: normalizeContentItems(section.content, [], false),
    sourceOrder: section.sourceOrder,
  };
}

function normalizeMetricGrid(grid: MetricGrid): NormalizedMetricGrid {
  return {
    id: grid.id,
    columns: grid.columns,
    entries: grid.entries.map((entry) => ({ id: entry.id, value: textValue(entry.value), label: textValue(entry.label) })),
  };
}

function normalizeSkillGroup(group: SkillGroup): NormalizedSkillGroup {
  return { label: group.label ?? "", skills: group.skills.filter(nonBlank) };
}

/*
  PART C - a section is never allowed to render solely because an
  entry EXISTS; it must carry at least one non-blank field. Mirrors
  documentPreservation/professionalAtsAssembly/visibilityPolicy.ts's
  own hasXEntryContent family (that file's predicates are professional-
  ats-only, over the pre-normalization ResumeStructuredModel) but
  operates over this file's own already-normalized, trim-filtered
  fields - so an entry with e.g. only whitespace in every field, or
  only blank/whitespace bullets, is dropped before any of the 3
  non-ATS templates ever sees it (professional-ats has its own,
  separate assembly pipeline and does not consume this function).
*/
function isMeaningfulExperience(e: NormalizedExperienceEntry): boolean {
  return nonBlank(e.organization) || nonBlank(e.role) || nonBlank(e.location) || nonBlank(e.dateRangeText) || e.items.length > 0;
}
function isMeaningfulEducation(e: NormalizedEducationEntry): boolean {
  return (
    nonBlank(e.institution) ||
    nonBlank(e.credential) ||
    nonBlank(e.fieldOfStudy) ||
    e.institutions.length > 0 ||
    e.credentials.length > 0 ||
    e.fieldsOfStudy.length > 0 ||
    nonBlank(e.dateRangeText) ||
    nonBlank(e.gpa) ||
    e.honors.length > 0 ||
    e.details.length > 0
  );
}
function isMeaningfulCredential(e: NormalizedCredentialEntry): boolean {
  return (
    nonBlank(e.name) ||
    e.names.length > 0 ||
    nonBlank(e.issuer) ||
    e.issuers.length > 0 ||
    nonBlank(e.credentialId) ||
    nonBlank(e.issueDateText) ||
    nonBlank(e.expiryDateText) ||
    nonBlank(e.location) ||
    e.details.length > 0
  );
}
function isMeaningfulProject(e: NormalizedProjectEntry): boolean {
  return nonBlank(e.name) || nonBlank(e.role) || nonBlank(e.dateRangeText) || e.technologies.length > 0 || e.items.length > 0;
}
function isMeaningfulAward(e: NormalizedAwardEntry): boolean {
  return nonBlank(e.name) || e.names.length > 0 || nonBlank(e.issuer) || nonBlank(e.dateText) || e.details.length > 0;
}
function isMeaningfulPublication(e: NormalizedPublicationEntry): boolean {
  return nonBlank(e.title) || e.titles.length > 0 || e.authors.length > 0 || nonBlank(e.publisherOrVenue) || nonBlank(e.dateText) || nonBlank(e.urlOrDoi) || e.details.length > 0;
}
/*
  A custom section's heading always falls back to "Additional
  Information" (see normalizeCustomSection below) so heading text
  alone can never be used to judge emptiness - only its own items
  count (PART D: "heading-only custom sections forbidden").
*/
function isMeaningfulCustomSection(s: NormalizedCustomSection): boolean {
  return s.items.length > 0;
}

export function normalizeResume(resume: ResumeStructuredModel): NormalizedResume {
  const identity = resume.identity;
  return {
    schemaVersion: resume.schemaVersion,
    identity: {
      fullName: textValue(identity?.fullName),
      headline: textValue(identity?.headline),
      email: textValue(identity?.email),
      phone: textValue(identity?.phone),
      location: textValue(identity?.location),
      linkedin: textValue(identity?.linkedin),
      portfolio: textValue(identity?.portfolio),
      otherContactLines: textValues(identity?.otherContactLines),
    },
    summary: resume.professionalSummary?.text ?? "",
    skillGroups: resume.skillGroups.map(normalizeSkillGroup).filter((g) => g.skills.length > 0),
    professionalExperience: resume.professionalExperience.map(normalizeExperience).filter(isMeaningfulExperience),
    volunteerExperience: resume.volunteerExperience.map(normalizeExperience).filter(isMeaningfulExperience),
    education: resume.education.map(normalizeEducation).filter(isMeaningfulEducation),
    credentials: resume.credentials.map(normalizeCredential).filter(isMeaningfulCredential),
    projects: resume.projects.map(normalizeProject).filter(isMeaningfulProject),
    awards: resume.awards.map(normalizeAward).filter(isMeaningfulAward),
    publications: resume.publications.map(normalizePublication).filter(isMeaningfulPublication),
    customSections: resume.customSections.map(normalizeCustomSection).filter(isMeaningfulCustomSection),
    metricGrids: resume.metricGrids.map(normalizeMetricGrid),
  };
}
