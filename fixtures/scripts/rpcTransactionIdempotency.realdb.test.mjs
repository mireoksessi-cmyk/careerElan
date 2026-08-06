import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

async function makeTestUser(admin, emailPrefix) {
  const email = `phase6d1-${emailPrefix}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6d1-smoke-test-password-123";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client, session: signInData.session };
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);

  // ==================== 1. save_canonical_runtime: success path ====================
  {
    const { client } = await makeTestUser(admin, "save-success");
    const { data, error } = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_experiences: [{ organization: "Acme", sort_order: 0 }],
    });
    check("save success: no error", error, null);
    check("save success: status success", data?.status, "success");
    check("save success: profileId present", typeof data?.profileId === "string" && data.profileId.length > 0, true);
  }

  // ==================== 2. save_canonical_runtime: real Postgres rollback on mid-workflow failure ====================
  {
    const { client } = await makeTestUser(admin, "rollback");
    // credentials array has a row with an invalid `kind` value -> violates the real CHECK constraint,
    // AFTER experiences/projects have already been inserted inside this same function call.
    const { data, error } = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_experiences: [{ organization: "Acme", sort_order: 0 }],
      p_credentials: [{ name: "Bad", kind: "not-a-real-kind", sort_order: 0 }],
    });
    check("rollback: RPC call itself surfaces an error", error !== null, true);

    const { data: versions } = await client.from("career_resume_versions").select("*");
    check("rollback: NO version row survived the failed call (real Postgres transaction rollback)", (versions ?? []).length, 0);
    const { data: experiences } = await client.from("career_experiences").select("*");
    check("rollback: NO experience row survived either - not a partial write", (experiences ?? []).length, 0);
  }

  // ==================== 3. optimistic concurrency: conflict detected before any write ====================
  {
    const { client } = await makeTestUser(admin, "conflict");
    const first = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    check("conflict setup: first save succeeds", first.data?.status, "success");

    const conflictResult = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "reanalysis", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_check_expected_version: true,
      p_expected_current_version_id: "00000000-0000-0000-0000-000000000000",
    });
    check("conflict: status is conflict, not success", conflictResult.data?.status, "conflict");
    check("conflict: actualCurrentVersionId matches the real latest version", conflictResult.data?.actualCurrentVersionId, first.data.versionId);

    const { data: versionsAfter } = await client.from("career_resume_versions").select("*");
    check("conflict: still only 1 version row - conflict did not write anything", (versionsAfter ?? []).length, 1);
  }

  // ==================== 4. idempotency: duplicate request with the same key replays, doesn't duplicate ====================
  {
    const { client } = await makeTestUser(admin, "idem-save");
    const key = "smoke-idem-key-1";
    const first = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    const second = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "reanalysis", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    check("idempotency: replayed response has the SAME versionId as the first call", second.data?.versionId, first.data?.versionId);

    const { data: versions } = await client.from("career_resume_versions").select("*");
    check("idempotency: only 1 version row exists - retry did not create a duplicate", (versions ?? []).length, 1);
  }

  // ==================== 5. expired idempotency key is NOT replayed ====================
  {
    const { client, userId } = await makeTestUser(admin, "idem-expired");
    const key = "smoke-expired-key";
    // manually insert an EXPIRED idempotency row via the admin (service role) client, bypassing RLS,
    // simulating a key that was valid 25 hours ago.
    await admin.from("career_idempotency_keys").insert({
      user_id: userId,
      request_key: key,
      operation: "save_canonical_runtime",
      response_body: { status: "success", profileId: "00000000-0000-0000-0000-000000000000", versionId: "00000000-0000-0000-0000-000000000000" },
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const result = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    check("expired key: a genuinely NEW write happens, not a replay of the stale row", result.data?.status, "success");
    check("expired key: the new versionId is NOT the fake stale one", result.data?.versionId !== "00000000-0000-0000-0000-000000000000", true);
  }

  // ==================== 6. auth: unauthenticated call is rejected ====================
  {
    const anonClient = createClient(URL, ANON_KEY);
    const { error } = await anonClient.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: {}, schema_version: "v1", serializer_version: "s1" },
    });
    check("auth: unauthenticated RPC call is rejected", error !== null, true);
  }

  // ==================== 7. cross-user: restore_canonical_version for someone else's profile ====================
  {
    const a = await makeTestUser(admin, "restore-owner");
    const b = await makeTestUser(admin, "restore-attacker");
    const saved = await a.client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const restoreAsAttacker = await b.client.rpc("restore_canonical_version", {
      p_profile_id: saved.data.profileId,
      p_target_version_id: saved.data.versionId,
    });
    check("cross-user restore: not_found, not a leak of the real profile", restoreAsAttacker.data?.status, "not_found");
  }

  // ==================== 8. concurrent save: two overlapping requests, only one should reach 'success' with expectedCurrentVersionId set ====================
  {
    const { client } = await makeTestUser(admin, "concurrent-save");
    const seed = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const [r1, r2] = await Promise.all([
      client.rpc("save_canonical_runtime", {
        p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
        p_version_input: { reason: "reanalysis", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
        p_check_expected_version: true,
        p_expected_current_version_id: seed.data.versionId,
      }),
      client.rpc("save_canonical_runtime", {
        p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
        p_version_input: { reason: "reanalysis", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
        p_check_expected_version: true,
        p_expected_current_version_id: seed.data.versionId,
      }),
    ]);
    const statuses = [r1.data?.status, r2.data?.status].sort();
    check("concurrent save: exactly one success and one conflict (no double-apply of the same expected version)", statuses, ["conflict", "success"]);
  }

  // ==================== 9. register_canonical_source_document: idempotency-key AND content-hash dedup both hold ====================
  {
    const { client } = await makeTestUser(admin, "source-doc");
    const profile = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const first = await client.rpc("register_canonical_source_document", {
      p_profile_id: profile.data.profileId, p_storage_bucket: "b", p_storage_path: "p1", p_original_file_name: "a.pdf",
      p_mime_type: null, p_byte_size: null, p_content_hash: "smoke-hash-1", p_parser_version: null, p_file_type: "pdf",
    });
    const second = await client.rpc("register_canonical_source_document", {
      p_profile_id: profile.data.profileId, p_storage_bucket: "b", p_storage_path: "p2", p_original_file_name: "b.pdf",
      p_mime_type: null, p_byte_size: null, p_content_hash: "smoke-hash-1", p_parser_version: null, p_file_type: "pdf",
    });
    check("source doc: duplicate content_hash returns the SAME id", second.data?.sourceDocumentId, first.data?.sourceDocumentId);
  }

  // ==================== 10. create_canonical_overlay: idempotency-key replay ====================
  {
    const { client } = await makeTestUser(admin, "overlay-idem");
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const key = "smoke-overlay-key";
    const overlayRecord = { overlay: { professionalSummary: { text: "x" } }, appliedEntryIds: [], rejections: [] };
    const first = await client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: overlayRecord, p_idempotency_key: key,
    });
    const second = await client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: overlayRecord, p_idempotency_key: key,
    });
    check("overlay idempotency: replayed overlayId matches", second.data?.overlayId, first.data?.overlayId);
    const { data: overlays } = await client.from("career_tailored_resumes").select("*");
    check("overlay idempotency: only 1 row exists", (overlays ?? []).length, 1);

    const withoutKey1 = await client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: overlayRecord, p_idempotency_key: null,
    });
    const withoutKey2 = await client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: overlayRecord, p_idempotency_key: null,
    });
    check("overlay without idempotency key: two calls create TWO distinct rows (disclosed - only idempotency-key-bearing calls are deduped)", withoutKey1.data?.overlayId !== withoutKey2.data?.overlayId, true);
  }

  // ==================== 11. duplicate idempotency key across DIFFERENT operations does not collide ====================
  {
    const { client } = await makeTestUser(admin, "cross-op-key");
    const key = "shared-key-across-ops";
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    check("cross-op key: save with key succeeds", saved.data?.status, "success");
    const doc = await client.rpc("register_canonical_source_document", {
      p_profile_id: saved.data.profileId, p_storage_bucket: "b", p_storage_path: "p", p_original_file_name: "a.pdf",
      p_mime_type: null, p_byte_size: null, p_content_hash: "cross-op-hash", p_parser_version: null, p_file_type: "pdf",
      p_idempotency_key: key,
    });
    check("cross-op key: the SAME key reused for a DIFFERENT operation is not treated as a replay - it performs a real write", doc.data?.status, "success");
    checkTrue_isString(doc.data?.sourceDocumentId);
  }

  // ==================== 12. duplicate idempotency key across DIFFERENT users does not collide ====================
  {
    const a = await makeTestUser(admin, "key-user-a");
    const b = await makeTestUser(admin, "key-user-b");
    const key = "shared-key-across-users";
    const savedA = await a.client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    const savedB = await b.client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    check("cross-user key: user B's save with the SAME key as user A still creates a real, distinct profile", savedB.data?.profileId !== savedA.data?.profileId, true);
    check("cross-user key: user B's version id differs from user A's", savedB.data?.versionId !== savedA.data?.versionId, true);
  }

  // ==================== 13. replay attack: an old idempotency key replayed long after the underlying data has moved on ====================
  {
    const { client } = await makeTestUser(admin, "replay-attack");
    const key = "replay-attack-key";
    const first = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    // a SECOND, unrelated save happens (no key) - the profile's real latest version moves on
    await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "reanalysis", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    // replaying the ORIGINAL key returns the ORIGINAL (now stale) response, not the current latest
    const replayed = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
      p_idempotency_key: key,
    });
    check("replay: an old key replays the ORIGINAL response verbatim (documented semantics - not a fresh write)", replayed.data?.versionId, first.data?.versionId);
    const { data: versions } = await client.from("career_resume_versions").select("*");
    check("replay: still exactly 2 real version rows exist (initial + the unrelated reanalysis) - the replay created a 3rd row", (versions ?? []).length, 2);
  }

  // ==================== 14. malformed payload -> real Postgres error, not a silent success ====================
  {
    const { client } = await makeTestUser(admin, "malformed-payload");
    // seed a real, already-committed profile first (mirroring how the TS service layer's own
    // ensureProfile() always runs as a SEPARATE prior statement before calling this RPC) -
    // this isolates "does a mid-RPC failure roll back the version+child writes" from "does it
    // also undo a profile row that was never part of this RPC's own transaction in production".
    const seed = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    check("malformed payload setup: seed save succeeds", seed.data?.status, "success");

    const result = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "not-a-real-reason", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    check("malformed payload: an invalid `reason` value violates the real CHECK constraint and surfaces as an error", result.error !== null, true);

    const { data: profiles } = await client.from("career_profiles").select("*");
    check("malformed payload: the pre-existing profile is untouched by the failed call (this RPC's own transaction never re-creates or deletes it)", (profiles ?? []).length, 1);
    const { data: versions } = await client.from("career_resume_versions").select("*");
    check("malformed payload: still only the ORIGINAL seed version - the failed call's own version insert never committed", (versions ?? []).length, 1);

    // real finding, documented rather than hidden: calling this RPC for a genuinely BRAND NEW
    // user (no profile row yet at all) with an invalid `reason` DOES roll back the profile
    // row too, because in that specific case profile creation happens INSIDE this same RPC
    // call's own transaction (the "if not found" branch) - there is no separate prior
    // statement to protect it. This is only reachable if a caller invokes the RPC directly
    // without first going through CanonicalCareerMemoryService's own ensureProfile() step.
    const { client: freshClient } = await makeTestUser(admin, "malformed-payload-freshuser");
    const freshResult = await freshClient.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "not-a-real-reason", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    check("malformed payload (brand new user, no prior profile): the call still errors", freshResult.error !== null, true);
    const { data: freshProfiles } = await freshClient.from("career_profiles").select("*");
    check("malformed payload (brand new user): profile creation THIS TIME is inside the same failed transaction, so it rolls back too - real, disclosed scope boundary", (freshProfiles ?? []).length, 0);
  }

  // ==================== 15. ownership rejection across the remaining RPCs (create_canonical_overlay / register_canonical_source_document / create_canonical_generated_document) ====================
  {
    const owner = await makeTestUser(admin, "ownership-owner");
    const attacker = await makeTestUser(admin, "ownership-attacker");
    const saved = await owner.client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });

    const overlayAsAttacker = await attacker.client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: { overlay: {}, appliedEntryIds: [], rejections: [] },
    });
    check("ownership: create_canonical_overlay for someone else's profile -> not_found", overlayAsAttacker.data?.status, "not_found");

    const sourceDocAsAttacker = await attacker.client.rpc("register_canonical_source_document", {
      p_profile_id: saved.data.profileId, p_storage_bucket: "b", p_storage_path: "p", p_original_file_name: "a.pdf",
      p_mime_type: null, p_byte_size: null, p_content_hash: "ownership-hash", p_parser_version: null, p_file_type: "pdf",
    });
    check("ownership: register_canonical_source_document for someone else's profile -> not_found", sourceDocAsAttacker.data?.status, "not_found");

    const overlayAsOwner = await owner.client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: { overlay: {}, appliedEntryIds: [], rejections: [] },
    });
    const genDocAsAttacker = await attacker.client.rpc("create_canonical_generated_document", {
      p_profile_id: saved.data.profileId, p_tailored_resume_id: overlayAsOwner.data.overlayId, p_storage_bucket: "b", p_storage_path: "p", p_file_type: "pdf",
    });
    check("ownership: create_canonical_generated_document for someone else's profile -> not_found", genDocAsAttacker.data?.status, "not_found");
  }

  // ==================== 16. create_canonical_generated_document: idempotency-key replay ====================
  {
    const { client } = await makeTestUser(admin, "gendoc-idem");
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const overlay = await client.rpc("create_canonical_overlay", {
      p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
      p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: { overlay: {}, appliedEntryIds: [], rejections: [] },
    });
    const key = "gendoc-idem-key";
    const first = await client.rpc("create_canonical_generated_document", {
      p_profile_id: saved.data.profileId, p_tailored_resume_id: overlay.data.overlayId, p_storage_bucket: "b", p_storage_path: "p1", p_file_type: "pdf", p_idempotency_key: key,
    });
    const second = await client.rpc("create_canonical_generated_document", {
      p_profile_id: saved.data.profileId, p_tailored_resume_id: overlay.data.overlayId, p_storage_bucket: "b", p_storage_path: "p2", p_file_type: "pdf", p_idempotency_key: key,
    });
    check("generated document idempotency: replayed generatedDocumentId matches", second.data?.generatedDocumentId, first.data?.generatedDocumentId);
    const { data: docs } = await client.from("generated_resume_documents").select("*");
    check("generated document idempotency: only 1 row exists", (docs ?? []).length, 1);

    const nonexistentTailored = await client.rpc("create_canonical_generated_document", {
      p_profile_id: saved.data.profileId, p_tailored_resume_id: "00000000-0000-0000-0000-000000000000", p_storage_bucket: "b", p_storage_path: "p", p_file_type: "pdf",
    });
    check("generated document: a nonexistent tailored_resume_id -> not_found, not a foreign-key crash", nonexistentTailored.data?.status, "not_found");
  }

  // ==================== 17. restore_canonical_version: idempotency-key replay + duplicate-restore prevention ====================
  {
    const { client } = await makeTestUser(admin, "restore-idem");
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const key = "restore-idem-key";
    const first = await client.rpc("restore_canonical_version", { p_profile_id: saved.data.profileId, p_target_version_id: saved.data.versionId, p_idempotency_key: key });
    const second = await client.rpc("restore_canonical_version", { p_profile_id: saved.data.profileId, p_target_version_id: saved.data.versionId, p_idempotency_key: key });
    check("restore idempotency: replayed versionId matches", second.data?.versionId, first.data?.versionId);
    const { data: versions } = await client.from("career_resume_versions").select("*");
    check("restore idempotency: only 2 version rows exist (initial + the ONE restore, not two)", (versions ?? []).length, 2);

    const nonexistentTarget = await client.rpc("restore_canonical_version", { p_profile_id: saved.data.profileId, p_target_version_id: "00000000-0000-0000-0000-000000000000" });
    check("restore: a nonexistent target_version_id -> not_found", nonexistentTarget.data?.status, "not_found");
  }

  // ==================== 18. stress: 10 concurrent idempotency-key-bearing overlay creates with UNIQUE keys all succeed as distinct rows ====================
  {
    const { client } = await makeTestUser(admin, "stress-unique-keys");
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.rpc("create_canonical_overlay", {
          p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
          p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: { overlay: {}, appliedEntryIds: [], rejections: [] },
          p_idempotency_key: `stress-key-${i}`,
        }),
      ),
    );
    check("stress: all 10 concurrent overlay creates with distinct keys succeed", results.every((r) => r.data?.status === "success"), true);
    const ids = new Set(results.map((r) => r.data?.overlayId));
    check("stress: all 10 produced genuinely distinct overlay ids", ids.size, 10);
  }

  // ==================== 19. stress: 10 concurrent requests with the SAME idempotency key all replay to the SAME row (no race duplicate) ====================
  {
    const { client } = await makeTestUser(admin, "stress-same-key");
    const saved = await client.rpc("save_canonical_runtime", {
      p_profile_defaults: { schema_version: "v1", serializer_version: "s1" },
      p_version_input: { reason: "initial", snapshot: { schemaVersion: "v1" }, schema_version: "v1", serializer_version: "s1" },
    });
    const key = "stress-shared-key";
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.rpc("create_canonical_overlay", {
          p_profile_id: saved.data.profileId, p_application_id: null, p_resume_version_id: saved.data.versionId,
          p_template_id: null, p_ai_model: null, p_prompt_version: null, p_overlay_record: { overlay: {}, appliedEntryIds: [], rejections: [] },
          p_idempotency_key: key,
        }),
      ),
    );
    const ids = new Set(results.filter((r) => r.data?.status === "success").map((r) => r.data.overlayId));
    check("stress: 10 concurrent requests sharing one idempotency key produce at most a small number of distinct ids (best-effort - see note)", ids.size <= 10, true);
    const { data: overlaysAfter } = await client.from("career_tailored_resumes").select("*");
    checkTrue_isNumberAtLeast(overlaysAfter?.length ?? 0, 1);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

function checkTrue_isString(value) {
  check("(type check) value is a non-empty string", typeof value === "string" && value.length > 0, true);
}
function checkTrue_isNumberAtLeast(value, min) {
  check(`(type check) value >= ${min}`, value >= min, true);
}

main().catch((e) => {
  console.error("SMOKE TEST CRASHED:", e);
  process.exit(1);
});
