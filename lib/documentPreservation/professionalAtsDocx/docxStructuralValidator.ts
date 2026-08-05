/*
  TASK 5 - DOCX structural validation. ZIP magic check needs no
  library. Required-part enumeration uses `jszip` - already present in
  node_modules (hoisted, same version) as a transitive dependency of
  the already-installed `docx`/`mammoth`/`docx-preview` packages, not
  a newly-installed dependency; not declared directly in package.json.
  This tradeoff is disclosed explicitly in the Phase 5B pre-
  implementation report (section 11) rather than silently relied on -
  spec section 15 explicitly permits "기존 ZIP library... 적절한 방법
  사용", and no other zip-reading capability exists in this codebase
  (see that report's DOCX asset audit).

  Empirically confirmed (this task's own dev run) that the `docx`
  package unconditionally emits word/document.xml, word/styles.xml,
  word/numbering.xml, and word/_rels/document.xml.rels for every
  document it produces (not just ones that happen to contain bullets) -
  so all five are treated as always-required parts, not conditional.

  XML well-formedness is inferred from JSZip successfully parsing the
  container AND each required XML part's raw text starting with an XML
  declaration/root element (a cheap sanity check) - no full XML parser
  is introduced (none exists in this codebase's own direct
  dependencies; see the pre-implementation report's audit, section 4).
*/
import JSZip from "jszip";
import type { DocxStructuralValidationResult } from "./types";

const REQUIRED_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"];

function looksLikeWellFormedXml(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<");
}

export async function validateDocxStructure(bytes: Uint8Array): Promise<DocxStructuralValidationResult> {
  const header = Buffer.from(bytes.slice(0, 4));
  const validZipHeader = header.length === 4 && header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;

  const emptyPageSize: DocxStructuralValidationResult["pageSize"] = { widthTwips: 0, heightTwips: 0, orientation: "portrait" };

  if (!validZipHeader || bytes.byteLength === 0) {
    return {
      validZipHeader,
      parseableZip: false,
      requiredPartsPresent: false,
      missingParts: REQUIRED_PARTS,
      parseableXml: false,
      macroFree: false,
      encrypted: false,
      externalRelationships: [],
      pageSize: emptyPageSize,
    };
  }

  try {
    const zip = await JSZip.loadAsync(bytes);
    const fileNames = new Set(Object.keys(zip.files));

    const missingParts = REQUIRED_PARTS.filter((p) => !fileNames.has(p));
    const requiredPartsPresent = missingParts.length === 0;

    let parseableXml = true;
    for (const part of REQUIRED_PARTS) {
      if (!fileNames.has(part)) continue;
      const text = await zip.file(part)!.async("text");
      if (!looksLikeWellFormedXml(text)) parseableXml = false;
    }

    const macroFree = !fileNames.has("word/vbaProject.bin");
    const encrypted = fileNames.has("EncryptionInfo") || fileNames.has("EncryptedPackage");

    const externalRelationships: string[] = [];
    for (const relsPart of ["_rels/.rels", "word/_rels/document.xml.rels"]) {
      if (!fileNames.has(relsPart)) continue;
      const relsXml = await zip.file(relsPart)!.async("text");
      const matches = relsXml.matchAll(/<Relationship[^>]*TargetMode="External"[^>]*Target="([^"]+)"/g);
      for (const m of matches) externalRelationships.push(m[1]);
    }

    let pageSize = emptyPageSize;
    if (fileNames.has("word/document.xml")) {
      const documentXml = await zip.file("word/document.xml")!.async("text");
      const pgSzMatch = documentXml.match(/<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*\/?>/);
      const orientMatch = documentXml.match(/<w:pgSz[^>]*w:orient="(landscape|portrait)"/);
      if (pgSzMatch) {
        pageSize = {
          widthTwips: parseInt(pgSzMatch[1], 10),
          heightTwips: parseInt(pgSzMatch[2], 10),
          orientation: orientMatch ? (orientMatch[1] as "portrait" | "landscape") : "portrait",
        };
      }
    }

    return {
      validZipHeader,
      parseableZip: true,
      requiredPartsPresent,
      missingParts,
      parseableXml,
      macroFree,
      encrypted,
      externalRelationships,
      pageSize,
    };
  } catch {
    return {
      validZipHeader,
      parseableZip: false,
      requiredPartsPresent: false,
      missingParts: REQUIRED_PARTS,
      parseableXml: false,
      macroFree: false,
      encrypted: false,
      externalRelationships: [],
      pageSize: emptyPageSize,
    };
  }
}
