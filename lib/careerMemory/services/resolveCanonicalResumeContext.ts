/*
  Phase 6I.6 - Selected Resume <-> Canonical Version Binding.

  The single shared resolver every canonical surface that needs "which
  resume version should this render/generate from" must go through,
  replacing the pre-existing ad hoc pattern of calling
  getCanonicalRuntime(userId)/getCanonicalRuntimeViaServiceRole(userId)
  directly and always landing on the profile's globally-latest version
  regardless of what career_memory.selected_resume_id actually says (the
  gap this round's audit confirmed at resume-preview/route.ts:102 and
  canonicalGeneratePackageService.ts:85).

  Resume identity and template identity are separate axes (§13's own
  orthogonality requirement, already correctly upheld by
  applicationTemplateResolver.ts - this file never touches templates).

  Resolution is READ-ONLY by design: it never calls
  CanonicalResumeImportService.importResume() or writes a new
  career_resume_versions row as a side effect of merely resolving a
  preview/generation target. That matters specifically when the
  selected resume is NOT the profile's current latest (e.g. the user
  selected an older upload while a newer one exists) - re-running
  import() in that situation would create a brand-new version and
  silently re-promote the selection to "latest", changing what every
  OTHER canonical surface renders as a side effect of one preview call.
  Instead, resolution looks up the EXISTING career_resume_versions row
  whose source_document_id matches the selected resume's own content
  hash (any version referencing that source document, most recent by
  created_at - see canonicalResumeImportService.ts's own comment on why
  multiple versions can share one source document) - purely additive
  reads, zero writes, satisfying §18's "zero version side effects from
  selection alone" for every caller, not just the ones that happen to
  call this after the profile's latest hasn't changed.

  If no such version exists yet (the selected resume was truly never
  imported - a legacy pre-6I.1 resume, or import silently failed),
  resolution throws SelectedResumeUnavailableError rather than falling
  back to the profile's latest version or auto-importing - never using
  "latest" as a silent substitute for a real but currently
  unresolvable selection (the round spec's own explicit prohibition).

  Two client contexts exist in this codebase for entirely structural
  reasons (not a design choice made here): session-authenticated routes
  (Career Memory/Dashboard/Paste Job previews) can read
  career_resume_versions/career_source_documents/career_memory/resumes
  directly (all four are `authenticated`-only grants); the background
  worker / canary generate route always runs as service-role
  (supabaseAdmin), which has NO grant on any of those four tables (see
  this round's own migration 20260808065057's header comment) and must
  go through the two new SECURITY DEFINER RPCs it defines instead. Both
  modes share the exact same branch priority and the exact same return
  contract below - only the low-level row-fetching differs, which is
  the "one reusable resolver" this round's spec asks for: the
  error-prone part (branch order, never-silently-fall-back-to-latest)
  lives in exactly one place.

  Every explicit resumeId/applicationId lookup re-verifies ownership
  against the caller-supplied/session-derived userId - never trusts a
  foreign key alone (§17's own explicit ownership mandate).
*/
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SelectedResumeUnavailableError, ValidationError } from "../errors/domainErrors";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";
import type { CareerResumeVersionRow } from "../persistence/types";
import { careerResumeVersionRowToRuntime } from "../persistence/mappers";
import { createCanonicalRuntime } from "../runtime/factory";
import type { CanonicalResumeRuntime } from "../runtime/types";
import { supabaseAdmin } from "../../supabaseAdmin";
import { getCanonicalRuntimeViaServiceRole } from "../orchestration/canonicalMemoryBundleFetch";
import { assertHasIdentity, assertRuntimeResumeIsRenderable } from "../../resumeTemplates/contracts/validation";

const RESUMES_STORAGE_BUCKET = "resumes";

