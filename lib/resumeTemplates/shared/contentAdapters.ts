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
  return (values ?? []).map((v) => v.value).filter((v) => v.length > 0);
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
  hasHierarchicalStructure===true -> walk hierarchicalContent (already
  a tree). Otherwise -> walk content[] flat, depth 0 each - the
  documented safe default (resumeStructured/types.ts's own comment on
  HierarchicalContentNode).
*/
export function normalizeContentItems(content: EntryContentBlock[], hierarchicalContent: HierarchicalContentNode[], hasHierarchicalStructure: boolean): NormalizedContentItem[] {
  if (hasHierarchicalStructure && hierarchicalContent.length > 0) {
    return hierarchicalContent.map(normalizeHierarchicalNode);
  }
  return content.map(normalizeFlatBlock);
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
  return { label: group.label ?? "", skills: group.skills };
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
    skillGroups: resume.skillGroups.map(normalizeSkillGroup),
    professionalExperience: resume.professionalExperience.map(normalizeExperience),
    volunteerExperience: resume.volunteerExperience.map(normalizeExperience),
    education: resume.education.map(normalizeEducation),
    credentials: resume.credentials.map(normalizeCredential),
    projects: resume.projects.map(normalizeProject),
    awards: resume.awards.map(normalizeAward),
    publications: resume.publications.map(normalizePublication),
    customSections: resume.customSections.map(normalizeCustomSection),
    metricGrids: resume.metricGrids.map(normalizeMetricGrid),
  };
}
