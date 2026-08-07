/*
  Phase 6G - renders a tailored canonical resume through the Phase 6F
  Template Engine (unmodified) and, if real Storage upload succeeds,
  atomically records BOTH generated_resume_documents rows (pdf + docx)
  and the applications row's canonical metadata via the single
  complete_canonical_generation RPC (supabase/migrations/
  20260807000000) - never partially. If document storage is disabled
  or upload fails, returns a LOCAL_OUTPUT_ONLY result: the render still
  succeeded (bytes exist, HTML preview is real) but nothing is
  persisted as a generated_resume_documents row, per the round's own
  Document Storage requirement ("존재하지 않는 storage path를 metadata로
  저장 금지").
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderTemplateFromRuntime } from "../../resumeTemplates/engine/renderTemplate";
import { ensureTemplatesRegistered } from "../../resumeTemplates/registry/bootstrap";
import { validateTemplateId } from "../../resumeTemplates/registry/templateRegistry";
import type { CanonicalResumeRuntime } from "../runtime/types";
import type { TemplateId, TemplateDensity, TemplateValidationReport } from "../../resumeTemplates/contracts/types";
import type { PaperSize } from "../../documentPreservation/professionalAtsHtml/types";
import { uploadGeneratedDocument } from "./canonicalDocumentStorageService";
import { TemplateResolutionError, GeneratedDocumentError, TemplateRenderingError } from "../errors/domainErrors";

export type RenderCanonicalPackageInput = {
  userId: string;
  applicationId: string;
  runtime: CanonicalResumeRuntime;
  useTailored: boolean;
  templateId: string;
  paperSize: PaperSize;
  density: TemplateDensity;
  locale: string;
  canonicalProfileId: string;
  canonicalResumeVersionId: string | null;
  tailoredResumeId: string | null;
  generatedAt: string;
};

export type RenderCanonicalPackageResult = {
  html: string;
  pageCount: number;
  pdfBytes: Buffer;
  docxBytes: Buffer;
  pdfValidation: TemplateValidationReport;
  docxValidation: TemplateValidationReport;
  documentStorage:
    | { persisted: true; pdfDocumentId: string; docxDocumentId: string }
    | { persisted: false; reason: "storage_disabled" | "upload_failed" | "no_tailored_resume" };
};

/*
  Validates the template id up front, distinguishing "unknown id" (404)
  from "known id, unsupported option" (400) - see domainErrors.ts's own
  header comment on why this is a real, previously-unresolved
  inconsistency in this codebase between TemplateContractError's ad-hoc
  400/404 split and the shared ValidationError->422 convention; this
  orchestration layer resolves it explicitly rather than silently
  picking one.
*/
export function resolveCanonicalTemplateId(rawTemplateId: string): TemplateId {
  ensureTemplatesRegistered();
  try {
    return validateTemplateId(rawTemplateId);
  } catch {
    throw new TemplateResolutionError("unknown-template-id", `Unknown template id "${rawTemplateId}".`);
  }
}

export async function renderCanonicalPackage(client: SupabaseClient, input: RenderCanonicalPackageInput): Promise<RenderCanonicalPackageResult> {
  ensureTemplatesRegistered();
  const templateId = resolveCanonicalTemplateId(input.templateId);

  let htmlResult, pdfResult, docxResult;
  try {
    htmlResult = await renderTemplateFromRuntime(input.runtime, { templateId, useTailored: input.useTailored, paperSize: input.paperSize, density: input.density, locale: input.locale, generatedAt: input.generatedAt }, "html");
    pdfResult = await renderTemplateFromRuntime(input.runtime, { templateId, useTailored: input.useTailored, paperSize: input.paperSize, density: input.density, locale: input.locale, generatedAt: input.generatedAt }, "pdf");
    docxResult = await renderTemplateFromRuntime(input.runtime, { templateId, useTailored: input.useTailored, paperSize: input.paperSize, density: input.density, locale: input.locale, generatedAt: input.generatedAt }, "docx");
  } catch (error) {
    throw new TemplateRenderingError(error instanceof Error ? error.message.slice(0, 200) : "unknown rendering failure");
  }

  let documentStorage: RenderCanonicalPackageResult["documentStorage"] = { persisted: false, reason: "storage_disabled" };

  if (input.tailoredResumeId) {
    const pdfUpload = await uploadGeneratedDocument(client, { userId: input.userId, applicationId: input.applicationId, fileType: "pdf", bytes: pdfResult.bytes });
    if (pdfUpload.uploaded) {
      const docxUpload = await uploadGeneratedDocument(client, { userId: input.userId, applicationId: input.applicationId, fileType: "docx", bytes: docxResult.bytes });
      if (docxUpload.uploaded) {
        const { data, error } = await client.rpc("complete_canonical_generation", {
          p_user_id: input.userId,
          p_application_id: input.applicationId,
          p_tailored_resume_id: input.tailoredResumeId,
          p_canonical_profile_id: input.canonicalProfileId,
          p_canonical_resume_version_id: input.canonicalResumeVersionId,
          p_template_id: templateId,
          p_pdf_storage_bucket: pdfUpload.storageBucket,
          p_pdf_storage_path: pdfUpload.storagePath,
          p_docx_storage_bucket: docxUpload.storageBucket,
          p_docx_storage_path: docxUpload.storagePath,
          p_generation_engine: "canonical",
          p_generation_engine_version: "6G.0",
          p_protected_fact_validation_result: { pdfProtectedFactsUnchanged: pdfResult.validation.protectedFactsUnchanged, docxProtectedFactsUnchanged: docxResult.validation.protectedFactsUnchanged },
        });
        if (error) throw new GeneratedDocumentError(error.message.slice(0, 200));
        const rpcResult = data as { status: string; pdfDocumentId?: string; docxDocumentId?: string };
        if (rpcResult.status === "success" && rpcResult.pdfDocumentId && rpcResult.docxDocumentId) {
          documentStorage = { persisted: true, pdfDocumentId: rpcResult.pdfDocumentId, docxDocumentId: rpcResult.docxDocumentId };
        } else {
          throw new GeneratedDocumentError(`complete_canonical_generation returned ${rpcResult.status}`);
        }
      } else {
        documentStorage = { persisted: false, reason: "upload_failed" };
      }
    } else {
      documentStorage = { persisted: false, reason: pdfUpload.reason === "storage_disabled" ? "storage_disabled" : "upload_failed" };
    }
  } else {
    documentStorage = { persisted: false, reason: "no_tailored_resume" };
  }

  return {
    html: htmlResult.html,
    pageCount: htmlResult.pageCount,
    pdfBytes: pdfResult.bytes,
    docxBytes: docxResult.bytes,
    pdfValidation: pdfResult.validation,
    docxValidation: docxResult.validation,
    documentStorage,
  };
}