export type ResolveCanonicalResumeContextResult =
  | {
      status: "resolved";
      source: "application-binding" | "explicit-version" | "explicit-resume" | "selected-resume" | "profile-latest";
      profileId: string;
      versionId: string;
      sourceDocumentId: string | null;
      /*
        Populated whenever the resolution path already had the full
        version row in hand (every service-role branch, since both
        RPCs below return it to avoid a second round-trip) - session-
        mode callers get `undefined` here and should call
        loadRuntimeForResolvedVersion() separately, which is cheap
        (one repos.resumeVersions.getById(), already ownership-scoped
        by the session's own RLS).
      */
      runtime?: CanonicalResumeRuntime;
    }
  /* career_memory.selected_resume_type === "career_memory" (an
     AI-authored-from-profile resume, no original file) - by design this
     can never have a canonical version (CanonicalResumeImportService
     explicitly rejects importing it). Not an error: the caller should
     fall back to its own non-canonical rendering (e.g. Dashboard's
     existing CareerMemoryTemplatePreview), exactly as it already does
     today - this status just makes that fallback explicit and
     intentional instead of accidental. */
  | { status: "not-canonical"; reason: "career-memory-authored" }
  /* No career_profiles row exists for this user at all - a fully
     legacy account that has never imported anything into Canonical
     Career Memory. Preserve existing legacy behavior; never force
     migration (§22). */
  | { status: "legacy-only" };

type SessionModeInput = {
  mode: "session";
  repos: CanonicalRepositoryBundle;
  client: SupabaseClient;
  userId: string;
  /* Explicit override - ownership-checked, resolved exactly, never
     substituted (Branch C/"explicit-resume" of the round spec). */
  resumeId?: string;
  /* When supplied AND the application already has a recorded
     canonical_resume_version_id, that binding wins permanently over
     whatever is currently selected (Branch A). Applications this round
     always read `applications` via the raw session client with an
     explicit .eq("user_id", userId) - matches
     applicationTemplateResolver.ts's own established pattern for the
     same legacy table. */
  applicationId?: string;
  /*
    Phase 6I.6.9 - explicit canonical_resume_version_id override (Branch
    A2), for callers that already know EXACTLY which version they mean
    and must never fall through to career_memory.selected_resume_type/
    selected_resume_id. That column pair is written ONLY by the
    Dashboard resume picker (grep-confirmed: no other call site in this
    repo ever writes it) - it reflects "which UPLOADED resume is
    selected on Dashboard," a completely different concept from "which
    Manual Career Memory version is currently being edited," and is
    never updated by the Manual wizard. Without this override, a user
    who previously selected an uploaded resume B on Dashboard and then
    opens a brand-new (or existing) Manual resume A would have Step 9's
    preview silently resolve to B's content instead of A's - the exact
    cross-resume leak the round's own "SELECTED RESUME = A -> PREVIEW
    SOURCE = A ONLY" invariant forbids (found via this round's own root-
    cause trace, not previously covered by any test since every prior
    UAT/test account only ever had one canonical version in play at a
    time, coincidentally masking the gap). Ownership is enforced by
    career_resume_versions' own RLS - resumeVersions.getById() returns
    null for a version this session cannot see, exactly the same
    enforcement loadRuntimeForResolvedVersion() already relies on - no
    new ownership check invented here, no RLS change.
  */
  versionId?: string;
};

type ServiceRoleModeInput = {
  mode: "service-role";
  /* Always supabaseAdmin in practice - accepted as a parameter (not
     imported directly here) only so tests can substitute a fake client,
     matching every other service-role function in this codebase. */
  client: SupabaseClient;
  userId: string;
  /*
    Phase 6I.6.16 - when supplied AND the application already has a
    recorded canonical_resume_version_id, that binding wins permanently
    over whatever resume is currently selected - the service-role
    mirror of session mode's own Branch A above. This closes the race
    where the background worker (always service-role) re-read
    career_memory.selected_resume_id fresh at generation time: if the
    user switched their selected resume between Generate Package click
    and worker execution, generation could silently use the NEW
    selection instead of the one the application was claimed for. The
    dispatcher (canonicalGenerateDispatchService.ts) now resolves and
    freezes canonical_profile_id/canonical_resume_version_id onto the
    application row at claim time, from the SAME resolvedResume used
    for the content/resume_id snapshot - never two independently
    resolved identities that could disagree.
  */
  applicationId?: string;
};

