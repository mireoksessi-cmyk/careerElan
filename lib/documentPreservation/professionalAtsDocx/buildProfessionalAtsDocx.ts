/*
  TASK 4-7 orchestrator - ties Phase 5B together into one
  ProfessionalAtsDocxResult. Mirrors Phase 5A's own
  buildProfessionalAtsPdf orchestrator pattern: thin composition, no
  new decision logic. Unlike Phase 5A, this does NOT require a Phase 4
  HTML validation pass as a precondition - Phase 5B consumes Phase 3's
  ProfessionalAtsAssemblyDocument directly (spec section 4: "입력:
  ProfessionalAtsAssemblyDocument"), and does not depend on Phase 4's
  auto-fit density selection (spec section 2 explicitly does not
  require DOCX/HTML page-count parity, so there is no Phase-4-density
  precondition to inherit - the caller supplies paperSize/density
  directly, same as Phase 4's own buildProfessionalAtsAssembly->
  buildProfessionalAtsHtmlPreview boundary, just without chaining
  through Phase 4 itself).
*/
import { createHash } from "node:crypto";
import { Packer } from "docx";
import { buildProfessionalAtsDocxDocument } from "./docxRenderer";
import { validateDocxStructure } from "./docxStructuralValidator";
import { extractDocxText } from "./docxTextExtraction";
import { validateDocxTextPreservation } from "./docxTextPreservationValidator";
import { validateDocxParity } from "./docxParityValidator";
import { buildDocxFileName } from "./fileName";
import type { PaperSize } from "../professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";
import type { ProfessionalAtsDocxResult } from "./types";

function extractApplicantName(assembly: ProfessionalAtsAssemblyDocument): string | null {
  const identitySection = assembly.sections.find((s) => s.key === "identity");
  const identityBlock = identitySection?.blocks[0];
  if (!identityBlock) return null;
  const payload = identityBlock.payload as { fullName?: { value?: string } };
  return payload.fullName?.value ?? null;
}

export async function buildProfessionalAtsDocx(
  assembly: ProfessionalAtsAssemblyDocument,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<ProfessionalAtsDocxResult> {
  const { document, sourceMapping, structure, paginationIntent } = buildProfessionalAtsDocxDocument(assembly, paperSize, density);
  const buffer = await Packer.toBuffer(document);
  const bytes = new Uint8Array(buffer);

  const structural = await validateDocxStructure(bytes);
  const docxText = structural.parseableZip ? await extractDocxText(bytes) : "";
  const text = validateDocxTextPreservation(assembly, docxText);
  const parity = validateDocxParity(assembly, docxText, sourceMapping);

  const passed =
    structural.validZipHeader &&
    structural.parseableZip &&
    structural.requiredPartsPresent &&
    structural.parseableXml &&
    structural.macroFree &&
    !structural.encrypted &&
    structural.externalRelationships.length === 0 &&
    text.missingFragments.length === 0 &&
    text.inventedFragments.length === 0 &&
    text.duplicateEntryIds.length === 0 &&
    parity.sameVisibleSections &&
    parity.sameSectionOrder &&
    parity.sameEntryOrder &&
    parity.sameProtectedFacts &&
    parity.sourceCoveragePercent === 100 &&
    paginationIntent.violations.length === 0;

  const applicantName = extractApplicantName(assembly);
  const fileName = buildDocxFileName(applicantName, paperSize, "professional-ats-v1");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    templateId: "professional-ats-v1",
    paperSize,
    density,
    fileName,
    bytes,
    byteLength: bytes.byteLength,
    sha256,
    structure,
    sourceMapping,
    validation: {
      passed,
      structural,
      text,
      paginationIntent,
      parity,
      warnings: [],
    },
  };
}
