/*
  TASK 3 - Canonical Parity Manifest: the renderer-independent source
  of truth Phase 5C compares HTML/PDF/DOCX against. Built directly from
  Phase 3's ProfessionalAtsAssemblyDocument, never from any renderer's
  output - this is the whole point of the exercise (spec section 2):
  comparing HTML/PDF/DOCX only against each other would let identical
  upstream loss in all three formats pass silently.

  Per-kind fragment tagging below deliberately mirrors
  professionalAtsHtml/textExtraction.ts's own field order and
  bullets-XOR-descriptionParagraphs precedence field-by-field (not
  re-deriving new extraction rules) - canonicalParityManifest.test.ts
  cross-checks that the flattened tagged-fragment values equal
  extractPayloadFragments()'s own output exactly, for every fixture,
  so the two can never silently drift apart.
*/
import { extractPayloadFragments } from "../professionalAtsHtml/textExtraction";
import { PROFESSIONAL_ATS_SECTION_LABELS, PROFESSIONAL_ATS_SECTION_ORDER } from "../professionalAtsAssembly/sectionLabels";
import { normalizeForParity } from "./parityNormalization";
import type { AssemblyBlock, AssemblyBlockKind, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";
import type {
  ResumeIdentity,
  ResumeSummary,
  SkillGroup,
  ExperienceEntry,
  EducationEntry,
  CredentialEntry,
  ProjectEntry,
  AwardEntry,
  PublicationEntry,
  CustomResumeSection,
  MetricGrid,
} from "../resumeStructured/types";
import type { CanonicalParityEntry, CanonicalParityManifest, ParityFragment, ParityFragmentKind } from "./types";

function nonEmpty(text: string | undefined | null): string | undefined {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

type TaggedFragment = { value: string; kind: ParityFragmentKind };

/* Phase 5D.3B - mirrors textExtraction.ts's own rawHeaderFallbackFragments
   and renderers.tsx's RawHeaderFallback exactly: when an entry's own
   structured fields produced zero tagged fragments, the renderer falls
   back to showing rawHeaderText verbatim - the canonical manifest (the
   parity ground truth) must expect that same fallback text. */
function rawHeaderFallbackTagged(rawHeaderText: string): TaggedFragment[] {
  return rawHeaderText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((value) => ({ value, kind: "bullet" as const }));
}

/* Mirrors extractExperienceEntryFragments/extractProjectEntryFragments
   field order and bullets-XOR-descriptionParagraphs precedence
   exactly (see textExtraction.ts). Shared by experience/volunteer and
   project entries since both follow the identical shape. */
function tagExperienceLike(entry: ExperienceEntry | ProjectEntry): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  const org = "organization" in entry ? entry.organization : undefined;
  const orgOrName = org ?? ("name" in entry ? entry.name : undefined);
  if (nonEmpty(orgOrName?.value)) tagged.push({ value: orgOrName!.value.trim(), kind: "organization" });
  if (nonEmpty(entry.role?.value)) tagged.push({ value: entry.role!.value.trim(), kind: "role" });
  if ("location" in entry && nonEmpty(entry.location?.value)) tagged.push({ value: entry.location!.value.trim(), kind: "location" });
  if (nonEmpty(entry.dateRangeText?.value)) tagged.push({ value: entry.dateRangeText!.value.trim(), kind: "date" });
  if ("technologies" in entry) {
    for (const t of entry.technologies) {
      if (nonEmpty(t.value)) tagged.push({ value: t.value.trim(), kind: "skill" });
    }
  }
  // Phase 5D.3A - see textExtraction.ts's extractExperienceEntryFragments
  // own comment: every block in entry.content, in original order.
  for (const c of entry.content) {
    if (nonEmpty(c.text)) tagged.push({ value: c.text.trim(), kind: "bullet" });
  }
  return tagged;
}

function tagEducation(entry: EducationEntry): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  /* Phase 5D.3D - iterate the full institutions[]/credentials[]/
     fieldsOfStudy[] arrays (Double Degree/Double Major/Joint Program),
     not just the singular institution/credential/fieldOfStudy fields
     (always array[0] by construction) - otherwise a 2nd+ degree/
     institution/major never gets cross-checked by this validator at
     all, and would render correctly while silently going unverified. */
  for (const i of entry.institutions) if (nonEmpty(i.value)) tagged.push({ value: i.value.trim(), kind: "organization" });
  for (const c of entry.credentials) if (nonEmpty(c.value)) tagged.push({ value: c.value.trim(), kind: "education" });
  for (const f of entry.fieldsOfStudy) if (nonEmpty(f.value)) tagged.push({ value: f.value.trim(), kind: "education" });
  if (nonEmpty(entry.location?.value)) tagged.push({ value: entry.location!.value.trim(), kind: "location" });
  if (nonEmpty(entry.dateRangeText?.value)) tagged.push({ value: entry.dateRangeText!.value.trim(), kind: "date" });
  if (nonEmpty(entry.gpa?.value)) tagged.push({ value: entry.gpa!.value.trim(), kind: "education" });
  for (const h of entry.honors) if (nonEmpty(h.value)) tagged.push({ value: h.value.trim(), kind: "education" });
  for (const d of entry.details) if (nonEmpty(d.value)) tagged.push({ value: d.value.trim(), kind: "bullet" });
  if (tagged.length === 0) tagged.push(...rawHeaderFallbackTagged(entry.rawHeaderText));
  return tagged;
}

