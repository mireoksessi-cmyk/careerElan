/*
  Phase 6F - template-agnostic DOCX structural + text extraction for
  the 3 NEW templates. Same technique/libraries as the existing,
  unmodified professionalAtsDocx/docxStructuralValidator.ts +
  docxTextExtraction.ts (JSZip for structure, mammoth for text) - real
  re-parsing of the produced bytes, not a trust of the renderer's own
  bookkeeping.
*/
import JSZip from "jszip";
import mammoth from "mammoth";

const REQUIRED_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"];

export type DocxExtractionResult = {
  validZipHeader: boolean;
  parseableZip: boolean;
  requiredPartsPresent: boolean;
  missingParts: string[];
  macroFree: boolean;
  text: string;
};

export async function extractDocx(bytes: Uint8Array): Promise<DocxExtractionResult> {
  const header = Buffer.from(bytes.slice(0, 4));
  const validZipHeader = header.length === 4 && header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;

  if (!validZipHeader || bytes.byteLength === 0) {
    return { validZipHeader, parseableZip: false, requiredPartsPresent: false, missingParts: REQUIRED_PARTS, macroFree: false, text: "" };
  }

  try {
    const zip = await JSZip.loadAsync(bytes);
    const fileNames = new Set(Object.keys(zip.files));
    const missingParts = REQUIRED_PARTS.filter((p) => !fileNames.has(p));
    const macroFree = !fileNames.has("word/vbaProject.bin");

    const buffer = Buffer.from(bytes);
    const { value: text } = await mammoth.extractRawText({ buffer });

    return { validZipHeader, parseableZip: true, requiredPartsPresent: missingParts.length === 0, missingParts, macroFree, text };
  } catch {
    return { validZipHeader, parseableZip: false, requiredPartsPresent: false, missingParts: REQUIRED_PARTS, macroFree: false, text: "" };
  }
}
