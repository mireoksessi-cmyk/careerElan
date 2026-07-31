/*
  Document Preservation Engine (DPE) - Phase 4B completion. A REAL, concrete
  implementation of the `RegeneratePackageFn` injection point
  (compressionRetry.ts/retryEngine.ts) - the piece the rest of this
  pipeline's core deliberately does NOT contain, so that core stays free
  of any Supabase/OpenAI dependency. This file is the one place in the
  Execution Engine allowed to import supabaseAdmin and Generate Package's
  own worker directly, because this phase explicitly authorized calling
  Generate Package's real public interface for Compression Retry
  ("실제 Generate Package 호출이 없다"는 지적을 해결한다).

  What "real public interface" means here, concretely: Generate Package's
  actual public entry point is NOT only the HTTP route
  (app/api/generate-package/route.ts) - that route itself is a thin claim/
  enqueue layer whose real work happens in
  lib/generatePackage/generateCore.ts's exported runPackageGeneration
  (applicationId), the SAME function the HTTP route, the Netlify
  Background Function, and the local-dev worker route all call. Calling
  it directly here (rather than re-wrapping it in another authenticated
  HTTP round-trip this backend module has no user session to make) is
  calling the real interface at its actual entry point, not a bypass of
  it - the entire prompt-construction/SourceManifest/Protected Claims/
  Validation/Safety/JSON Extraction pipeline inside runPackageGeneration
  runs completely unmodified and unaware this call originated from DPE.

  Never assembles a prompt itself, never calls OpenAI itself - only:
  1. Reads the ORIGINAL application's already-stored input snapshot
     (read-only, via supabaseAdmin - the same trust boundary
     generateCore.ts itself already uses for a service-role call).
  2. Inserts a NEW applications row - a distinct generation attempt, not a
     mutation of the original - carrying the SAME resume/job snapshot plus
     dpe_generation_mode="layout_compression" and dpe_layout_constraints.
  3. Calls runPackageGeneration(newId) - the real worker.
  4. Reads back the new row's real result (or real failure).
*/
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../supabaseAdmin";
import { runPackageGeneration } from "../../generatePackage/generateCore";
import type { LayoutConstraints, RegeneratePackageFn } from "./types";

export function createRealRegeneratePackageFn(): RegeneratePackageFn {
  return async function realRegeneratePackage(
    applicationId: string,
    layoutConstraints: LayoutConstraints
  ): Promise<{ resume: string; coverLetter: string; generationId: string; generationRequestId: string }> {
    const { data: original, error: readError } = await supabaseAdmin
      .from("applications")
      .select(
        "user_id, company, job_title, job_url, job_description, job_description_normalized, job_analysis, location, job_type, resume_source, resume_id, resume_template_id, generation_input_resume_text, generation_input_resume_name, generation_input_manifest_source, generation_input_cover_letter_text"
      )
      .eq("id", applicationId)
      .single();

    if (readError || !original) {
      throw new Error(
        `realRegeneratePackage: could not read original application ${applicationId}: ${readError?.message ?? "not found"}`
      );
    }

    const newGenerationRequestId = randomUUID();
    const appliedDate = new Date().toISOString().split("T")[0];

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("applications")
      .insert({
        user_id: original.user_id,
        generation_request_id: newGenerationRequestId,
        generation_status: "pending",
        generation_started_at: new Date().toISOString(),
        company: original.company,
        job_title: original.job_title,
        job_url: original.job_url,
        job_description: original.job_description,
        job_description_normalized: original.job_description_normalized,
        job_analysis: original.job_analysis,
        location: original.location,
        job_type: original.job_type,
        resume_source: original.resume_source,
        resume_id: original.resume_id,
        resume_template_id: original.resume_template_id,
        generation_input_resume_text: original.generation_input_resume_text,
        generation_input_resume_name: original.generation_input_resume_name,
        generation_input_manifest_source: original.generation_input_manifest_source,
        generation_input_cover_letter_text: original.generation_input_cover_letter_text,
        dpe_generation_mode: "layout_compression",
        dpe_layout_constraints: layoutConstraints,
        applied_date: appliedDate,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        `realRegeneratePackage: could not create a new generation attempt for ${applicationId}: ${insertError?.message ?? "unknown error"}`
      );
    }

    // The real public interface - unmodified. This call performs its own
    // atomic claim, builds the SAME prompt pipeline (with the additional
    // layout-compression block only), calls OpenAI for real, validates,
    // and persists success/failure - all before returning.
    await runPackageGeneration(inserted.id);

    const { data: result, error: resultReadError } = await supabaseAdmin
      .from("applications")
      .select("generation_status, resume_text, cover_letter_text, generation_error_code, generation_error_summary")
      .eq("id", inserted.id)
      .single();

    if (resultReadError || !result) {
      throw new Error(
        `realRegeneratePackage: could not read the result of generation attempt ${inserted.id}: ${resultReadError?.message ?? "not found"}`
      );
    }

    if (result.generation_status !== "succeeded") {
      throw new Error(
        `realRegeneratePackage: Generate Package attempt ${inserted.id} did not succeed (status=${result.generation_status}, code=${result.generation_error_code ?? "none"}): ${result.generation_error_summary ?? "no summary"}`
      );
    }

    return {
      resume: result.resume_text ?? "",
      coverLetter: result.cover_letter_text ?? "",
      generationId: inserted.id,
      generationRequestId: newGenerationRequestId,
    };
  };
}
