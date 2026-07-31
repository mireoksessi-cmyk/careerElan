/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  Interface only. Re-exposes the EXISTING export functions' signatures
  (lib/brand/render/pdfDocumentExport.ts's exportPdfFromText,
  lib/brand/render/docxDocumentExport.ts's exportDocxFromText, both
  bundled as Renderer.exportPdf/exportDocx in renderer.ts) as the shape a
  future DPE export step will call through. Neither exporter is modified
  or duplicated here.
*/

import type { Renderer } from "@/lib/brand/render/renderer";

export type DPEExportAdapter = {
  exportPdf: Renderer["exportPdf"];
  exportDocx: Renderer["exportDocx"];
};
