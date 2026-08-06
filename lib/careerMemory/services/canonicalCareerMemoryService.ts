/*
  Phase 6D - the main orchestrator. getCanonicalRuntime() is a pure
  read (safe, no transaction gap). saveCanonicalRuntime() is the one
  operation with a real TRANSACTION_SCHEMA_GAP (1 version row + up to 6
  child tables, no atomic multi-table primitive available without a
  migration change - see transactions/README.md) - it is NOT exported
  as the "normal" entry point; callers must go through
  saveCanonicalRuntimeAcknowledgingGap() and pass an explicit
  acknowledgement, matching the API route's own
  `x-canonical-write-ack` header gate. This file never imports
  Generate Package, Template, or Professional ATS renderer code (§7's
  own "Service가 Template 또는 Generate Package를 호출하면 안 된다").
*/
import { ConflictError, NotFoundError, ValidationError } from "../errors/domainErrors";
import { runWithCompensatingRollback, toPersistenceError } from "../transactions/compensatingRollback";
import { canonicalRuntimeToInsertBundle, careerProfileToCanonicalRuntime, runtimeToCareerResumeVersionInsertInput } from "../persistence/mappers";
import { validateCanonicalCoverage, validatePersistenceBundle, validateRuntimeRoundTrip } from "../persistence/validation";
import type { CareerMemoryPersistenceBundle } from "../persistence/bundle";
import type { CareerExperienceInsertInput, CareerExperienceRow, CareerResumeVersionRow } from "../persistence/types";
import type { CanonicalResumeRuntime } from "../runtime/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import { ensureProfile, requireOwnedProfile } from "./profileAccess";

