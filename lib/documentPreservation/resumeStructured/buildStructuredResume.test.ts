/*
  TASK 7 gate test - full pipeline assembly (Phase 1 -> Phase 2
  structured model) + structuredValidator against real fixtures. Run
  with `npx tsx lib/documentPreservation/resumeStructured/buildStructuredResume.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { closeSharedBrowser } from "../sharedBrowser";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "./buildStructuredResume";
import type { LosslessResumeDocument, LosslessResumeSection, SemanticContentBlock } from "../losslessSemantic/types";
import type { ResumeIdentity } from "./types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

/*
  expectIdentity defaults to true. Two fixtures (generated-table-resume.pdf,
  lossless-synthetic/f5-no-heading-document.docx) genuinely carry no
  identity-shaped block anywhere in Phase 1's own output - the first has
  no name/contact line at all (starts directly at "Professional
  Experience"), the second mentions the person's name only inside
  flowing narrative prose, never as a separable block. Asserting
  identity !== undefined for those is a test bug, not a real extraction
  gap - hasIdentitySignal() correctly finds no email/phone signal and
  Phase 1's own identityBlocks is empty, so there is nothing to extract
  without inventing it.
*/
async function runFixture(fileName: string, format: "pdf" | "docx", opts: { expectIdentity?: boolean } = {}) {
  const { expectIdentity = true } = opts;
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, fileName));
  const layoutResult = await analyzeDocument("resume", format, buffer);
  const document = buildLosslessResumeDocument(layoutResult, { fileName, fileType: format });
  const model = buildStructuredResume(document);

  checkTrue(`${fileName}: structured validation.passed`, model.validation.passed);
  check(`${fileName}: zero missing sections`, model.validation.missingSectionIds.length, 0);
  check(`${fileName}: zero missing blocks`, model.validation.missingBlockIds.length, 0);
  check(`${fileName}: zero duplicate blocks`, model.validation.duplicateBlockIds.length, 0);
  check(`${fileName}: zero invented facts`, model.validation.inventedFactValues.length, 0);
  check(`${fileName}: zero volunteer/professional mixing`, model.validation.volunteerMixedIntoProfessional.length, 0);
  check(`${fileName}: zero missing custom sections`, model.validation.missingCustomSections.length, 0);
  check(`${fileName}: identity resolved`, model.identity !== undefined, expectIdentity);

  return { document, model };
}

