/*
  Phase 5D.3A gate test - real-fixture cross-format proof that a Mixed
  Content Block (bullet/paragraph blocks interleaved within a single
  Experience/Project/Custom-Section entry) survives in ORIGINAL ORDER
  through Phase 2's own entry.content[] AND through HTML/PDF/DOCX/Parity,
  through the SAME machinery every other fixture is gated on (never a
  bespoke check) - see f12-mixed-entry-content.{pdf,docx}
  (fixtures/scripts/generatePhase5D3ASyntheticFixtures.mts) for the 8
  distinct shapes this fixture carries.

  This is the direct regression proof for the bug Phase 5D.3A fixes:
  before this round, ExperienceLikeView/CustomSectionView (renderers.tsx),
  renderExperienceLike/renderCustomSection (docxRenderer.ts), and their
  own "expected content" extractors (textExtraction.ts,
  canonicalParityManifest.ts) all shared a bullets-XOR-paragraphs
  precedence that would have silently dropped every one of exp-1's,
  exp-3's, exp-4's, exp-5's, exp-6's paragraph blocks (bullets non-
  empty, so only the bullets side would have rendered) or exp-2's
  trailing bullet. Asserting the exact kind sequence below - not just
  "no missing text" - is what actually proves ORDER, not just presence.
  Run with `npx tsx lib/documentPreservation/professionalAtsParity/mixedContentFixtureGate.test.ts`.
*/
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../layoutAnalysis";
import { buildLosslessResumeDocument } from "../losslessSemantic/buildLosslessDocument";
import { buildStructuredResume } from "../resumeStructured/buildStructuredResume";
import { buildProfessionalAtsAssembly } from "../professionalAtsAssembly/buildProfessionalAtsAssembly";
import { buildProfessionalAtsParity } from "./buildProfessionalAtsParity";
import { buildCanonicalParityManifest } from "./canonicalParityManifest";
import { closeSharedBrowser } from "../sharedBrowser";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { EntryContentBlock } from "../resumeStructured/types";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/resumes");

/* Kind-only sequence per entry, in Experience-array order - the exact
   shape each entry in generatePhase5D3ASyntheticFixtures.mts targets. */
const EXPECTED_EXPERIENCE_KINDS: EntryContentBlock["kind"][][] = [
  ["bullet", "paragraph"], // exp-1: bullet + continuation paragraph
  ["bullet", "paragraph", "bullet"], // exp-2: bullet + paragraph + bullet
  ["paragraph", "bullet"], // exp-3: paragraph + bullet
  ["paragraph", "bullet"], // exp-4: subheading-like paragraph + bullet
  ["bullet", "paragraph"], // exp-5: wrapped bullet continuation
  ["bullet", "paragraph", "paragraph"], // exp-6: multiple continuation paragraphs
];
const EXPECTED_PROJECT_KINDS: EntryContentBlock["kind"][] = ["bullet", "paragraph"];
const EXPECTED_CUSTOM_KINDS: EntryContentBlock["kind"][] = ["paragraph", "bullet", "paragraph"];

async function main() {
  for (const file of ["lossless-synthetic/f12-mixed-entry-content.docx", "lossless-synthetic/f12-mixed-entry-content.pdf"]) {
    const format = file.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
    const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file));
    const layoutResult = await analyzeDocument("resume", format, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: file, fileType: format });
    const model = buildStructuredResume(document);

    checkTrue(`${file}: Phase 2 validator passed`, model.validation.passed, model.validation);

    check(`${file}: 6 experience entries detected`, model.professionalExperience.length, 6);
    model.professionalExperience.forEach((entry, i) => {
      const kinds = entry.content.map((c) => c.kind);
      check(`${file}: experience[${i}] content kind sequence`, kinds, EXPECTED_EXPERIENCE_KINDS[i]);
      // sourceOrder proof - the recorded index i (bulletId(...)-content-${i})
      // must itself be strictly increasing, confirming content[] preserves
      // Phase 1's own original block order rather than re-bucketing.
      const localIndices = entry.content.map((c) => Number(c.id.split("-content-").pop()));
      checkTrue(`${file}: experience[${i}] content ids strictly increasing`, localIndices.every((v, idx) => idx === 0 || v > localIndices[idx - 1]), localIndices);
    });

    check(`${file}: 1 project entry detected`, model.projects.length, 1);
    check(`${file}: project[0] content kind sequence`, model.projects[0]?.content.map((c) => c.kind), EXPECTED_PROJECT_KINDS);

    check(`${file}: 1 custom section detected`, model.customSections.length, 1);
    check(`${file}: custom[0] content kind sequence`, model.customSections[0]?.content.map((c) => c.kind), EXPECTED_CUSTOM_KINDS);

    // Award/publication - type-level consistency only (see this fixture's
    // own header comment / Phase 5D.3A's disclosed scope boundary): each
    // still carries a `content` array, mirroring its existing (unchanged)
    // details/details-shaped body 1:1, never crashing the renderer.
    check(`${file}: 1 award entry detected`, model.awards.length, 1);
    checkTrue(`${file}: award[0].content is an array (type-level field present)`, Array.isArray(model.awards[0]?.content));
    check(`${file}: 1 publication entry detected`, model.publications.length, 1);
    check(`${file}: publication[0].content mirrors details 1:1`, model.publications[0]?.content.length, model.publications[0]?.details.length);

    // --- full cross-format parity: HTML/PDF/DOCX must all render every
    // one of these mixed blocks, in order, with zero missing/invented
    // text (the actual regression proof for the fixed bug). ---
    const assembly = buildProfessionalAtsAssembly(model);
    const paperSize: PaperSize = "letter";
    const parity = await buildProfessionalAtsParity(assembly, paperSize);
    checkTrue(`${file}: cross-format parity report passed`, parity.report.passed, parity.report);
    checkTrue(`${file}: HTML format passed`, parity.report.formats.html.passed, parity.report.formats.html);
    checkTrue(`${file}: PDF format passed`, parity.report.formats.pdf.passed, parity.report.formats.pdf);
    checkTrue(`${file}: DOCX format passed`, parity.report.formats.docx.passed, parity.report.formats.docx);

    /* Every content block's own text must appear in the canonical
       manifest as a required fragment - proves the manifest (the
       parity ground truth) is actually built from content[], not
       silently dropping any mixed-kind block via a stale XOR path. */
    const manifest = buildCanonicalParityManifest(assembly, paperSize, "comfortable");
    const fragmentValues = new Set(manifest.expectedTextFragments.map((f) => f.value));
    for (const entry of model.professionalExperience) {
      for (const c of entry.content) {
        checkTrue(`${file}: manifest contains experience content "${c.text.slice(0, 30)}..."`, fragmentValues.has(c.text.trim()));
      }
    }
    for (const c of model.customSections[0]?.content ?? []) {
      checkTrue(`${file}: manifest contains custom-section content "${c.text.slice(0, 30)}..."`, fragmentValues.has(c.text.trim()));
    }
  }

  await closeSharedBrowser();
  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("mixedContentFixtureGate crashed:", error);
  process.exit(1);
});
