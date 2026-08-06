/*
  Phase 6D - User Edit Service. Field-level edit provenance,
  append-only (§15's own instruction - no update/delete method exists
  anywhere in this file, matching CareerUserEditRepository's own
  append-only base interface).

  IDEMPOTENCY_SCHEMA_GAP (disclosed): career_user_edits has no
  idempotency-key column, so a retried recordEdit() call after a
  network timeout (client never saw the success response) creates a
  second, duplicate audit row - there is no way to detect "this exact
  edit was already recorded" from the schema alone. See the Phase 6D
  final report's "Idempotency Strategy" section.

  TRANSACTION NOTE: §15 asks for user-edit rows to be created "in the
  same transaction as the real canonical change" - this service's
  recordEdit() is a single-table insert with no atomicity problem BY
  ITSELF, but when a caller uses it to describe a field that changed as
  part of a canonical save, the two writes (the save + this edit
  record) are NOT bundled atomically this round (same
  TRANSACTION_SCHEMA_GAP as saveCanonicalRuntime() - see
  transactions/README.md). Disclosed here rather than only in that
  other file, since a reader of THIS file is exactly who would assume
  otherwise.
*/
import { NotFoundError, ValidationError } from "../errors/domainErrors";
import type { CareerUserEditRow } from "../persistence/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { requireOwnedProfile } from "./profileAccess";

export type RecordUserEditInput = {
  profileId: string;
  targetTable: string;
  targetId: string;
  fieldPath: string;
  previousValue?: unknown;
  newValue?: unknown;
  editedAt?: string;
};

const KNOWN_TARGET_TABLES = new Set(["career_profiles", "career_experiences", "career_languages", "career_projects", "career_credentials", "career_awards", "career_publications"]);

export class CanonicalUserEditService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  async recordEdit(userId: string, input: RecordUserEditInput): Promise<CareerUserEditRow> {
    await requireOwnedProfile(this.repos, userId, input.profileId);

    if (!KNOWN_TARGET_TABLES.has(input.targetTable)) throw new ValidationError([`targetTable "${input.targetTable}" is not a recognized canonical table`]);
    if (!input.targetId || input.targetId.trim().length === 0) throw new ValidationError(["targetId must be non-empty"]);
    if (!input.fieldPath || input.fieldPath.trim().length === 0) throw new ValidationError(["fieldPath must be non-empty"]);

    return this.repos.userEdits.insert({
      profile_id: input.profileId,
      target_table: input.targetTable,
      target_id: input.targetId,
      field_path: input.fieldPath,
      previous_value: input.previousValue === undefined ? null : input.previousValue,
      new_value: input.newValue === undefined ? null : input.newValue,
      edited_at: input.editedAt,
    });
  }

  async listEdits(userId: string, profileId: string): Promise<CareerUserEditRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    return this.repos.userEdits.listByProfileId(profileId);
  }

  async listEditsForTarget(userId: string, profileId: string, targetTable: string, targetId: string): Promise<CareerUserEditRow[]> {
    await requireOwnedProfile(this.repos, userId, profileId);
    const all = await this.repos.userEdits.listByTarget(targetTable, targetId);
    const belongsToProfile = all.filter((e) => e.profile_id === profileId);
    if (belongsToProfile.length !== all.length) {
      throw new NotFoundError("User edit target");
    }
    return belongsToProfile;
  }
}
