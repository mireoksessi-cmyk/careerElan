/*
  Phase 6D - Resume Version Service. Read/list/restore only - the
  MULTI-table "create a brand-new canonical version from a fresh
  Runtime" workflow lives in canonicalCareerMemoryService.ts's
  saveCanonicalRuntime() (it needs the six child tables too; a version
  row alone is not a canonical save). restoreVersion() below creates
  only a version row (no child-table replace) - see its own comment
  for why that is a disclosed, intentional scope decision, not an
  oversight.
*/
import { ConflictError, NotFoundError, SchemaGapError, ValidationError } from "../errors/domainErrors";
import type { CareerResumeVersionRow, ResumeVersionReason } from "../persistence/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { requireOwnedProfile } from "./profileAccess";

const VALID_REASONS: ResumeVersionReason[] = ["initial", "reanalysis", "user_edit", "merge", "import", "restore"];

export class CanonicalResumeVersionService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  async listVersions(userId: string, profileId: string): Promise<CareerResumeVersionRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    return this.repos.resumeVersions.listByProfileId(profileId);
  }

  async getVersion(userId: string, profileId: string, versionId: string): Promise<CareerResumeVersionRow> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const version = await this.repos.resumeVersions.getById(versionId);
    if (!version || version.profile_id !== profileId) throw new NotFoundError("Resume version");
    return version;
  }

  /*
    Creates a NEW version row whose snapshot is a copy of an older
    version's snapshot - never updates the old row in place (Phase
    6A.2 Versioning Contract). parentVersionId is the version that was
    CURRENT immediately before this restore (matching §13's own
    instruction), NOT the id of the version being restored FROM.

    SCHEMA_GAP (disclosed, not fixed this round): there is no column
    on career_resume_versions to record "restoredFromVersionId"
    distinctly from parentVersionId, and the snapshot column must stay
    a pure ResumeStructuredModel (Phase 6C's own round-trip contract -
    adding a foreign field there would break careerResumeVersionRowToRuntime's
    reconstruction). The caller/API response surfaces
    restoredFromVersionId in-memory for this one response, but it is
    NOT durably recoverable later by re-reading the row - see the final
    report's "Schema Gaps" section (RESTORE_PROVENANCE_SCHEMA_GAP).

    Only touches career_resume_versions - never replaces the six child
    tables (unlike a real canonical save). This is a deliberate,
    disclosed scope decision: restoring the CHILD TABLES atomically has
    the exact same TRANSACTION_SCHEMA_GAP as saveCanonicalRuntime()
    itself, so restore() does not pretend to solve it differently. A
    caller that needs the child tables to reflect the restored snapshot
    too must separately call the same gated write path
    saveCanonicalRuntime() uses.
  */
  async restoreVersion(userId: string, profileId: string, targetVersionId: string): Promise<{ newVersion: CareerResumeVersionRow; restoredFromVersionId: string }> {
    await requireOwnedProfile(this.repos, userId, profileId);

    const target = await this.repos.resumeVersions.getById(targetVersionId);
    if (!target || target.profile_id !== profileId) throw new NotFoundError("Resume version to restore from");

    const latest = await this.repos.resumeVersions.getLatestByProfileId(profileId);

    const newVersion = await this.repos.resumeVersions.insert({
      profile_id: profileId,
      source_document_id: target.source_document_id,
      parent_version_id: latest?.id ?? null,
      reason: "restore",
      snapshot: target.snapshot,
      schema_version: target.schema_version,
      serializer_version: target.serializer_version,
    });

    return { newVersion, restoredFromVersionId: target.id };
  }

  /*
    §13's own policy: never delete the latest version, never delete a
    profile's only version, never delete a version another version's
    parent_version_id still points to (would silently break lineage
    for whoever reads that chain later). All three checks run against
    freshly-read data; no caller-provided "I already checked" flag is
    trusted.
  */
  async deleteVersion(userId: string, profileId: string, versionId: string): Promise<void> {
    await requireOwnedProfile(this.repos, userId, profileId);

    const all = await this.repos.resumeVersions.listByProfileId(profileId);
    const target = all.find((v) => v.id === versionId);
    if (!target) throw new NotFoundError("Resume version");

    if (all.length === 1) throw new ValidationError(["cannot delete a profile's only resume version"]);

    const latest = await this.repos.resumeVersions.getLatestByProfileId(profileId);
    if (latest?.id === versionId) throw new ConflictError("cannot delete the latest resume version");

    const isReferencedAsParent = all.some((v) => v.parent_version_id === versionId);
    if (isReferencedAsParent) throw new SchemaGapError("VERSION_LINEAGE_DELETE_UNSUPPORTED", "deleting a version other versions reference as their parent would break lineage - not supported this round");

    await this.repos.resumeVersions.delete(versionId);
  }
}

export function assertValidReason(reason: string): asserts reason is ResumeVersionReason {
  if (!VALID_REASONS.includes(reason as ResumeVersionReason)) {
    throw new ValidationError([`reason must be one of ${VALID_REASONS.join("/")}`]);
  }
}