function tagCredential(entry: CredentialEntry): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  /* Phase 5D.3D - iterate names[]/issuers[] (multiple certificates on
     one line/window), not just the singular name/issuer fields - see
     tagEducation's own comment for why. */
  for (const n of entry.names) if (nonEmpty(n.value)) tagged.push({ value: n.value.trim(), kind: "credential" });
  for (const i of entry.issuers) if (nonEmpty(i.value)) tagged.push({ value: i.value.trim(), kind: "organization" });
  if (nonEmpty(entry.credentialId?.value)) tagged.push({ value: entry.credentialId!.value.trim(), kind: "credential" });
  if (nonEmpty(entry.issueDateText?.value)) tagged.push({ value: entry.issueDateText!.value.trim(), kind: "date" });
  if (nonEmpty(entry.expiryDateText?.value)) tagged.push({ value: entry.expiryDateText!.value.trim(), kind: "date" });
  if (nonEmpty(entry.location?.value)) tagged.push({ value: entry.location!.value.trim(), kind: "location" });
  for (const d of entry.details) if (nonEmpty(d.value)) tagged.push({ value: d.value.trim(), kind: "bullet" });
  if (tagged.length === 0) tagged.push(...rawHeaderFallbackTagged(entry.rawHeaderText));
  return tagged;
}

function tagAward(entry: AwardEntry): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  /* Phase 5D.3D - iterate names[] (multiple awards on one line), not
     just the singular name field - see tagEducation's own comment. */
  for (const n of entry.names) if (nonEmpty(n.value)) tagged.push({ value: n.value.trim(), kind: "award" });
  if (nonEmpty(entry.issuer?.value)) tagged.push({ value: entry.issuer!.value.trim(), kind: "organization" });
  if (nonEmpty(entry.dateText?.value)) tagged.push({ value: entry.dateText!.value.trim(), kind: "date" });
  for (const d of entry.details) if (nonEmpty(d.value)) tagged.push({ value: d.value.trim(), kind: "bullet" });
  if (tagged.length === 0) tagged.push(...rawHeaderFallbackTagged(entry.rawHeaderText));
  return tagged;
}

function tagPublication(entry: PublicationEntry): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  /* Phase 5D.3D - iterate titles[] (backward-compat array, currently
     always [title] - see publicationExtractor.ts's own comment on why
     same-line multi-title splitting isn't implemented this round), not
     just the singular title field - see tagEducation's own comment. */
  for (const t of entry.titles) if (nonEmpty(t.value)) tagged.push({ value: t.value.trim(), kind: "publication" });
  if (nonEmpty(entry.publisherOrVenue?.value)) tagged.push({ value: entry.publisherOrVenue!.value.trim(), kind: "organization" });
  if (nonEmpty(entry.dateText?.value)) tagged.push({ value: entry.dateText!.value.trim(), kind: "date" });
  if (nonEmpty(entry.urlOrDoi?.value)) tagged.push({ value: entry.urlOrDoi!.value.trim(), kind: "publication" });
  for (const a of entry.authors) if (nonEmpty(a.value)) tagged.push({ value: a.value.trim(), kind: "publication" });
  for (const d of entry.details) if (nonEmpty(d.value)) tagged.push({ value: d.value.trim(), kind: "bullet" });
  if (tagged.length === 0) tagged.push(...rawHeaderFallbackTagged(entry.rawHeaderText));
  return tagged;
}

