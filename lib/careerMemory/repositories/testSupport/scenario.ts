/*
  Phase 6D - shared test scenario builder. Seeds a FakeSupabaseClient
  with a profile + one resume version (using the SAME hand-authored
  fixture Phase 6C's own tests use, imported verbatim - never
  re-derived) so every Phase 6D test file starts from one consistent,
  known-good baseline instead of re-writing its own bootstrap.
*/
import { createFakeCareerMemorySupabaseClient, type FakeSupabaseClient } from "./fakeSupabaseClient";
import { createCanonicalRepositories, type CanonicalRepositoryBundle } from "../createRepositories";
import { canonicalRuntimeToInsertBundle } from "../../persistence/mappers";
import { buildFixtureRuntime } from "../../persistence/testFixtures";
import type { CanonicalResumeRuntime } from "../../runtime/types";

export type TestScenario = {
  client: FakeSupabaseClient;
  repos: CanonicalRepositoryBundle;
  userId: string;
  profileId: string;
  runtime: CanonicalResumeRuntime;
};

export async function buildSeededScenario(userId = "user-1"): Promise<TestScenario> {
  const client = createFakeCareerMemorySupabaseClient();
  client.setCurrentUser({ id: userId });
  const repos = createCanonicalRepositories(client as never);

  const runtime = buildFixtureRuntime();
  const profile = await repos.profiles.insert({ user_id: userId, schema_version: runtime.metadata.schemaVersion, serializer_version: runtime.metadata.serializerVersion, identity: runtime.resume.identity ? JSON.parse(JSON.stringify(runtime.resume.identity)) : {}, summary_text: runtime.resume.professionalSummary?.text ?? null });

  const insertBundle = canonicalRuntimeToInsertBundle(userId, profile.id, runtime);
  const version = await repos.resumeVersions.insert(insertBundle.resumeVersion);
  await repos.experiences.replaceForProfile(profile.id, insertBundle.experiences);
  await repos.projects.replaceForProfile(profile.id, insertBundle.projects);
  await repos.credentials.replaceForProfile(profile.id, insertBundle.credentials);
  await repos.awards.replaceForProfile(profile.id, insertBundle.awards);
  await repos.publications.replaceForProfile(profile.id, insertBundle.publications);

  for (const doc of runtime.sourceDocuments) {
    await repos.sourceDocuments.insert({
      id: doc.id,
      profile_id: profile.id,
      storage_bucket: "resume-sources",
      storage_path: `${profile.id}/${doc.id}/original.${doc.fileType}`,
      original_file_name: doc.fileName,
      content_hash: doc.contentHash ?? null,
      parser_version: doc.fileType === "pdf" ? "pdf-parser-v3" : "docx-parser-v1",
      file_type: doc.fileType,
      created_at: doc.addedAt,
    });
  }

  return { client, repos, userId, profileId: profile.id, runtime: { ...runtime, version: { ...runtime.version, id: version.id } } };
}

export function createBareScenario(userId = "user-2"): { client: FakeSupabaseClient; repos: CanonicalRepositoryBundle; userId: string } {
  const client = createFakeCareerMemorySupabaseClient();
  client.setCurrentUser({ id: userId });
  const repos = createCanonicalRepositories(client as never);
  return { client, repos, userId };
}