async function main() {
  const { model: benchAModel } = await runFixture("bench/resume-A-junior-ats.pdf", "pdf");
  checkTrue("bench-A: professionalExperience populated", benchAModel.professionalExperience.length > 0);
  checkTrue("bench-A: volunteerExperience populated separately", benchAModel.volunteerExperience.length > 0);
  checkTrue(
    "bench-A: slotAvailability correctly reflects populated slots",
    benchAModel.slotAvailability.professional_experience === true && benchAModel.slotAvailability.volunteer_experience === true
  );
  check("bench-A: no empty slot falsely marked available (publications absent)", benchAModel.slotAvailability.publications, false);

  await runFixture("bench/resume-C-mid-ats.pdf", "pdf");
  await runFixture("threepage-pdf-resume.pdf", "pdf");
  await runFixture("regtest1-regulated-nurse-resume.docx", "docx");
  await runFixture("google-docs-resume.docx", "docx");
  await runFixture("word-docx-resume.docx", "docx");
  await runFixture("generated-table-resume.pdf", "pdf", { expectIdentity: false });
  const { model: f1Model } = await runFixture("lossless-synthetic/f1-career-profile-awards-custom.docx", "docx");
  checkTrue("f1: awards populated", f1Model.awards.length > 0);
  checkTrue("f1: unknown custom heading preserved in customSections", f1Model.customSections.some((c) => c.originalHeading === "Speaking & Media Appearances"));

  const { model: f5Model } = await runFixture("lossless-synthetic/f5-no-heading-document.docx", "docx", { expectIdentity: false });
  checkTrue("f5 (no-heading document): still produces a valid model with the content preserved as custom", f5Model.customSections.length >= 1 || f5Model.identity !== undefined);

  // --- determinism (test-level, per Phase 1's own convention) ---
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, "bench/resume-C-mid-ats.pdf"));
  const layoutResult = await analyzeDocument("resume", "pdf", buffer);
  const doc = buildLosslessResumeDocument(layoutResult, { fileName: "bench/resume-C-mid-ats.pdf", fileType: "pdf" });
  const model1 = buildStructuredResume(doc);
  const model2 = buildStructuredResume(doc);
  check("determinism: repeat build yields identical professionalExperience entry ids", model1.professionalExperience.map((e) => e.id), model2.professionalExperience.map((e) => e.id));
  check("determinism: repeat build yields byte-identical validation report", model1.validation, model2.validation);

  await closeSharedBrowser();

  /* ============================================================
     Fallback identity window. Phase 1 leaves identityBlocks empty
     whenever the name itself scored as the first heading, which is
     common - so these cover what the fallback then has to do with the
     leading sections it is left with. Built as documents rather than
     PDFs so the window logic is exercised directly, without depending
     on how any particular file happens to be scored.
     ============================================================ */
  let identityBlockCounter = 0;
  const identityBlock = (text: string): SemanticContentBlock => {
    const i = identityBlockCounter++;
    return { id: `idb-${i}`, sourceElementIds: [`ide-${i}`], text, rawText: text, pageIndex: 1, sourceOrder: i, blockType: "paragraph" };
  };
  const identitySection = (index: number, normalizedType: LosslessResumeSection["normalizedType"], heading: string | null, texts: string[]): LosslessResumeSection => ({
    id: `idsec-${index}`,
    originalHeading: heading,
    normalizedHeading: heading ? heading.toLowerCase() : null,
    normalizedType,
    displayHeading: heading,
    sourceOrder: index,
    startPageIndex: 1,
    endPageIndex: 1,
    blocks: texts.map(identityBlock),
    rawText: texts.join("\n"),
    isUncertain: normalizedType === "custom",
    reasonCodes: [],
    confidence: normalizedType === "custom" ? 0.3 : 0.9,
    classificationMethod: normalizedType === "custom" ? "fallback" : "dictionary",
  });
  const identityDocument = (sections: LosslessResumeSection[]): LosslessResumeDocument => ({
    schemaVersion: "1.0.0",
    source: { fileName: "identity-window.pdf", fileType: "pdf", pageCount: 1 },
    identityBlocks: [],
    sections,
    unassignedBlocks: [],
    validation: { passed: true, sourceElementCount: 0, representedElementCount: 0, missingElementIds: [], duplicateElementIds: [], missingTextSpans: [], inventedTextSpans: [], orderViolations: [], warnings: [] },
  });

  // A header split across two leading sections - name, then title with
  // the contact line. The contact is in the SECOND section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, ["SENIOR PRODUCT MANAGER", "Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(2, "summary", "SUMMARY", ["SUMMARY", "Product leader with a decade of experience."]),
    ]));
    checkTrue("identity window: a header split across two leading sections still yields identity", model.identity !== undefined);
    check("identity window: the name is taken from the first leading section", model.identity?.fullName?.value, "ALEX CHEN");
    checkTrue("identity window: the contact from the second leading section is reached", (model.identity?.email?.value ?? "").includes("alex.chen@mail.test"));
    check("identity window: neither leading section is also emitted as custom content", model.customSections.length, 0);
    check("identity window: the first canonical section is untouched", model.professionalSummary !== undefined, true);
  }

  // The already-working shape: name and contact in ONE leading section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["DANA WHITFIELD", "Toronto, ON | 416-555-0199 | dana@mail.test"]),
      identitySection(1, "summary", "SUMMARY", ["SUMMARY", "Reliability engineer."]),
    ]));
    checkTrue("identity window: the single-section header still yields identity", model.identity !== undefined);
    check("identity window: single-section name unchanged", model.identity?.fullName?.value, "DANA WHITFIELD");
    check("identity window: single-section header is not duplicated as custom content", model.customSections.length, 0);
  }

  // No contact channel anywhere in the leading run - identity must NOT
  // be manufactured just because several unnamed sections lead.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["PROMINENT LINE"]),
      identitySection(1, "custom", null, ["SECOND PROMINENT LINE"]),
      identitySection(2, "summary", "SUMMARY", ["SUMMARY", "Some summary text."]),
    ]));
    check("identity window: no contact signal means no invented identity", model.identity, undefined);
    check("identity window: and that leading material is preserved as custom sections instead", model.customSections.length, 2);
  }

  /* ============================================================
     Identity provenance across the window. The window can span several
     leading sections, so each value has to keep the section its own
     block came from - one id for the whole window would say the name
     was found in the section the contact line sits in, and would also
     claim identity consumed sections it took nothing from. The values
     themselves must not move; only where they say they came from.
     ============================================================ */
  const identityTracedSectionIds = (identity: ResumeIdentity | undefined): string[] => {
    if (!identity) return [];
    const ids = new Set<string>();
    for (const field of Object.values(identity)) {
      const values = Array.isArray(field) ? field : field ? [field] : [];
      for (const value of values) ids.add(value.source.sourceSectionId);
    }
    return [...ids].sort();
  };

  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, ["SENIOR PRODUCT MANAGER"]),
      identitySection(2, "custom", null, ["Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(3, "summary", "SUMMARY", ["SUMMARY", "Product leader with a decade of experience."]),
    ]));
    // Unchanged content - the repair is provenance only.
    check("identity provenance: the name is still read from the first section", model.identity?.fullName?.value, "ALEX CHEN");
    check("identity provenance: the headline is still read from the second", model.identity?.headline?.value, "SENIOR PRODUCT MANAGER");
    check("identity provenance: the email is still read from the third", model.identity?.email?.value, "alex.chen@mail.test");
    check("identity provenance: the phone is still read from the third", model.identity?.phone?.value, "604-555-0134");
    // ...and every value now points back at the section it came from.
    check("identity provenance: the name traces the section it was found in", model.identity?.fullName?.source.sourceSectionId, "idsec-0");
    check("identity provenance: the headline traces its own section, not the name's", model.identity?.headline?.source.sourceSectionId, "idsec-1");
    check("identity provenance: the email traces the contact section", model.identity?.email?.source.sourceSectionId, "idsec-2");
    check("identity provenance: the phone traces the contact section", model.identity?.phone?.source.sourceSectionId, "idsec-2");
    check("identity provenance: the location traces the contact section", model.identity?.location?.source.sourceSectionId, "idsec-2");
    // Block-level provenance is untouched by the section correction.
    check("identity provenance: the name still traces its own block", model.identity?.fullName?.source.sourceBlockIds, ["idb-0"]);
    check("identity provenance: every contributing section is represented", identityTracedSectionIds(model.identity), ["idsec-0", "idsec-1", "idsec-2"]);
    check("identity provenance: and no contributing section is emitted as custom content too", model.customSections.length, 0);
    // The same thing seen through the validator: a section identity
    // speaks for has to count as covered, and one contact section
    // yielding several fields must not read as duplicate coverage.
    check("identity provenance: the validator counts every identity section as covered", model.validation.missingSectionIds, []);
    check("identity provenance: no section is left needing a custom entry", model.validation.missingCustomSections, []);
    check("identity provenance: several fields from one section do not double-count its blocks", model.validation.duplicateBlockIds, []);
    check("identity provenance: and no block is left unrepresented", model.validation.missingBlockIds, []);
    check("identity provenance: so the whole model validates", model.validation.passed, true);
  }

  // A leading section identity took nothing from is only a candidate.
  // Suppressing it would drop text that never reached identity, so it
  // stays an ordinary custom section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, [""]),
      identitySection(2, "custom", null, ["Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(3, "summary", "SUMMARY", ["SUMMARY", "Product leader with a decade of experience."]),
    ]));
    check("identity provenance: a contributing section before the gap is still traced", model.identity?.fullName?.source.sourceSectionId, "idsec-0");
    check("identity provenance: the contact section past the gap is still reached", model.identity?.email?.source.sourceSectionId, "idsec-2");
    check("identity provenance: a section identity took nothing from is not claimed", identityTracedSectionIds(model.identity), ["idsec-0", "idsec-2"]);
    check("identity provenance: that section survives as its own custom section", model.customSections.length, 1);
    check("identity provenance: and it is exactly the one identity passed over", model.customSections[0]?.source.sourceSectionId, "idsec-1");
    check("identity provenance: the passed-over section is covered by its own custom entry", model.validation.missingSectionIds, []);
    check("identity provenance: and the model with a gap in the window still validates", model.validation.passed, true);
  }


  /* ============================================================
     Resumes with no canonical section at all. The leading run has
     nothing to stop it in that case, so it used to take the whole
     document and read a real section as more contact details. Where no
     canonical boundary exists the run now stops as soon as identity is
     established - and where one DOES exist nothing changes, which the
     last case here is what pins.
     ============================================================ */

  // Header carries its own contact line, so the run ends at the header
  // and the section after it stays a section.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN", "Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(1, "custom", null, ["TRAINING", "Advanced widget certification", "Riverton Guild"]),
    ]));
    check("all-custom: identity is still recovered", model.identity?.fullName?.value, "ALEX CHEN");
    check("all-custom: from the header's own contact line", model.identity?.email?.value, "alex.chen@mail.test");
    check("all-custom: identity claims only the header section", identityTracedSectionIds(model.identity), ["idsec-0"]);
    check("all-custom: the section after it survives as a section", model.customSections.length, 1);
    check("all-custom: and it is the one identity did not take", model.customSections[0]?.source.sourceSectionId, "idsec-1");
    check("all-custom: its content never becomes contact lines", (model.identity?.otherContactLines ?? []).some((v) => v.value.includes("Advanced widget certification")), false);
    check("all-custom: nothing is left unrepresented", model.validation.missingSectionIds, []);
    checkTrue("all-custom: the model still validates", model.validation.passed);
  }

  // Name and contact split across two sections - the run must reach the
  // second, because that is where identity first becomes establishable,
  // and must still stop before the third.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, ["Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(2, "custom", null, ["TRAINING", "Advanced widget certification"]),
    ]));
    check("all-custom split header: the name comes from the first section", model.identity?.fullName?.value, "ALEX CHEN");
    check("all-custom split header: the contact from the second is reached", model.identity?.email?.value, "alex.chen@mail.test");
    check("all-custom split header: both header sections are claimed", identityTracedSectionIds(model.identity), ["idsec-0", "idsec-1"]);
    check("all-custom split header: the run stops before the third", model.customSections.length, 1);
    check("all-custom split header: which survives as a section", model.customSections[0]?.source.sourceSectionId, "idsec-2");
    checkTrue("all-custom split header: the model still validates", model.validation.passed);
  }

  // No contact anywhere - identity must not be manufactured, and every
  // section must survive exactly as before.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN"]),
      identitySection(1, "custom", null, ["TRAINING", "Advanced widget certification"]),
    ]));
    check("all-custom with no contact: no identity is invented", model.identity, undefined);
    check("all-custom with no contact: both sections are preserved", model.customSections.length, 2);
  }

  /* Load-bearing counterpart: the SAME early signal, but the document
     does have a canonical section. The run must NOT stop early here, or
     the ordinary header that puts a professional title after the
     contact line would lose it. */
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "custom", null, ["ALEX CHEN", "Vancouver, BC | 604-555-0134 | alex.chen@mail.test"]),
      identitySection(1, "custom", null, ["SENIOR PRODUCT MANAGER"]),
      identitySection(2, "summary", "SUMMARY", ["SUMMARY", "Product leader with a decade of experience."]),
    ]));
    check("canonical present: the run does not stop at the first section", identityTracedSectionIds(model.identity), ["idsec-0", "idsec-1"]);
    /* The title sits AFTER the contact line, and only the second block is
       ever a headline candidate, so it is preserved as a contact line
       rather than as the headline - what matters here is that the section
       was reached at all and that its text kept its own provenance. */
    check("canonical present: the later leading section still contributes its text", (model.identity?.otherContactLines ?? []).map((v) => v.value), ["SENIOR PRODUCT MANAGER"]);
    check("canonical present: and that text is traced to the section it came from", (model.identity?.otherContactLines ?? []).map((v) => v.source.sourceSectionId), ["idsec-1"]);
    check("canonical present: no leading section is emitted as custom content", model.customSections.length, 0);
    check("canonical present: the canonical section is untouched", model.professionalSummary !== undefined, true);
  }


  /* ============================================================
     L2 - additive inline Languages extraction. The typed entries are
     EXTRA data: every assertion below pairs a typed expectation with
     the matching proof that the original custom section is still
     there, unchanged, because that section remains what the validator
     and every downstream consumer actually reads.
     ============================================================ */

  // Inline pairs: typed entries appear AND the section is still custom.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "languages", "Languages", ["Alpha (one), Beta (two)"]),
    ]));
    check("L2 inline: typed languages are populated", model.languages.map((l) => [l.name, l.proficiency]), [["Alpha", "one"], ["Beta", "two"]]);
    check("L2 inline: the same section is STILL a custom section", model.customSections.map((c) => c.originalHeading), ["Languages"]);
    check("L2 inline: the custom section still carries the original text", model.customSections[0]?.content.map((c) => c.text), ["Alpha (one), Beta (two)"]);
    check("L2 inline: the custom section still traces the source section", model.customSections[0]?.source.sourceSectionId, "idsec-0");
    check("L2 inline: typed entries trace back to the same section", model.languages.map((l) => l.source.sourceSectionId), ["idsec-0", "idsec-0"]);
    check("L2 inline: two entries from one block share that block", model.languages.map((l) => l.source.sourceBlockIds), [["idb-0"], ["idb-0"]]);
    check("L2 inline: nothing is left unrepresented", model.validation.missingBlockIds, []);
    check("L2 inline: the custom section remains the sole coverage owner, so no duplicates", model.validation.duplicateBlockIds, []);
    checkTrue("L2 inline: the model still validates", model.validation.passed);
  }

  // Plain list across blocks - proficiency omitted, peers present.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "languages", "Languages", ["Alpha", "Beta", "Gamma", "Delta"]),
    ]));
    check("L2 plain list: one typed entry per block, in block order", model.languages.map((l) => l.name), ["Alpha", "Beta", "Gamma", "Delta"]);
    checkTrue("L2 plain list: no proficiency is invented", model.languages.every((l) => !("proficiency" in l)));
    check("L2 plain list: the custom section survives intact", model.customSections[0]?.content.map((c) => c.text), ["Alpha", "Beta", "Gamma", "Delta"]);
    checkTrue("L2 plain list: the model still validates", model.validation.passed);
  }

  // A section the grammar refuses: typed stays empty, custom unchanged.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "languages", "Languages", ["Alpha (one, Beta (two)"]),
    ]));
    check("L2 declined: no typed entries are produced", model.languages, []);
    check("L2 declined: the custom section is exactly what it always was", model.customSections.map((c) => c.originalHeading), ["Languages"]);
    check("L2 declined: with its text untouched", model.customSections[0]?.content.map((c) => c.text), ["Alpha (one, Beta (two)"]);
    checkTrue("L2 declined: the model still validates", model.validation.passed);
  }

  // A lone bare item has no peer evidence - declined, section preserved.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "languages", "Languages", ["Alpha beta gamma delta"]),
    ]));
    check("L2 lone bare: declined for want of peers", model.languages, []);
    check("L2 lone bare: the text still survives as custom content", model.customSections[0]?.content.map((c) => c.text), ["Alpha beta gamma delta"]);
  }

  // Section gating: the SAME text under a different classification is
  // never handed to the language grammar.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "skills", "SKILLS", ["Alpha (one), Beta (two)"]),
      identitySection(1, "custom", "OTHER", ["Gamma (three), Delta (four)"]),
    ]));
    check("L2 gating: a skills section produces no typed languages", model.languages, []);
    check("L2 gating: an unclassified section produces no typed languages either", model.languages.length, 0);
    checkTrue("L2 gating: skills still extracts as skills", model.skillGroups.length > 0);
    checkTrue("L2 gating: the model still validates", model.validation.passed);
  }

  // Neighbouring typed sections are untouched by the new branch.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "summary", "SUMMARY", ["A short professional summary."]),
      identitySection(1, "languages", "Languages", ["Alpha (one), Beta (two)"]),
      identitySection(2, "education", "EDUCATION", ["Bachelor of Science, Example University, 2015 - 2019"]),
    ]));
    check("L2 neighbours: languages are typed", model.languages.map((l) => l.name), ["Alpha", "Beta"]);
    checkTrue("L2 neighbours: the summary is still extracted", model.professionalSummary !== undefined);
    checkTrue("L2 neighbours: education is still extracted", model.education.length > 0);
    check("L2 neighbours: only the Languages section became custom", model.customSections.map((c) => c.originalHeading), ["Languages"]);
    checkTrue("L2 neighbours: the model still validates", model.validation.passed);
  }


  /* ============================================================
     A Skills section the extractor cannot turn into skills. It still
     hands back a group - one carrying the blocks' trace but no skill -
     and that used to count as a successful extraction, so the section
     was owned by a slot that renders nothing and its text reached no
     output at all. These cases pin the fallback, not a new reading of
     the text: the extractor's own verdict is unchanged throughout.
     ============================================================ */

  // Nothing usable came out, so the section goes where every other
  // failed typed extraction goes - and its text survives there.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "skills", "SKILLS", ["Alpha, Beta, Gamma, Delta, Epsilon."]),
    ]));
    check("skills with no usable items: no typed skill groups are kept", model.skillGroups, []);
    check("skills with no usable items: the section survives as custom", model.customSections.map((c) => c.originalHeading), ["SKILLS"]);
    check("skills with no usable items: its text survives verbatim", model.customSections[0]?.content.map((c) => c.text), ["Alpha, Beta, Gamma, Delta, Epsilon."]);
    check("skills with no usable items: traced to the section it came from", model.customSections[0]?.source.sourceSectionId, "idsec-0");
    check("skills with no usable items: nothing is left unrepresented", model.validation.missingBlockIds, []);
    check("skills with no usable items: the section is claimed exactly once", model.validation.duplicateBlockIds, []);
    check("skills with no usable items: no skill is invented", model.validation.inventedFactValues, []);
    checkTrue("skills with no usable items: the model still validates", model.validation.passed);
  }

  // The same shape a Skills section normally has still types as before.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "skills", "SKILLS", ["Alpha, Beta, Gamma"]),
    ]));
    check("ordinary skills list: still typed", model.skillGroups.flatMap((g) => g.skills), ["Alpha", "Beta", "Gamma"]);
    check("ordinary skills list: does not also become a custom section", model.customSections.length, 0);
    checkTrue("ordinary skills list: the model still validates", model.validation.passed);
  }

  // One unusable block alongside a real group must NOT send the whole
  // section to the fallback - the section did produce skills.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "skills", "SKILLS", ["Tooling: Alpha, Beta", "A trailing line the extractor reads as prose."]),
    ]));
    checkTrue("mixed skills section: real skills are still typed", model.skillGroups.some((g) => g.skills.length > 0));
    check("mixed skills section: the labelled group survives", model.skillGroups.find((g) => g.label === "Tooling")?.skills, ["Alpha", "Beta"]);
    check("mixed skills section: it does not fall back to custom", model.customSections.length, 0);
    checkTrue("mixed skills section: the model still validates", model.validation.passed);
  }

  // A section with a heading and no body at all keeps its previous
  // behaviour - the fallback already covered this and still does.
  identityBlockCounter = 0;
  {
    const model = buildStructuredResume(identityDocument([
      identitySection(0, "skills", "SKILLS", []),
      identitySection(1, "summary", "SUMMARY", ["A short professional summary."]),
    ]));
    check("empty skills section: still falls back to custom", model.customSections.map((c) => c.originalHeading), ["SKILLS"]);
    check("empty skills section: no typed groups", model.skillGroups, []);
    checkTrue("empty skills section: the model still validates", model.validation.passed);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