function tagCustomSection(section: CustomResumeSection): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  if (nonEmpty(section.originalHeading ?? undefined)) tagged.push({ value: section.originalHeading!.trim(), kind: "custom" });
  // Phase 5D.3A - see tagExperienceLike's own comment.
  for (const c of section.content) if (nonEmpty(c.text)) tagged.push({ value: c.text.trim(), kind: "bullet" });
  return tagged;
}

/*
  Phase 5D.2B - mirrors extractMetricGridFragments' value-then-label,
  entry-order-preserving field order exactly (see textExtraction.ts).
*/
function tagMetricGrid(grid: MetricGrid): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  for (const entry of grid.entries) {
    if (nonEmpty(entry.value.value)) tagged.push({ value: entry.value.value.trim(), kind: "metric" });
    if (nonEmpty(entry.label.value)) tagged.push({ value: entry.label.value.trim(), kind: "metric" });
  }
  return tagged;
}

function tagSkillGroup(group: SkillGroup): TaggedFragment[] {
  const tagged: TaggedFragment[] = [];
  if (nonEmpty(group.label)) tagged.push({ value: group.label!.trim(), kind: "skill" });
  for (const s of group.skills) if (nonEmpty(s)) tagged.push({ value: s.trim(), kind: "skill" });
  return tagged;
}

function tagSummary(summary: ResumeSummary): TaggedFragment[] {
  return summary.text
    .split("\n\n")
    .map((p) => nonEmpty(p))
    .filter((p): p is string => p !== undefined)
    .map((value) => ({ value, kind: "summary" as const }));
}

function tagIdentity(identity: ResumeIdentity): { name?: string; headline?: string; contact: TaggedFragment[] } {
  const contact: TaggedFragment[] = [];
  for (const field of [identity.email, identity.phone, identity.location, identity.linkedin, identity.portfolio, ...identity.otherContactLines]) {
    if (nonEmpty(field?.value)) contact.push({ value: field!.value.trim(), kind: "contact" });
  }
  return { name: nonEmpty(identity.fullName?.value), headline: nonEmpty(identity.headline?.value), contact };
}

function tagBlockFragments(block: AssemblyBlock): TaggedFragment[] {
  const kind: AssemblyBlockKind = block.kind;
  switch (kind) {
    case "summary":
      return tagSummary(block.payload as ResumeSummary);
    case "skill-group":
      return tagSkillGroup(block.payload as SkillGroup);
    case "experience-entry":
    case "volunteer-entry":
      return tagExperienceLike(block.payload as ExperienceEntry);
    case "education-entry":
      return tagEducation(block.payload as EducationEntry);
    case "credential-entry":
      return tagCredential(block.payload as CredentialEntry);
    case "project-entry":
      return tagExperienceLike(block.payload as ProjectEntry);
    case "award-entry":
      return tagAward(block.payload as AwardEntry);
    case "publication-entry":
      return tagPublication(block.payload as PublicationEntry);
    case "custom-section":
      return tagCustomSection(block.payload as CustomResumeSection);
    case "metric-grid":
      return tagMetricGrid(block.payload as MetricGrid);
    default:
      return [];
  }
}

function findFirst(tagged: TaggedFragment[], targetKind: ParityFragmentKind): string | undefined {
  return tagged.find((t) => t.kind === targetKind)?.value;
}

