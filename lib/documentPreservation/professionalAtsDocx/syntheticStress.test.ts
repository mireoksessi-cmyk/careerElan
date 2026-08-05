/*
  TASK 11 - Synthetic/multilingual stress gate. Reuses Phase 4's own
  ALL_SYNTHETIC_SCENARIOS (long single entry, long skill group,
  volunteer-only, all-eleven-sections, custom-section-only, many short
  entries) verbatim, run through Phase 5B's own buildProfessionalAtsDocx
  directly (NOT chained through Phase 4's HTML validation - Phase 5B
  has no dependency on Phase 4, per this phase's own input contract),
  same reuse precedent as Phase 5A's own syntheticStress.test.ts. Adds
  Phase-5B-specific scenarios (Korean, French accented, XML special
  characters, URL/LinkedIn, no-name fallback) from
  ./multilingualScenarios.ts. Run with
  `npx tsx lib/documentPreservation/professionalAtsDocx/syntheticStress.test.ts`.
*/
import JSZip from "jszip";
import { buildProfessionalAtsDocx } from "./buildProfessionalAtsDocx";
import { buildDocxFileName } from "./fileName";
import { ALL_SYNTHETIC_SCENARIOS } from "../professionalAtsHtml/syntheticScenarios";
import { ALL_MULTILINGUAL_SCENARIOS } from "./multilingualScenarios";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, detail?: unknown) {
  const ok = actual === true;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `detail=${JSON.stringify(detail)}`);
  if (ok) pass++;
  else fail++;
}

async function runScenario(name: string, build: () => ProfessionalAtsAssemblyDocument, paperSize: PaperSize) {
  const assembly = build();
  const result = await buildProfessionalAtsDocx(assembly, paperSize, "comfortable");
  checkTrue(`${name}/${paperSize}: validation passed`, result.validation.passed, result.validation);
  checkTrue(`${name}/${paperSize}: no missing text`, result.validation.text.missingFragments.length === 0, result.validation.text.missingFragments);
  checkTrue(`${name}/${paperSize}: no invented text`, result.validation.text.inventedFragments.length === 0, result.validation.text.inventedFragments);
  checkTrue(`${name}/${paperSize}: structural valid`, result.validation.structural.validZipHeader && result.validation.structural.parseableZip);
  console.log(`  [${name}/${paperSize}] paragraphs=${result.structure.paragraphCount} bullets=${result.structure.bulletCount} bytes=${result.byteLength}`);
  return result;
}

async function main() {
  /* --- Phase 4's baseline synthetic scenarios, reused verbatim --- */
  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
  }
  await runScenario("veryLongSingleEntry", ALL_SYNTHETIC_SCENARIOS.find((s) => s.name === "very-long-single-entry")!.build, "a4");
  await runScenario("manyShortEntries", ALL_SYNTHETIC_SCENARIOS.find((s) => s.name === "many-short-entries")!.build, "a4");

  for (const scenario of ALL_SYNTHETIC_SCENARIOS) {
    const assembly = scenario.build();
    const result = await buildProfessionalAtsDocx(assembly, "letter", "comfortable");
    checkTrue(`${scenario.name}: fileName ends with .docx`, result.fileName.endsWith(".docx"));
    checkTrue(`${scenario.name}: fileName has no path separators`, !result.fileName.includes("/") && !result.fileName.includes("\\"));
  }
  checkTrue("fallback filename helper (empty name) still produces valid .docx name", buildDocxFileName(null, "letter", "professional-ats-v1").endsWith(".docx"));

  /* --- Phase 5B-specific multilingual/stress scenarios --- */
  for (const scenario of ALL_MULTILINGUAL_SCENARIOS) {
    await runScenario(scenario.name, scenario.build, "letter");
    await runScenario(scenario.name, scenario.build, "a4");
  }

  /* --- Direct raw-XML escaping check for the special-characters
     scenario. A round-trip through mammoth's re-extraction (already
     exercised above via missingFragments/inventedFragments) cannot by
     itself distinguish "correctly escaped" from "mis-escaped in a way
     mammoth happens to also mis-decode the same way" - so this reads
     the generated word/document.xml bytes directly, independent of
     mammoth, and confirms: (a) the raw part actually contains the
     escaped entity forms (proving escaping happened, not silent
     stripping), and (b) no bare unescaped "&" survives outside a
     recognized XML entity (which would make the part invalid XML). */
  {
    const assembly = ALL_MULTILINGUAL_SCENARIOS.find((s) => s.name === "xml-special-characters")!.build();
    const result = await buildProfessionalAtsDocx(assembly, "letter", "comfortable");
    const zip = await JSZip.loadAsync(result.bytes);
    const documentXml = await zip.file("word/document.xml")!.async("text");

    checkTrue("xml-special-characters: raw document.xml contains escaped &amp;", documentXml.includes("&amp;"));
    checkTrue("xml-special-characters: raw document.xml contains escaped &lt;", documentXml.includes("&lt;"));
    checkTrue("xml-special-characters: raw document.xml contains escaped &gt;", documentXml.includes("&gt;"));

    const bareAmpersandPattern = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/;
    checkTrue("xml-special-characters: no unescaped bare & in raw document.xml", !bareAmpersandPattern.test(documentXml), documentXml.match(bareAmpersandPattern)?.[0]);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
