/*
  Phase 6D.1 - the main orchestrator. getCanonicalRuntime() is a pure
  read (safe, no transaction gap). saveCanonicalRuntime() persists the
  full bundle (1 version row + up to 5 child-table replacements) through
  a single call to the save_canonical_runtime() SQL RPC (see
  supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql) -
  real Postgres transaction semantics now back this write: any failure
  partway through rolls back everything the RPC had already written,
  closing the Phase 6D report's own disclosed TRANSACTION_SCHEMA_GAP.
  The Phase 6D compensating-rollback approach (Option A) has been
  removed - see transactions/README.md's updated status. This file
  never imports Generate Package, Template, or Professional ATS
  renderer code (§7's own "Service가 Template 또는 Generate Package를
  호출하면 안 된다").
*/
import { ConflictError, NotFoundError, ValidationError } from "../errors/domainErrors";
import { canonicalRuntimeToInsertBundle, careerProfileToCanonicalRuntime } from "../persistence/mappers";
import { validateCanonicalCoverage, validatePersistenceBundle, validateRuntimeRoundTrip } from "../persistence/validation";
import type { CareerMemoryPersistenceBundle } from "../persistence/bundle";
import type { CareerResumeVersionRow } from "../persistence/types";
import type { CanonicalResumeRuntime } from "../runtime/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { ensureProfile, requireOwnedProfile } from "./profileAccess";
import { toPersistenceError } from "../errors/persistenceHelpers";

export type SaveCanonicalRuntimeInput = {
  runtime: CanonicalResumeRuntime;
  expectedCurrentVersionId?: string | null;
  idempotencyKey?: string | null;
};

export type SaveCanonicalRuntimeResult = {
  runtime: CanonicalResumeRuntime;
  version: CareerResumeVersionRow;
  roundTripValid: boolean;
};

export class CanonicalCareerMemoryService {
  constructor(private readonly repos: CanonicalRepositoryBundle) {}

  async getCanonicalRuntime(userId: string): Promise<CanonicalResumeRuntime | null> {
    const profile = await this.repos.profiles.getByUserId(userId);
    if (!profile) return null;

    const latestVersion = await this.repos.resumeVersions.getLatestByProfileId(profile.id);
    if (!latestVersion) return null;

    const sourceDocuments = await this.repos.sourceDocuments.listByProfileId(profile.id);
    const tailoredResumes = await this.repos.tailoredResumes.listByProfileId(profile.id);
    const [experiences, languages, projects, credentials, awards, publications] = await Promise.all([
      this.repos.experiences.listByProfileId(profile.id),
      this.repos.languages.listByProfileId(profile.id),
      this.repos.projects.listByProfileId(profile.id),
      this.repos.credentials.listByProfileId(profile.id),
      this.repos.awards.listByProfileId(profile.id),
      this.repos.publications.listByProfileId(profile.id),
    ]);

    const bundle: CareerMemoryPersistenceBundle = { profile, sourceDocuments, latestVersion, experiences, languages, projects, credentials, awards, publications, tailoredResumes };
    return careerProfileToCanonicalRuntime(bundle);
  }

  /*
    ============================================================
    Phase 6D.1 - the 1 version row + up to 5 child-table replacement
    now runs as ONE call to the save_canonical_runtime() SQL RPC (see
    supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql) -
    real Postgres transaction semantics: any failure inside that single
    function invocation rolls back every write it had already made this
    call. Steps 1-13 below still match the Phase 6D design report's own
    saveCanonicalRuntime() numbering; steps 4/5/7-9 are now delegated to
    the RPC itself rather than performed here.
  */
  async saveCanonicalRuntimeAcknowledgingGap(userId: string, input: SaveCanonicalRuntimeInput): Promise<SaveCanonicalRuntimeResult> {
    // 1. Runtime validation
    const coverage = validateCanonicalCoverage(input.runtime.resume);
    if (!coverage.valid) throw new ValidationError(coverage.errors);

    // 2. profile lookup/create
    const profile = await ensureProfile(this.repos, userId, { schemaVersion: input.runtime.metadata.schemaVersion, serializerVersion: input.runtime.metadata.serializerVersion });

    // 3. ownership - trivially satisfied (profile was fetched/created by userId), re-asserted for defense-in-depth
    await requireOwnedProfile(this.repos, userId, profile.id);

    // 6. source document relationship check (validation, not part of the atomic write itself)
    const latestSourceDocId = input.runtime.sourceDocuments.length > 0 ? input.runtime.sourceDocuments[input.runtime.sourceDocuments.length - 1].id : null;
    if (latestSourceDocId) {
      const doc = await this.repos.sourceDocuments.getById(latestSourceDocId);
      if (!doc || doc.profile_id !== profile.id) throw new NotFoundError("Source document referenced by runtime.sourceDocuments");
    }

    const insertBundle = canonicalRuntimeToInsertBundle(userId, profile.id, input.runtime);

    // 4/5/7-9. optimistic concurrency + atomic version insert + child-table replace, all inside the RPC
    const rpcResult = await this.repos.transactions.saveCanonicalRuntime({
      profileDefaults: { schemaVersion: input.runtime.metadata.schemaVersion, serializerVersion: input.runtime.metadata.serializerVersion },
      versionInput: insertBundle.resumeVersion,
      experiences: insertBundle.experiences,
      projects: insertBundle.projects,
      credentials: insertBundle.credentials,
      awards: insertBundle.awards,
      publications: insertBundle.publications,
      checkExpectedVersion: input.expectedCurrentVersionId !== undefined,
      expectedCurrentVersionId: input.expectedCurrentVersionId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    if (rpcResult.status === "conflict") {
      throw new ConflictError(`expectedCurrentVersionId "${rpcResult.expectedCurrentVersionId}" does not match the actual latest version "${rpcResult.actualCurrentVersionId}".`);
    }

    // 10. user edit/reason metadata: intentionally NOT auto-recorded here -
    // see canonicalUserEditService.ts's own header comment on why a whole-
    // resume save does not fabricate field-level diffs.

    // 11-12. re-fetch + round-trip validation
    const reconstructed = await this.getCanonicalRuntime(userId);
    if (!reconstructed) throw toPersistenceError("saveCanonicalRuntime", new Error("post-save re-fetch returned null"));

    const roundTrip = validateRuntimeRoundTrip(input.runtime, reconstructed);

    const latestVersion = await this.repos.resumeVersions.getById(rpcResult.versionId);
    if (!latestVersion) throw toPersistenceError("saveCanonicalRuntime", new Error("post-save re-fetch of the written version returned null"));

    const bundle: CareerMemoryPersistenceBundle = {
      profile,
      sourceDocuments: await this.repos.sourceDocuments.listByProfileId(profile.id),
      latestVersion,
      experiences: await this.repos.experiences.listByProfileId(profile.id),
      languages: await this.repos.languages.listByProfileId(profile.id),
      projects: await this.repos.projects.listByProfileId(profile.id),
      credentials: await this.repos.credentials.listByProfileId(profile.id),
      awards: await this.repos.awards.listByProfileId(profile.id),
      publications: await this.repos.publications.listByProfileId(profile.id),
      tailoredResumes: await this.repos.tailoredResumes.listByProfileId(profile.id),
    };
    const bundleValidity = validatePersistenceBundle(bundle);
    if (!bundleValidity.valid) throw toPersistenceError("saveCanonicalRuntime.postWriteBundleValidation", new Error(bundleValidity.errors.join("; ")));

    // 13. "commit" - nothing more to do; the RPC's own transaction already committed
    return { runtime: reconstructed, version: latestVersion, roundTripValid: roundTrip.valid };
  }
}
