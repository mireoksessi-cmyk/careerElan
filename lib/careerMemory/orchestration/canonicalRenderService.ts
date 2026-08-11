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
import { isE2eAiModeActive } from "../../testing/e2eAiIsolation";
import { logOperationalEvent } from "../../observability/logger";

/*
  Phase 6I.6.35 Part AC/AD/AE - test-only renderer fault injection,
  same double-gate as canonicalDocumentStorageService.ts's storage-write
  injection (isE2eAiModeActive() fail-closed + server-env-var only,
  never client input). Fires BEFORE the real renderTemplateFromRuntime()
  call for the targeted format, so no bytes are ever produced for that
  format - never a zero-byte/corrupt artifact silently written.
*/
function isRenderFaultInjected(format: "pdf" | "docx"): boolean {
  if (!isE2eAiModeActive()) return false;
  const target = process.env.E2E_FAULT_INJECT_RENDER;
  return target === format || target === "both";
}

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
    if (isRenderFaultInjected("pdf")) {
      throw new Error("E2E fault injection (Phase 6I.6.35, E2E_FAULT_INJECT_RENDER) - real PDF renderer was never called.");
    }
    pdfResult = await renderTemplateFromRuntime(input.runtime, { templateId, useTailored: input.useTailored, paperSize: input.paperSize, density: input.density, locale: input.locale, generatedAt: input.generatedAt }, "pdf");
    if (isRenderFaultInjected("docx")) {
      throw new Error("E2E fault injection (Phase 6I.6.35, E2E_FAULT_INJECT_RENDER) - real DOCX renderer was never called.");
    }
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

  logOperationalEvent(
    documentStorage.persisted
      ? { domain: "storage", event: "document_persisted", applicationId: input.applicationId, pdfDocumentId: documentStorage.pdfDocumentId, docxDocumentId: documentStorage.docxDocumentId }
      : { domain: "storage", event: "document_persist_skipped", applicationId: input.applicationId, reason: documentStorage.reason }
  );

  /*
    Phase 6I.6.39 (consistency fix) - a tailored resume exists, so
    document persistence was actually required for this generation, but
    it did not succeed (storage disabled or the upload itself failed).
    Silently returning here previously let generateCanonicalPackage()
    resolve normally, which let canonicalGenerationWorker.ts mark the
    row generation_status='succeeded' with selected_template_id/
    tailored_resume_id left null - a real consistency bug found by
    investigation (generation reported success while its own required
    persistence was silently skipped). Throwing the SAME
    GeneratedDocumentError this function already throws for the
    sibling "RPC itself failed" case below routes this through the
    existing, unmodified fallback/hard-fail machinery
    (classifyForFallback -> generated_document_failure, fallback-eligible)
    instead of adding a new status path. "no_tailored_resume" is
    excluded on purpose - that is the legitimate case where there was
    never anything to persist (input.tailoredResumeId is falsy, so this
    branch is unreachable for it).
  */
  if (input.tailoredResumeId && !documentStorage.persisted) {
    throw new GeneratedDocumentError(`document persistence was required for this tailored resume but did not succeed (${documentStorage.reason}).`);
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
