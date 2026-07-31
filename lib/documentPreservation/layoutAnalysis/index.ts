/*
  Document Preservation Engine (DPE) - Phase 2 (Layout Analysis) entry
  point. Not called from anywhere yet - no route, worker, or existing
  Generate Package code imports this module (see the final report's
  "Generate Package 변경 여부" section). Wiring analyzeDocument() into a
  real caller is out of scope for this phase.

  sourceFormat is a required, explicit argument rather than re-detected
  from the buffer's magic bytes. The existing magic-byte sniffer
  (detectFileType() in app/api/process-resume-design/route.ts) is
  module-private like processPdf/processDocx, so reusing it verbatim
  would mean either modifying that route (out of scope) or duplicating
  ~20 lines of byte-signature logic here. Every realistic caller of this
  analyzer already knows the format (resumes.original_file_type is set by
  the existing upload/conversion pipeline, or a caller reading a file by
  its own extension), so requiring it as an argument avoids that
  duplication entirely rather than reimplementing it "as needed."
*/

import type { DPEDocumentType } from "../types";
import type { LayoutAnalysisResult, LayoutSourceFormat } from "./types";
import { analyzePdfLayout } from "./pdfLayoutAnalyzer";
import { analyzeDocxLayout } from "./docxLayoutAnalyzer";

/*
  Minimal structural check only, per this phase's own scope ("필요하다면
  LayoutAnalysisResult의 최소 구조 검증 정도만 수행한다") - not the real
  DPEValidator from lib/documentPreservation/validation.ts, which stays
  an unimplemented interface until a later phase. This never inspects
  layout correctness (overlap, clipping, etc.) - only that analyze()
  actually returned the shape it promised.
*/
function assertWellFormed(result: LayoutAnalysisResult): void {
  if (!Array.isArray(result.pages)) {
    throw new Error("LayoutAnalysisResult.pages must be an array.");
  }
  for (const page of result.pages) {
    if (!Array.isArray(page.elements)) {
      throw new Error(
        `LayoutAnalysisResult.pages[${page.pageNumber}].elements must be an array.`
      );
    }
  }
}

export async function analyzeDocument(
  documentType: DPEDocumentType,
  sourceFormat: LayoutSourceFormat,
  buffer: Buffer
): Promise<LayoutAnalysisResult> {
  const result =
    sourceFormat === "pdf"
      ? await analyzePdfLayout(documentType, buffer)
      : await analyzeDocxLayout(documentType, buffer);

  assertWellFormed(result);

  return result;
}

export * from "./types";
export { analyzePdfLayout } from "./pdfLayoutAnalyzer";
export { analyzeDocxLayout } from "./docxLayoutAnalyzer";
