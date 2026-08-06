/*
  Phase 6D gate test - concrete repository behavior against
  FakeSupabaseClient. Run with
  `npx tsx lib/careerMemory/repositories/repositories.test.ts`. Proves
  the repository CALLS the right query chain and handles {data, error}
  correctly - does NOT prove real PostgREST wire compatibility (see
  fakeSupabaseClient.ts's own header comment - REMOTE_DB_E2E_NOT_VERIFIED).
*/
import { createFakeCareerMemorySupabaseClient } from "./testSupport/fakeSupabaseClient";
import { createCanonicalRepositories } from "./createRepositories";
import { ConflictError } from "../errors/domainErrors";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}
async function expectThrows(label: string, fn: () => Promise<unknown>, ctor: new (...args: never[]) => Error) {
  try {
    await fn();
    check(label, "did not throw", `${ctor.name} thrown`);
  } catch (e) {
    checkTrue(label, e instanceof ctor);
  }
}

function freshRepos() {
  const client = createFakeCareerMemorySupabaseClient();
  return { client, repos: createCanonicalRepositories(client as never) };
}

async function main() {
  // ==================== 2. Profile CRUD ====================
  {
    const { repos } = freshRepos();
    const created = await repos.profiles.insert({ user_id: "user-1", schema_version: "v1", serializer_version: "career-memory-runtime-v1" });
    checkTrue("profile insert: returns a row with generated id", created.id.length > 0);
    check("profile insert: user_id preserved", created.user_id, "user-1");

    const byId = await repos.profiles.getById(created.id);
    check("profile getById: finds the row", byId?.id, created.id);

    const byUser = await repos.profiles.getByUserId("user-1");
    check("profile getByUserId: finds the row", byUser?.id, created.id);

    const missing = await repos.profiles.getByUserId("nonexistent-user");
    check("profile getByUserId: null for unknown user", missing, null);

    const updated = await repos.profiles.update(created.id, { summary_text: "Updated summary." });
    check("profile update: applies partial patch", updated.summary_text, "Updated summary.");

    await repos.profiles.delete(created.id);
    const afterDelete = await repos.profiles.getById(created.id);
    check("profile delete: row removed", afterDelete, null);
  }

  // ==================== duplicate user_id (query shape: unique constraint) ====================
  {
    const { repos } = freshRepos();
    await repos.profiles.insert({ user_id: "user-dup", schema_version: "v1", serializer_version: "s1" });
    await expectThrows("profile insert: duplicate user_id rejected as ConflictError", () => repos.profiles.insert({ user_id: "user-dup", schema_version: "v1", serializer_version: "s1" }), ConflictError);
  }

  // ==================== 3. Source document metadata ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-2", schema_version: "v1", serializer_version: "s1" });
    const doc = await repos.sourceDocuments.insert({ profile_id: profile.id, storage_bucket: "resume-sources", storage_path: `${profile.id}/doc-1/original.pdf`, original_file_name: "resume.pdf", content_hash: "abc123def456", file_type: "pdf" });
    check("source document insert: analysis_status defaults to pending", doc.analysis_status, "pending");
    check("source document insert: file_type preserved", doc.file_type, "pdf");

    const listed = await repos.sourceDocuments.listByProfileId(profile.id);
    check("source document listByProfileId: returns 1 row", listed.length, 1);
  }

  // ==================== 4. Content-hash lookup ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-3", schema_version: "v1", serializer_version: "s1" });
    const doc = await repos.sourceDocuments.insert({ profile_id: profile.id, storage_bucket: "b", storage_path: "p", original_file_name: "f.pdf", content_hash: "hash-xyz", file_type: "pdf" });

    const found = await repos.sourceDocuments.findByContentHash(profile.id, "hash-xyz");
    check("source document findByContentHash: finds the matching row", found?.id, doc.id);

    const notFound = await repos.sourceDocuments.findByContentHash(profile.id, "hash-does-not-exist");
    check("source document findByContentHash: null for unknown hash", notFound, null);

    await expectThrows("source document insert: duplicate (profile_id, content_hash) rejected", () => repos.sourceDocuments.insert({ profile_id: profile.id, storage_bucket: "b", storage_path: "p2", original_file_name: "f2.pdf", content_hash: "hash-xyz", file_type: "pdf" }), ConflictError);
  }

  // ==================== 5. Analysis status transition ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-4", schema_version: "v1", serializer_version: "s1" });
    const doc = await repos.sourceDocuments.insert({ profile_id: profile.id, storage_bucket: "b", storage_path: "p", original_file_name: "f.pdf", content_hash: "h1", file_type: "pdf" });

    const processing = await repos.sourceDocuments.updateAnalysisStatus(doc.id, "processing");
    check("source document status transition: pending -> processing", processing.analysis_status, "processing");
    const succeeded = await repos.sourceDocuments.updateAnalysisStatus(doc.id, "succeeded");
    check("source document status transition: processing -> succeeded", succeeded.analysis_status, "succeeded");
  }

  // ==================== 6. Version create/list/latest ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-5", schema_version: "v1", serializer_version: "s1" });
    const v1 = await repos.resumeVersions.insert({ profile_id: profile.id, reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1", created_at: "2026-01-01T00:00:00.000Z" });
    const v2 = await repos.resumeVersions.insert({ profile_id: profile.id, reason: "reanalysis", parent_version_id: v1.id, snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1", created_at: "2026-01-02T00:00:00.000Z" });

    const latest = await repos.resumeVersions.getLatestByProfileId(profile.id);
    check("resume version getLatestByProfileId: returns the most recent", latest?.id, v2.id);

    const listed = await repos.resumeVersions.listByProfileId(profile.id);
    check("resume version listByProfileId: returns both, newest first", listed.map((v) => v.id), [v2.id, v1.id]);

    checkTrue("resume version: no update() method on the interface (append-only)", !("update" in repos.resumeVersions));
  }

  // ==================== 1. Repository query shape - entry tables (experiences/projects/credentials/awards/publications) ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-6", schema_version: "v1", serializer_version: "s1" });

    const exp1 = await repos.experiences.insert({ profile_id: profile.id, organization: "Acme", sort_order: 1 });
    const exp2 = await repos.experiences.insert({ profile_id: profile.id, organization: "Beta", sort_order: 0 });
    const listedExp = await repos.experiences.listByProfileId(profile.id);
    check("experience listByProfileId: ordered by sort_order ascending", listedExp.map((e) => e.organization), ["Beta", "Acme"]);

    const replaced = await repos.experiences.replaceForProfile(profile.id, [{ profile_id: profile.id, organization: "Gamma", sort_order: 0 }]);
    check("experience replaceForProfile: replaces the full set", replaced.length, 1);
    const afterReplace = await repos.experiences.listByProfileId(profile.id);
    check("experience replaceForProfile: old rows gone, only new set remains", afterReplace.map((e) => e.organization), ["Gamma"]);

    await repos.experiences.deleteByProfileId(profile.id);
    const afterDelete = await repos.experiences.listByProfileId(profile.id);
    check("experience deleteByProfileId: all rows removed", afterDelete.length, 0);

    void exp1;
    void exp2;

    const proj = await repos.projects.insert({ profile_id: profile.id, name: "ERP Migration", sort_order: 0 });
    checkTrue("project insert: row created", proj.id.length > 0);
    const cred = await repos.credentials.insert({ profile_id: profile.id, name: "PMP", kind: "certification", sort_order: 0 });
    check("credential insert: kind preserved", cred.kind, "certification");
    const award = await repos.awards.insert({ profile_id: profile.id, name: "MVP 2021", sort_order: 0 });
    checkTrue("award insert: row created", award.id.length > 0);
    const pub = await repos.publications.insert({ profile_id: profile.id, title: "Resilient Supply Chains", sort_order: 0 });
    checkTrue("publication insert: row created", pub.id.length > 0);
  }

  // ==================== career_languages/career_tailored_resumes/career_user_edits/generated_resume_documents ====================
  {
    const { repos } = freshRepos();
    const profile = await repos.profiles.insert({ user_id: "user-7", schema_version: "v1", serializer_version: "s1" });

    const lang = await repos.languages.insert({ profile_id: profile.id, name: "French", proficiency: "Native", sort_order: 0 });
    check("language insert: proficiency preserved", lang.proficiency, "Native");

    const version = await repos.resumeVersions.insert({ profile_id: profile.id, reason: "initial", snapshot: {}, schema_version: "v1", serializer_version: "s1" });
    const overlay = await repos.tailoredResumes.insert({ profile_id: profile.id, resume_version_id: version.id, overlay: { overlay: { schemaVersion: "v1" }, appliedEntryIds: [], rejections: [] } });
    checkTrue("tailored resume insert: row created", overlay.id.length > 0);
    checkTrue("tailored resume: no canonical-row-mutation method beyond update() for metadata", "update" in repos.tailoredResumes);

    const edit = await repos.userEdits.insert({ profile_id: profile.id, target_table: "career_experiences", target_id: "exp-1", field_path: "role", previous_value: "Coordinator", new_value: "Senior Coordinator" });
    checkTrue("user edit insert: row created", edit.id.length > 0);
    checkTrue("user edit: no update() method (append-only)", !("update" in repos.userEdits));
    checkTrue("user edit: no delete() method (append-only)", !("delete" in repos.userEdits));

    const generated = await repos.generatedResumeDocuments.insert({ tailored_resume_id: overlay.id, storage_bucket: "generated-resumes", storage_path: `${profile.id}/${overlay.id}/resume.pdf`, file_type: "pdf" });
    checkTrue("generated document insert: row created", generated.id.length > 0);
    const listedGenerated = await repos.generatedResumeDocuments.listByTailoredResumeId(overlay.id);
    check("generated document listByTailoredResumeId: returns 1 row", listedGenerated.length, 1);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
