/*
  Document Preservation Engine (DPE) - Phase 1 skeleton.

  Defines how DPE will eventually hand off to the EXISTING renderer
  (lib/brand/render/renderer.ts's Renderer type) - it does not redefine
  or wrap that type with a new one. lib/brand/render/renderer.ts,
  DocumentRenderer.tsx, pdfDocumentExport.ts, and docxDocumentExport.ts
  are untouched by this Phase.

  Renderer's own shape (confirmed by reading lib/brand/render/renderer.ts)
  is asymmetric: `React` takes a parsed DocumentIR, while `exportPdf`/
  `exportDocx` take the raw text and re-derive DocumentIR internally via
  buildDocumentIRFromText. DPERendererConnection mirrors that real shape
  exactly rather than guessing at a unified one - later phases decide how
  a DPEDocument becomes a DocumentIR (or new text), not this one.
*/

import type { Renderer } from "@/lib/brand/render/renderer";
import type { DPEDocument } from "./types";

export type DPERendererConnection = {
  templateId: Renderer["id"];
  render: Renderer["React"];
  exportPdf: Renderer["exportPdf"];
  exportDocx: Renderer["exportDocx"];
};

/*
  Phase 2+ will implement the actual DPEDocument -> DocumentIR (or
  DPEDocument -> text) conversion. Declaring the function's shape now
  gives later phases a fixed target without Phase 1 guessing at the
  conversion logic itself - there is intentionally no implementation
  here yet.
*/
export type DPEToRendererConverter = (document: DPEDocument) => {
  text: string;
  templateId?: string | null;
};
