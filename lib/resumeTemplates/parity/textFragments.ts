/*
  Phase 6F - template-agnostic parity engine, fragment extraction. The
  "ground truth" of what text a template's output MUST contain,
  derived purely from the shared NormalizedResume (never from a
  template's own rendered output - that would be circular). Used by
  htmlValidation.ts/pdfValidation.ts/docxValidation.ts's missing-text
  checks for all 3 new templates (Professional ATS keeps using its own
  existing, unmodified textExtraction.ts).
*/
import type { NormalizedContentItem, NormalizedResume } from "../shared/contentAdapters";

function flattenContentItems(items: NormalizedContentItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.text) out.push(item.text);
    out.push(...flattenContentItems(item.children));
  }
  return out;
}

export function expectedFragmentsForResume(resume: NormalizedResume): string[] {
  const fragments: string[] = [];
  const push = (v: string | undefined | null) => {
    if (v && v.trim().length > 0) fragments.push(v);
  };

  push(resume.identity.fullName);
  push(resume.identity.headline);
  push(resume.identity.email);
  push(resume.identity.phone);
  push(resume.identity.location);
  push(resume.identity.linkedin);
  push(resume.identity.portfolio);
  resume.identity.otherContactLines.forEach(push);
  push(resume.summary);
  for (const group of resume.skillGroups) {
    push(group.label);
    group.skills.forEach(push);
  }
  for (const entry of [...resume.professionalExperience, ...resume.volunteerExperience]) {
    push(entry.organization);
    push(entry.role);
    push(entry.location);
    push(entry.dateRangeText);
    fragments.push(...flattenContentItems(entry.items));
  }
  for (const entry of resume.education) {
    push(entry.institution);
    entry.institutions.forEach(push);
    entry.credentials.forEach(push);
    entry.fieldsOfStudy.forEach(push);
    push(entry.dateRangeText);
    push(entry.gpa);
    entry.honors.forEach(push);
    entry.details.forEach(push);
  }
  for (const entry of resume.credentials) {
    push(entry.name);
    entry.names.forEach(push);
    push(entry.issuer);
    entry.issuers.forEach(push);
    push(entry.credentialId);
    push(entry.issueDateText);
    push(entry.expiryDateText);
    entry.details.forEach(push);
  }
  for (const entry of resume.projects) {
    push(entry.name);
    push(entry.role);
    push(entry.dateRangeText);
    entry.technologies.forEach(push);
    fragments.push(...flattenContentItems(entry.items));
  }
  for (const entry of resume.awards) {
    push(entry.name);
    entry.names.forEach(push);
    push(entry.issuer);
    push(entry.dateText);
    entry.details.forEach(push);
  }
  for (const entry of resume.publications) {
    push(entry.title);
    entry.titles.forEach(push);
    entry.authors.forEach(push);
    push(entry.publisherOrVenue);
    push(entry.dateText);
    push(entry.urlOrDoi);
    entry.details.forEach(push);
  }
  for (const section of resume.customSections) {
    push(section.heading);
    fragments.push(...flattenContentItems(section.items));
  }
  for (const grid of resume.metricGrids) {
    for (const entry of grid.entries) {
      push(entry.value);
      push(entry.label);
    }
  }

  return fragments;
}
