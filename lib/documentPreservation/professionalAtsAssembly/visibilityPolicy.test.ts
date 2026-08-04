/*
  TASK 3 gate test - section visibility policy. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/visibilityPolicy.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import {
  hasIdentityContent,
  hasSummaryContent,
  hasSkillsContent,
  hasExperienceContent,
  hasEducationContent,
  hasCredentialsContent,
  hasProjectsContent,
  hasAwardsContent,
  hasPublicationsContent,
  hasCustomContent,
} from "./visibilityPolicy";
import type { SourceTrace, StructuredTextValue } from "../resumeStructured/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

const src: SourceTrace = { sourceSectionId: "s1", sourceBlockIds: ["b1"], sourceElementIds: ["e1"] };
function tv(value: string): StructuredTextValue {
  return { value, confidence: 1, extractionMethod: "pattern-rule", source: src };
}

// ==================== Identity ====================
check("identity: undefined -> hidden", hasIdentityContent(undefined), false);
check("identity: empty otherContactLines only -> hidden", hasIdentityContent({ otherContactLines: [] }), false);
check("identity: fullName present -> visible", hasIdentityContent({ fullName: tv("Jane Doe"), otherContactLines: [] }), true);
check("identity: only email present -> visible", hasIdentityContent({ email: tv("a@b.com"), otherContactLines: [] }), true);
check("identity: whitespace-only fullName -> hidden", hasIdentityContent({ fullName: tv("   "), otherContactLines: [] }), false);

// ==================== Summary ====================
check("summary: undefined -> hidden", hasSummaryContent(undefined), false);
check("summary: empty string -> hidden", hasSummaryContent({ text: "", source: src }), false);
check("summary: whitespace-only -> hidden", hasSummaryContent({ text: "   \n  ", source: src }), false);
check("summary: real text -> visible", hasSummaryContent({ text: "Experienced engineer.", source: src }), true);

// ==================== Skills ====================
check("skills: empty array -> hidden", hasSkillsContent([]), false);
check("skills: group with empty skills[] -> hidden", hasSkillsContent([{ skills: [], source: src }]), false);
check("skills: group with only whitespace skills -> hidden", hasSkillsContent([{ skills: ["  ", ""], source: src }]), false);
check("skills: one real value -> visible", hasSkillsContent([{ skills: ["Excel"], source: src }]), true);

// ==================== Experience (shared fn for professional/volunteer) ====================
const emptyExperienceEntry = {
  id: "e1",
  bullets: [],
  descriptionParagraphs: [],
  rawHeaderText: "",
  source: src,
  isVolunteer: false,
  isUncertain: true,
  reasonCodes: [],
};
check("experience: empty entries array -> hidden", hasExperienceContent([]), false);
check("experience: entry with all fields empty -> hidden", hasExperienceContent([emptyExperienceEntry]), false);
check("experience: entry with organization only -> visible", hasExperienceContent([{ ...emptyExperienceEntry, organization: tv("Acme") }]), true);
check("experience: entry with a bullet only -> visible", hasExperienceContent([{ ...emptyExperienceEntry, bullets: [{ id: "b1", text: "Did a thing.", source: src }] }]), true);
check("experience: entry with whitespace-only bullet -> hidden", hasExperienceContent([{ ...emptyExperienceEntry, bullets: [{ id: "b1", text: "   ", source: src }] }]), false);

// ==================== Education ====================
const emptyEducationEntry = { id: "e1", honors: [], details: [], rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [] };
check("education: empty entries -> hidden", hasEducationContent([]), false);
check("education: all fields empty -> hidden", hasEducationContent([emptyEducationEntry]), false);
check("education: institution present -> visible", hasEducationContent([{ ...emptyEducationEntry, institution: tv("MIT") }]), true);

// ==================== Credentials ====================
const emptyCredentialEntry = { id: "c1", details: [], kind: "unknown" as const, rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [] };
check("credentials: empty entries -> hidden", hasCredentialsContent([]), false);
check("credentials: all fields empty -> hidden", hasCredentialsContent([emptyCredentialEntry]), false);
check("credentials: name present -> visible", hasCredentialsContent([{ ...emptyCredentialEntry, name: tv("PMP") }]), true);

// ==================== Projects ====================
const emptyProjectEntry = { id: "p1", technologies: [], bullets: [], descriptionParagraphs: [], rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [] };
check("projects: empty entries -> hidden", hasProjectsContent([]), false);
check("projects: all fields empty -> hidden", hasProjectsContent([emptyProjectEntry]), false);
check("projects: name present -> visible", hasProjectsContent([{ ...emptyProjectEntry, name: tv("Tracker") }]), true);

// ==================== Awards ====================
const emptyAwardEntry = { id: "a1", details: [], rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [] };
check("awards: empty entries -> hidden", hasAwardsContent([]), false);
check("awards: all fields empty -> hidden", hasAwardsContent([emptyAwardEntry]), false);
check("awards: name present -> visible", hasAwardsContent([{ ...emptyAwardEntry, name: tv("Employee of the Year") }]), true);

// ==================== Publications ====================
const emptyPublicationEntry = { id: "pub1", authors: [], details: [], rawHeaderText: "", source: src, isUncertain: true, reasonCodes: [] };
check("publications: empty entries -> hidden", hasPublicationsContent([]), false);
check("publications: all fields empty -> hidden", hasPublicationsContent([emptyPublicationEntry]), false);
check("publications: title present -> visible", hasPublicationsContent([{ ...emptyPublicationEntry, title: tv("A Study") }]), true);

// ==================== Custom (heading-only must NOT count) ====================
const headingOnlyCustomSection = { id: "cs1", originalHeading: "Professional Experience", displayHeading: "Professional Experience", paragraphs: [], bullets: [], sourceOrder: 0, source: src };
check("custom: empty sections array -> hidden", hasCustomContent([]), false);
check("custom: heading-only (no paragraphs/bullets) -> hidden (spec-recommended)", hasCustomContent([headingOnlyCustomSection]), false);
check("custom: real paragraph present -> visible", hasCustomContent([{ ...headingOnlyCustomSection, paragraphs: [tv("Board member since 2020.")] }]), true);
check("custom: real bullet present -> visible", hasCustomContent([{ ...headingOnlyCustomSection, bullets: [{ id: "b1", text: "Volunteer mentor.", source: src }] }]), true);
check("custom: whitespace-only paragraph -> hidden", hasCustomContent([{ ...headingOnlyCustomSection, paragraphs: [tv("   ")] }]), false);

// ==================== Real-fixture cross-check: bench-B's empty-section-fallback custom section ====================
async function realFixtureCrossCheck() {
  const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "bench/resume-B-junior-canva.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName: "bench/resume-B-junior-canva.pdf", fileType: "pdf" });
  const model = buildStructuredResume(document);

  const emptyFallbackSection = model.customSections.find((s) => s.paragraphs.length === 0 && s.bullets.length === 0);
  console.log(`bench-B: found ${model.customSections.length} custom section(s); empty-fallback one present: ${emptyFallbackSection !== undefined}`);
  if (emptyFallbackSection) {
    console.log(`bench-B: its originalHeading was "${emptyFallbackSection.originalHeading}" - must NOT make the section visible on its own`);
    check("bench-B: hasCustomContent([the empty-fallback section alone]) -> hidden", hasCustomContent([emptyFallbackSection]), false);
  }
  check("bench-B: hasCustomContent(all custom sections) -> visible overall (real content exists elsewhere in the array)", hasCustomContent(model.customSections), true);

  await closeSharedBrowser();
}

realFixtureCrossCheck()
  .then(() => {
    console.log(`\n--- ${pass} passed, ${fail} failed ---`);
    if (fail > 0) process.exit(1);
  })
  .catch((error) => {
    console.error("Test run crashed:", error);
    process.exit(1);
  });
