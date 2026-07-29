import type { DocumentIR } from "../types";
import DocumentRenderer from "./DocumentRenderer";
import { exportPdfFromText } from "./pdfDocumentExport";
import { exportDocxFromText } from "./docxDocumentExport";
import {
  type ResumeTemplateId,
  RESUME_TEMPLATE_IDS,
  DEFAULT_RESUME_TEMPLATE,
  normalizeResumeTemplateId,
} from "./templateId";

/*
  Renderer abstraction: bundles the React preview + PDF export + DOCX
  export for one visual template behind a single interface, so adding a
  future template never requires touching DocumentIR, buildDocumentIR(),
  or the exporters' shared tree-walking (blocks.ts) - only a new entry
  here. All four templates below are real, distinct implementations
  across React/PDF/DOCX (not aliases of Classic) - see DocumentRenderer.tsx,
  pdfDocumentExport.ts, docxDocumentExport.ts for the per-template layout
  logic. Every entry point in the app resolves its template through
  getRenderer(), which always normalizes through normalizeResumeTemplateId()
  - this is what keeps Preview/PDF/DOCX from ever drifting to different
  default templates.
*/

export type { ResumeTemplateId };
export { RESUME_TEMPLATE_IDS, DEFAULT_RESUME_TEMPLATE, normalizeResumeTemplateId };

export type Renderer = {
  id: ResumeTemplateId;
  React: (props: { ir: DocumentIR }) => ReturnType<typeof DocumentRenderer>;
  exportPdf: (text: string, fileName: string) => Promise<void>;
  exportDocx: (text: string, fileName: string) => Promise<void>;
};

function makeRenderer(id: ResumeTemplateId): Renderer {
  return {
    id,
    React: (props) => DocumentRenderer({ ...props, templateId: id }),
    exportPdf: (text, fileName) => exportPdfFromText(text, fileName, id),
    exportDocx: (text, fileName) => exportDocxFromText(text, fileName, id),
  };
}

export const RENDERERS: Record<ResumeTemplateId, Renderer> = {
  classic: makeRenderer("classic"),
  professional: makeRenderer("professional"),
  creative: makeRenderer("creative"),
  modern: makeRenderer("modern"),
};

export function getRenderer(templateId?: string | null): Renderer {
  return RENDERERS[normalizeResumeTemplateId(templateId)];
}
