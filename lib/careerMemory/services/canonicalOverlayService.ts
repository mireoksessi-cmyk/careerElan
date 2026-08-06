/*
  Phase 6D - Overlay Service. Every protection against canonical
  mutation/protected-field changes/nonexistent-entry targeting is
  enforced by the UNTOUCHED lib/documentPreservation/resumeStructured/
  tailoredOverlay.ts contract via lib/careerMemory/runtime/
  overlayRuntime.ts's applyOverlay()/validateOverlay() - this file never
  re-implements that logic, matching §14's own instruction. Template
  rendering is never invoked here - no import from lib/brand/render or
  any lib/documentPreservation/professionalAts* directory anywhere in
  this file.
*/
import { applyOverlay, resolveTailoredResume, validateOverlay } from "../runtime/overlayRuntime";
import type { CanonicalResumeRuntime, OverlayApplicationRecord } from "../runtime/types";
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import { careerTailoredResumeRowToOverlayRecord, runtimeToCareerTailoredResumeInsertInput, sortByCreatedAtThenId } from "../persistence/mappers";
import type { CareerTailoredResumeRow } from "../persistence/types";
import { NotFoundError, ValidationError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { requireOwnedProfile } from "./profileAccess";

export type CreateOverlayInput = {
  profileId: string;
  resumeVersionId?: string | null;
  applicationId?: string | null;
  templateId?: string | null;
  aiModel?: string | null;
  promptVersion?: string | null;
  overlay: unknown;
  idempotencyKey?: string | null;
};

export type CreateOverlayResult = {
  row: CareerTailoredResumeRow;
  appliedEntryIds: string[];
  rejections: OverlayApplicationRecord["rejections"];
};

async function buildRuntimeForOverlayValidation(repos: CanonicalRepositoryBundle, profileId: string, resumeVersionId: string | null | undefined): Promise<CanonicalResumeRuntime> {
  const version = resumeVersionId ? await repos.resumeVersions.getById(resumeVersionId) : await repos.resumeVersions.getLatestByProfileId(profileId);
  if (!version || version.profile_id !== profileId) throw new NotFoundError("Resume version to tailor");

  const existingRows = await repos.tailoredResumes.listByProfileId(profileId);
  const ordered = sortByCreatedAtThenId(existingRows as Array<{ id: string; created_at: string }>) as CareerTailoredResumeRow[];
  const history = ordered.map(careerTailoredResumeRowToOverlayRecord);

  return {
    resume: version.snapshot as unknown as ResumeStructuredModel,
    metadata: { schemaVersion: version.schema_version, serializerVersion: version.serializer_version },
    version: { id: version.id, reason: version.reason, createdAt: version.created_at, parentVersionId: version.parent_version_id ?? undefined },
    sourceDocuments: [],
    serializerVersion: version.serializer_version,
    overlayState: { history },
  };
}

export class CanonicalOverlayService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  /*
    Phase 6D.1 - the overlay MERGE computation stays entirely in
    TypeScript (unchanged, still applyOverlay() from overlayRuntime.ts);
    only the actual row WRITE now runs through the
    create_canonical_overlay() SQL RPC, idempotency-key aware.
  */
  async createOverlay(userId: string, input: CreateOverlayInput): Promise<CreateOverlayResult> {
    assertOverlayShapeIsPlainObject(input.overlay);
    await requireOwnedProfile(this.repos, userId, input.profileId);

    const runtime = await buildRuntimeForOverlayValidation(this.repos, input.profileId, input.resumeVersionId);
    const applied = applyOverlay(runtime, input.overlay);

    const insertInput = runtimeToCareerTailoredResumeInsertInput(input.profileId, applied.runtime.overlayState.history[applied.runtime.overlayState.history.length - 1], {
      applicationId: input.applicationId ?? null,
      resumeVersionId: input.resumeVersionId ?? runtime.version.id,
      templateId: input.templateId ?? null,
      aiModel: input.aiModel ?? null,
      promptVersion: input.promptVersion ?? null,
    });

    const rpcResult = await this.repos.transactions.createOverlay({
      profileId: input.profileId,
      applicationId: insertInput.application_id ?? null,
      resumeVersionId: insertInput.resume_version_id ?? null,
      templateId: insertInput.template_id ?? null,
      aiModel: insertInput.ai_model ?? null,
      promptVersion: insertInput.prompt_version ?? null,
      overlayRecord: insertInput.overlay,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    if (rpcResult.status === "not_found") throw new NotFoundError("Career profile");

    const row = await this.repos.tailoredResumes.getById(rpcResult.overlayId);
    if (!row) throw new NotFoundError("Created overlay");

    return { row, appliedEntryIds: applied.appliedEntryIds, rejections: applied.rejections };
  }

  /* Dry-run - never writes a row. Lets a caller check "would this
     overlay be accepted" before committing to createOverlay(). */
  async validateOverlayInput(userId: string, profileId: string, resumeVersionId: string | null | undefined, overlay: unknown): Promise<{ valid: boolean; rejections: OverlayApplicationRecord["rejections"] }> {
    assertOverlayShapeIsPlainObject(overlay);
    await requireOwnedProfile(this.repos, userId, profileId);
    const runtime = await buildRuntimeForOverlayValidation(this.repos, profileId, resumeVersionId);
    return validateOverlay(runtime, overlay);
  }

  async listOverlays(userId: string, profileId: string): Promise<CareerTailoredResumeRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    return this.repos.tailoredResumes.listByProfileId(profileId);
  }

  async deleteOverlay(userId: string, profileId: string, overlayId: string): Promise<void> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const row = await this.repos.tailoredResumes.getById(overlayId);
    if (!row || row.profile_id !== profileId) throw new NotFoundError("Overlay");
    await this.repos.tailoredResumes.delete(overlayId);
  }

  /* Folds the full ordered overlay history over the canonical resume -
     the tailored VIEW, never persisted, always derived on demand
     (matching overlayRuntime.ts's own resolveTailoredResume contract). */
  async resolveTailoredView(userId: string, profileId: string, resumeVersionId?: string | null): Promise<ResumeStructuredModel> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const runtime = await buildRuntimeForOverlayValidation(this.repos, profileId, resumeVersionId);
    return resolveTailoredResume(runtime);
  }
}

export function assertOverlayShapeIsPlainObject(overlay: unknown): void {
  if (typeof overlay !== "object" || overlay === null || Array.isArray(overlay)) {
    throw new ValidationError(["overlay must be a plain JSON object"]);
  }
}