export function buildCanonicalParityManifest(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize,
  density: AssemblyDensity
): CanonicalParityManifest {
  const visibleSections = assembly.sections
    .filter((s) => s.visible)
    .map((s) => ({ key: s.key, label: PROFESSIONAL_ATS_SECTION_LABELS[s.key], order: PROFESSIONAL_ATS_SECTION_ORDER.indexOf(s.key) }));
  const hiddenSections = assembly.sections.filter((s) => !s.visible).map((s) => s.key);

  const entries: CanonicalParityEntry[] = [];
  const expectedTextFragments: ParityFragment[] = [];
  let identityName: string | undefined;
  let identityHeadline: string | undefined;
  let identityContactFragments: string[] = [];

  for (const section of assembly.sections) {
    if (!section.visible) continue;

    if (section.label) {
      expectedTextFragments.push({
        id: `section-label:${section.key}`,
        kind: "section-label",
        value: section.label,
        sectionKey: section.key,
        sourceBlockIds: [],
        required: true,
        occurrence: "exactly-once",
      });
    }

    section.blocks.forEach((block, blockIndex) => {
      if (block.kind === "identity") {
        const identity = block.payload as ResumeIdentity;
        const { name, headline, contact } = tagIdentity(identity);
        identityName = name;
        identityHeadline = headline;
        identityContactFragments = contact.map((c) => c.value);
        const nameFragments: TaggedFragment[] = [];
        if (name) nameFragments.push({ value: name, kind: "identity" });
        if (headline) nameFragments.push({ value: headline, kind: "identity" });
        [...nameFragments, ...contact].forEach((frag, i) => {
          expectedTextFragments.push({
            id: `identity:${block.id}:${i}`,
            kind: frag.kind,
            value: frag.value,
            sectionKey: section.key,
            entryId: block.id,
            sourceBlockIds: block.sourceBlockIds,
            required: true,
            occurrence: "at-least-once",
          });
        });
        entries.push({
          entryId: block.id,
          sectionKey: section.key,
          order: blockIndex,
          paragraphs: [],
          bullets: [],
          sourceBlockIds: block.sourceBlockIds,
          protectedFacts: name ? [name] : [],
        });
        return;
      }

      const tagged = tagBlockFragments(block);
      tagged.forEach((frag, i) => {
        expectedTextFragments.push({
          id: `${section.key}:${block.id}:${i}`,
          kind: frag.kind,
          value: frag.value,
          sectionKey: section.key,
          entryId: block.id,
          sourceBlockIds: block.sourceBlockIds,
          required: true,
          occurrence: frag.kind === "bullet" ? "exactly-once" : "at-least-once",
        });
      });

      const protectedFacts = tagged.filter((t) => t.kind === "organization" || t.kind === "role" || t.kind === "date" || t.kind === "education" || t.kind === "credential" || t.kind === "award" || t.kind === "publication").map((t) => t.value);

      entries.push({
        entryId: block.id,
        sectionKey: section.key,
        order: blockIndex,
        organization: findFirst(tagged, "organization"),
        role: findFirst(tagged, "role"),
        location: findFirst(tagged, "location"),
        date: findFirst(tagged, "date"),
        paragraphs: tagged.filter((t) => t.kind === "summary" || t.kind === "custom").map((t) => t.value),
        bullets: tagged.filter((t) => t.kind === "bullet").map((t) => t.value),
        sourceBlockIds: block.sourceBlockIds,
        protectedFacts,
      });
    });
  }

  return {
    schemaVersion: "1.0.0",
    templateId: "professional-ats-v1",
    paperSize,
    density,
    visibleSections,
    hiddenSections,
    entries,
    identity: {
      name: identityName,
      headline: identityHeadline,
      contactFragments: identityContactFragments,
    },
    expectedTextFragments,
  };
}

/* Cross-check helper (used by canonicalParityManifest.test.ts): the
   flattened tagged-fragment values for a single block must equal
   extractPayloadFragments()'s own output exactly, proving the two
   never drift apart. Exported for the test, not used by the manifest
   builder itself. */
export function tagBlockFragmentsForTest(block: AssemblyBlock): string[] {
  return tagBlockFragments(block).map((f) => f.value);
}

export function extractPayloadFragmentsForTest(block: AssemblyBlock): string[] {
  return extractPayloadFragments(block.kind, block.payload);
}

export { normalizeForParity };