export type ResolveCanonicalResumeContextInput = SessionModeInput | ServiceRoleModeInput;

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function downloadAndHash(storagePath: string): Promise<string> {
  const { data: fileBlob, error } = await supabaseAdmin.storage.from(RESUMES_STORAGE_BUCKET).download(storagePath);
  if (error || !fileBlob) {
    throw new SelectedResumeUnavailableError("resume-deleted", `Could not read the selected resume's original file: ${error?.message ?? "no file returned"}.`);
  }
  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  return sha256Hex(buffer);
}

async function resolveSessionMode(input: SessionModeInput): Promise<ResolveCanonicalResumeContextResult> {
  const { repos, client, userId } = input;

  // Branch A - application-scoped binding, if it already exists, wins permanently.
  if (input.applicationId) {
    const { data: application, error } = await client
      .from("applications")
      .select("canonical_profile_id, canonical_resume_version_id")
      .eq("id", input.applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ValidationError([`Could not read application "${input.applicationId}": ${error.message}.`]);
    if (application?.canonical_resume_version_id && application?.canonical_profile_id) {
      return { status: "resolved", source: "application-binding", profileId: application.canonical_profile_id, versionId: application.canonical_resume_version_id, sourceDocumentId: null };
    }
  }

  // Branch A2 - explicit versionId override (Phase 6I.6.9) - see SessionModeInput.versionId's own header comment.
  if (input.versionId) {
    const row = await repos.resumeVersions.getById(input.versionId);
    if (!row) throw new SelectedResumeUnavailableError("resume-deleted", `Resolved resume version "${input.versionId}" could not be found or is not owned by this user.`);
    const { resume } = careerResumeVersionRowToRuntime(row);
    try {
      assertRuntimeResumeIsRenderable(resume);
      assertHasIdentity(resume);
    } catch {
      throw new SelectedResumeUnavailableError("not-yet-importable", `Resolved resume version "${input.versionId}" does not have enough information to render (missing name/contact details or required sections).`);
    }
    return { status: "resolved", source: "explicit-version", profileId: row.profile_id, versionId: row.id, sourceDocumentId: row.source_document_id ?? null };
  }

  // Branch B/C - explicit resumeId override, or the user's current career_memory selection.
  const targetResumeId = input.resumeId ?? (await loadSelectedUploadedResumeId(client, userId));

  if (targetResumeId === "not-canonical") return { status: "not-canonical", reason: "career-memory-authored" };
  if (targetResumeId === "legacy-only") return { status: "legacy-only" };

  if (targetResumeId) {
    const { data: resume, error } = await client.from("resumes").select("id, storage_path, source_type").eq("id", targetResumeId).eq("user_id", userId).maybeSingle();
    if (error) throw new ValidationError([`Could not read resume "${targetResumeId}": ${error.message}.`]);
    if (!resume || resume.source_type !== "uploaded" || !resume.storage_path) {
      throw new SelectedResumeUnavailableError("resume-not-owned", `The selected resume "${targetResumeId}" no longer exists, is not owned by this user, or has no original file.`);
    }

    const profile = await repos.profiles.getByUserId(userId);
    if (!profile) throw new SelectedResumeUnavailableError("not-yet-importable", "No canonical profile exists yet for this user's selected resume.");

    const contentHash = await downloadAndHash(resume.storage_path);
    const sourceDoc = await repos.sourceDocuments.findByContentHash(profile.id, contentHash);
    if (!sourceDoc) {
      throw new SelectedResumeUnavailableError("not-yet-importable", "The selected resume has not been imported into Canonical Career Memory yet.");
    }
    const allVersions = await repos.resumeVersions.listByProfileId(profile.id);
    const matching = allVersions.filter((v) => v.source_document_id === sourceDoc.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (matching.length === 0) {
      throw new SelectedResumeUnavailableError("not-yet-importable", "The selected resume's source document has no canonical version yet.");
    }
    return { status: "resolved", source: input.resumeId ? "explicit-resume" : "selected-resume", profileId: profile.id, versionId: matching[0].id, sourceDocumentId: sourceDoc.id };
  }

  // Branch D - no explicit override, no (or unset) selection: preserve existing behavior (profile's latest).
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) return { status: "legacy-only" };
  const latest = await repos.resumeVersions.getLatestByProfileId(profile.id);
  if (!latest) return { status: "legacy-only" };
  return { status: "resolved", source: "profile-latest", profileId: profile.id, versionId: latest.id, sourceDocumentId: latest.source_document_id ?? null };
}

/*
  Reads career_memory's selection for the session-mode path. Returns:
  - a resumeId string, when selected_resume_type === "uploaded" with a
    non-null selected_resume_id (caller still separately verifies
    ownership/existence of that resumeId against `resumes`)
  - "not-canonical", when selected_resume_type === "career_memory"
  - "legacy-only", when selected_resume_type is null/undefined/unset
    (no explicit selection has ever been made) OR no career_memory row
    exists at all - treated identically to "no selection made", which
    preserves today's existing behavior for every account that has never
    touched the Dashboard resume picker (never forcing a migration).
  - null, only if career_memory exists with selected_resume_type ===
    "uploaded" but selected_resume_id is itself null (a data
    inconsistency) - falls through to the profile-latest branch, same
    as "legacy-only" in effect but not conflated in naming.
*/
async function loadSelectedUploadedResumeId(client: SupabaseClient, userId: string): Promise<string | null | "not-canonical" | "legacy-only"> {
  const { data: memory, error } = await client.from("career_memory").select("selected_resume_type, selected_resume_id").eq("user_id", userId).maybeSingle();
  if (error) throw new ValidationError([`Could not read career_memory selection: ${error.message}.`]);
  if (!memory || memory.selected_resume_type === null || memory.selected_resume_type === undefined) return "legacy-only";
  if (memory.selected_resume_type === "career_memory") return "not-canonical";
  if (memory.selected_resume_type === "uploaded") return memory.selected_resume_id ?? null;
  return "legacy-only";
}

async function resolveServiceRoleMode(input: ServiceRoleModeInput): Promise<ResolveCanonicalResumeContextResult> {
  const { client, userId } = input;

  // Branch A - application-scoped binding, if it already exists, wins
  // permanently (see ServiceRoleModeInput.applicationId's own header
  // comment). service_role has an ordinary table grant on
  // `applications` (unlike career_memory/resumes/career_source_
  // documents/career_resume_versions) - no RPC needed for this read.
  if (input.applicationId) {
    const { data: application, error } = await client
      .from("applications")
      .select("canonical_profile_id, canonical_resume_version_id")
      .eq("id", input.applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ValidationError([`Could not read application "${input.applicationId}": ${error.message}.`]);
    if (application?.canonical_resume_version_id && application?.canonical_profile_id) {
      const { data: versionData, error: versionError } = await client.rpc("system_resolve_resume_version_by_id", {
        p_user_id: userId,
        p_version_id: application.canonical_resume_version_id,
      });
      if (versionError) throw new ValidationError([`Could not resolve application-bound resume version: ${versionError.message}.`]);
      const versionLookup = versionData as { profileId: string | null; sourceDocumentId: string | null; versionId: string | null; version: CareerResumeVersionRow | null };
      if (versionLookup.versionId && versionLookup.version) {
        const { resume, version, metadata } = careerResumeVersionRowToRuntime(versionLookup.version);
        const runtime = createCanonicalRuntime({ resume, version, metadata });
        return { status: "resolved", source: "application-binding", profileId: application.canonical_profile_id, versionId: application.canonical_resume_version_id, sourceDocumentId: versionLookup.sourceDocumentId, runtime };
      }
      // The bound version id no longer resolves (deleted row, or somehow
      // not owned) - fall through to the current-selection resolution
      // below rather than silently failing generation outright. This
      // mirrors session mode's own behavior: Branch A there only short-
      // circuits when BOTH columns AND the lookup succeed.
    }
  }

  const { data: selectionData, error: selectionError } = await client.rpc("system_resolve_selected_resume", { p_user_id: userId });
  if (selectionError) throw new ValidationError([`Could not resolve selected resume: ${selectionError.message}.`]);
  const selection = selectionData as {
    hasCareerMemory: boolean;
    selectedResumeType: string | null;
    selectedResumeId: string | null;
    resume: { id: string; fileName: string | null; storagePath: string | null; originalFileType: string | null; sourceType: string | null } | null;
  };

  if (!selection.hasCareerMemory || selection.selectedResumeType === null || selection.selectedResumeType === undefined) {
    return resolveServiceRoleProfileLatest(client, userId);
  }
  if (selection.selectedResumeType === "career_memory") {
    return { status: "not-canonical", reason: "career-memory-authored" };
  }
  if (selection.selectedResumeType === "uploaded") {
    if (!selection.resume || selection.resume.sourceType !== "uploaded" || !selection.resume.storagePath) {
      throw new SelectedResumeUnavailableError("resume-not-owned", "The selected resume no longer exists, is not owned by this user, or has no original file.");
    }

    const contentHash = await downloadAndHash(selection.resume.storagePath);
    const { data: hashLookupData, error: hashLookupError } = await client.rpc("system_resolve_resume_version_by_hash", { p_user_id: userId, p_content_hash: contentHash });
    if (hashLookupError) throw new ValidationError([`Could not resolve resume version by content hash: ${hashLookupError.message}.`]);
    const hashLookup = hashLookupData as { profileId: string | null; sourceDocumentId: string | null; versionId: string | null; version: CareerResumeVersionRow | null };

    if (!hashLookup.profileId || !hashLookup.versionId || !hashLookup.version) {
      throw new SelectedResumeUnavailableError("not-yet-importable", "The selected resume has not been imported into Canonical Career Memory yet.");
    }
    const { resume, version, metadata } = careerResumeVersionRowToRuntime(hashLookup.version);
    const runtime = createCanonicalRuntime({ resume, version, metadata });
    return { status: "resolved", source: "selected-resume", profileId: hashLookup.profileId, versionId: hashLookup.versionId, sourceDocumentId: hashLookup.sourceDocumentId, runtime };
  }

  return resolveServiceRoleProfileLatest(client, userId);
}

async function resolveServiceRoleProfileLatest(client: SupabaseClient, userId: string): Promise<ResolveCanonicalResumeContextResult> {
  const lookup = await getCanonicalRuntimeViaServiceRole(client, userId);
  if (!lookup.found) return { status: "legacy-only" };
  if (!lookup.runtime.version?.id) return { status: "legacy-only" };
  return { status: "resolved", source: "profile-latest", profileId: lookup.profile.id, versionId: lookup.runtime.version.id, sourceDocumentId: null, runtime: lookup.runtime };
}

/*
  Session-mode companion to the resolver's `runtime` field: when
  resolveCanonicalResumeContext() ran in session mode (so `runtime` came
  back undefined), fetches the same version's full runtime via the
  ordinary session-authenticated repository layer - a single,
  already-ownership-scoped read (career_resume_versions RLS already
  restricts this to the caller's own profile).
*/
export async function loadRuntimeForResolvedVersion(repos: CanonicalRepositoryBundle, versionId: string): Promise<CanonicalResumeRuntime> {
  const row = await repos.resumeVersions.getById(versionId);
  if (!row) throw new SelectedResumeUnavailableError("resume-deleted", `Resolved resume version "${versionId}" could not be re-fetched.`);
  const { resume, version, metadata } = careerResumeVersionRowToRuntime(row);
  return createCanonicalRuntime({ resume, version, metadata });
}

export async function resolveCanonicalResumeContext(input: ResolveCanonicalResumeContextInput): Promise<ResolveCanonicalResumeContextResult> {
  if (input.mode === "session") return resolveSessionMode(input);
  return resolveServiceRoleMode(input);
}