export type SaveCanonicalRuntimeInput = {
  runtime: CanonicalResumeRuntime;
  expectedCurrentVersionId?: string | null;
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
    TRANSACTION_SCHEMA_GAP - see transactions/README.md.
    ============================================================
    Steps 1-13 below match the Phase 6D design report's own
    saveCanonicalRuntime() workflow numbering. Steps 7-9 (version
    insert + six child-table replace) run through
    runWithCompensatingRollback() - best-effort, NOT atomic. This
    method is intentionally NOT the default write path callers reach
    without an explicit acknowledgement - see
    app/api/internal/canonical-career-memory/versions/route.ts's own
    `x-canonical-write-ack` header requirement.
  */
  async saveCanonicalRuntimeAcknowledgingGap(userId: string, input: SaveCanonicalRuntimeInput): Promise<SaveCanonicalRuntimeResult> {
    // 1. Runtime validation
    const coverage = validateCanonicalCoverage(input.runtime.resume);
    if (!coverage.valid) throw new ValidationError(coverage.errors);

    // 2. profile lookup/create
    const profile = await ensureProfile(this.repos, userId, { schemaVersion: input.runtime.metadata.schemaVersion, serializerVersion: input.runtime.metadata.serializerVersion });

    // 3. ownership - trivially satisfied (profile was fetched/created by userId), re-asserted for defense-in-depth
    await requireOwnedProfile(this.repos, userId, profile.id);

    // 4. latest version lookup
    const currentLatest = await this.repos.resumeVersions.getLatestByProfileId(profile.id);

    // 5. optimistic concurrency
    if (input.expectedCurrentVersionId !== undefined) {
      const actualId = currentLatest?.id ?? null;
      if (actualId !== input.expectedCurrentVersionId) {
        throw new ConflictError(`expectedCurrentVersionId "${input.expectedCurrentVersionId}" does not match the actual latest version "${actualId}".`);
      }
    }

    // 6. source document relationship check
    const latestSourceDocId = input.runtime.sourceDocuments.length > 0 ? input.runtime.sourceDocuments[input.runtime.sourceDocuments.length - 1].id : null;
    if (latestSourceDocId) {
      const doc = await this.repos.sourceDocuments.getById(latestSourceDocId);
      if (!doc || doc.profile_id !== profile.id) throw new NotFoundError("Source document referenced by runtime.sourceDocuments");
    }

    const insertBundle = canonicalRuntimeToInsertBundle(userId, profile.id, input.runtime);
    const versionInput = runtimeToCareerResumeVersionInsertInput(profile.id, input.runtime);
    versionInput.parent_version_id = currentLatest?.id ?? null;

    // capture pre-write state for best-effort rollback
    const previousExperiences = await this.repos.experiences.listByProfileId(profile.id);
    const previousProjects = await this.repos.projects.listByProfileId(profile.id);
    const previousCredentials = await this.repos.credentials.listByProfileId(profile.id);
    const previousAwards = await this.repos.awards.listByProfileId(profile.id);
    const previousPublications = await this.repos.publications.listByProfileId(profile.id);

    const rollbackResult = await runWithCompensatingRollback<{ version: CareerResumeVersionRow; experiences: CareerExperienceRow[] }>(
      "saveCanonicalRuntime",
      [
        async () => {
          const version = await this.repos.resumeVersions.insert(versionInput);
          return { value: version, compensate: async () => this.repos.resumeVersions.delete(version.id) };
        },
        async () => {
          const rows = await this.repos.experiences.replaceForProfile(profile.id, insertBundle.experiences);
          return { value: rows, compensate: async () => void (await this.repos.experiences.replaceForProfile(profile.id, toReplayInput(previousExperiences))) };
        },
        async () => {
          const rows = await this.repos.projects.replaceForProfile(profile.id, insertBundle.projects);
          return { value: rows, compensate: async () => void (await this.repos.projects.replaceForProfile(profile.id, toReplayInput(previousProjects))) };
        },
        async () => {
          const rows = await this.repos.credentials.replaceForProfile(profile.id, insertBundle.credentials);
          return { value: rows, compensate: async () => void (await this.repos.credentials.replaceForProfile(profile.id, toReplayInput(previousCredentials))) };
        },
        async () => {
          const rows = await this.repos.awards.replaceForProfile(profile.id, insertBundle.awards);
          return { value: rows, compensate: async () => void (await this.repos.awards.replaceForProfile(profile.id, toReplayInput(previousAwards))) };
        },
        async () => {
          const rows = await this.repos.publications.replaceForProfile(profile.id, insertBundle.publications);
          return { value: rows, compensate: async () => void (await this.repos.publications.replaceForProfile(profile.id, toReplayInput(previousPublications))) };
        },
      ],
      (values) => ({ version: values[0] as CareerResumeVersionRow, experiences: values[1] as CareerExperienceRow[] }),
    );

    if (!rollbackResult.ok) {
      throw toPersistenceError("saveCanonicalRuntime", rollbackResult.error);
    }

    // 10. user edit/reason metadata: intentionally NOT auto-recorded here -
    // see canonicalUserEditService.ts's own header comment on why a whole-
    // resume save does not fabricate field-level diffs.

    // 11-12. re-fetch + round-trip validation
    const reconstructed = await this.getCanonicalRuntime(userId);
    if (!reconstructed) throw toPersistenceError("saveCanonicalRuntime", new Error("post-save re-fetch returned null"));

    const roundTrip = validateRuntimeRoundTrip(input.runtime, reconstructed);

    const bundle: CareerMemoryPersistenceBundle = {
      profile,
      sourceDocuments: await this.repos.sourceDocuments.listByProfileId(profile.id),
      latestVersion: rollbackResult.value.version,
      experiences: rollbackResult.value.experiences,
      languages: await this.repos.languages.listByProfileId(profile.id),
      projects: await this.repos.projects.listByProfileId(profile.id),
      credentials: await this.repos.credentials.listByProfileId(profile.id),
      awards: await this.repos.awards.listByProfileId(profile.id),
      publications: await this.repos.publications.listByProfileId(profile.id),
      tailoredResumes: await this.repos.tailoredResumes.listByProfileId(profile.id),
    };
    const bundleValidity = validatePersistenceBundle(bundle);
    if (!bundleValidity.valid) throw toPersistenceError("saveCanonicalRuntime.postWriteBundleValidation", new Error(bundleValidity.errors.join("; ")));

    // 13. "commit" - nothing more to do; the writes already happened
    return { runtime: reconstructed, version: rollbackResult.value.version, roundTripValid: roundTrip.valid };
  }
}

function toReplayInput<T extends { id: string; profile_id: string; created_at: string; updated_at: string }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r })) as T[];
}
