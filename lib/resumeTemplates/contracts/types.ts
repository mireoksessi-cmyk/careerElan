/*
  Phase 6F - Resume Template Engine core contract types. This is the
  ONLY vocabulary every template renderer (professional-ats,
  modern-sidebar, executive-minimal, creative-timeline) and the
  registry/engine layers are allowed to share. A template renderer
  never imports Supabase, never reads a career_* DB row, and never
  receives anything other than a TemplateRenderContext built from an
  already-resolved ResumeStructuredModel (see engine/templateContext.ts).

  PaperSize is imported verbatim from the existing, already-shipped
  professionalAtsHtml module instead of being redefined here, so the
  Professional ATS template (which wraps that existing pipeline
  unmodified) never needs a paper-size translation layer.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { PaperSize } from "../../documentPreservation/professionalAtsHtml/types";

export type { PaperSize };

export type TemplateId = "professional-ats" | "modern-sidebar" | "executive-minimal" | "creative-timeline";

export const TEMPLATE_IDS: readonly TemplateId[] = ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"];

export type TemplateCategory = "ats" | "modern" | "executive" | "creative";

export type TemplateStatus = "active" | "beta" | "deprecated";

export type TemplateFormat = "html" | "pdf" | "docx";

/*
  A shared 4-point density scale every template maps its own internal
  tokens onto. Professional ATS's existing AssemblyDensity
  ("comfortable"|"balanced"|"compact"|"ultra-compact") maps onto this
  scale via a 1:1 rename for the first three and "ultra-compact" folded
  into "compact" at the wrapper boundary (see templates/professionalAts/
  density.ts) - the existing pipeline's own 4-value type is never
  changed.
*/
export type TemplateDensity = "spacious" | "comfortable" | "balanced" | "compact";

export const TEMPLATE_DENSITIES: readonly TemplateDensity[] = ["spacious", "comfortable", "balanced", "compact"];

export type AtsLevel = "high" | "medium" | "visual";

/*
  No real photo upload/storage is wired in this round (spec explicitly
  forbids using a real face image in synthetic previews). "placeholder"
  renders a simple geometric shape in the photo slot; "none" omits the
  slot entirely and templates must reclaim that layout space rather
  than leaving a visible gap (see spec section 3's Modern Sidebar
  requirement).
*/
export type PhotoOption = "none" | "placeholder";

/*
  The single input every template renderer's renderHtml/renderPdf/
  renderDocx receives. Constructed once per render call by
  engine/templateContext.ts from an already-resolved
  ResumeStructuredModel - never assembled ad hoc inside a template.
*/
export type TemplateRenderContext = {
  resume: ResumeStructuredModel;
  templateId: TemplateId;
  paperSize: PaperSize;
  density: TemplateDensity;
  locale: string;
  photoOption: PhotoOption;
  /*
    Explicit, caller-supplied generation timestamp (ISO 8601). Never
    computed internally via Date.now()/new Date() - matches this
    repo's established convention for every other deterministic
    factory (see runtime/factory.ts's own header comment) and keeps
    every template renderer a pure function of its input.
  */
  generatedAt: string;
  /*
    Reserved for a future section-order/visibility editing UI (spec
    section 8: "policy 구조는 확장 가능하게 작성하되 이번 라운드에서
    편집 UI는 만들지 않는다"). Left undefined this round; when present,
    a template's sectionPolicy.ts may consult it to override its
    default order, but no template requires it to render correctly.
  */
  sectionVisibility?: Record<string, boolean>;
};

export type TemplateValidationIssue = {
  code: string;
  message: string;
  sectionKey?: string;
  entryId?: string;
};

/*
  The shared, format-agnostic parity/preservation report shape every
  template's renderHtml/renderPdf/renderDocx result carries. Each
  template's internal implementation may compute this however fits its
  own pipeline (Professional ATS's wrapper translates the existing
  three-format validator outputs into this shape verbatim; the three
  new templates compute it via lib/resumeTemplates/parity/), but the
  SHAPE downstream code (Gallery UI, tests, negative controls) checks
  against is always this one.
*/
export type TemplateValidationReport = {
  passed: boolean;
  missingTextCount: number;
  inventedTextCount: number;
  duplicateTextCount: number;
  sectionOrderPreserved: boolean;
  entryOrderPreserved: boolean;
  protectedFactsUnchanged: boolean;
  issues: TemplateValidationIssue[];
};

export type TemplateHtmlResult = {
  templateId: TemplateId;
  format: "html";
  html: string;
  pageCount: number;
  paperSize: PaperSize;
  density: TemplateDensity;
  validation: TemplateValidationReport;
};

export type TemplatePdfResult = {
  templateId: TemplateId;
  format: "pdf";
  bytes: Buffer;
  pageCount: number;
  paperSize: PaperSize;
  density: TemplateDensity;
  hasSelectableText: boolean;
  validation: TemplateValidationReport;
};

export type TemplateDocxResult = {
  templateId: TemplateId;
  format: "docx";
  bytes: Buffer;
  paperSize: PaperSize;
  density: TemplateDensity;
  isEditableNativeDocx: boolean;
  validation: TemplateValidationReport;
};

/*
  Registry metadata - spec section 5's minimum field list, verbatim.
*/
export type TemplateCapabilities = {
  id: TemplateId;
  name: string;
  description: string;
  category: TemplateCategory;
  version: string;
  status: TemplateStatus;
  supportedFormats: TemplateFormat[];
  supportedPaperSizes: PaperSize[];
  supportedDensities: TemplateDensity[];
  atsLevel: AtsLevel;
  supportsPhoto: boolean;
  supportsSidebar: boolean;
  supportsMetricGrid: boolean;
  supportsHierarchy: boolean;
  supportsLanguages: boolean;
  supportsCustomSections: boolean;
  supportsMultiplePages: boolean;
  defaultPaperSize: PaperSize;
  defaultDensity: TemplateDensity;
  previewAsset: string;
  renderer: string;
  pdfRenderer: string;
  docxRenderer: string;
  validationProfile: string;
};
