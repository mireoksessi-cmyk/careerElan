/*
  Phase 6D - shared profile lookup/ownership helper used by every
  service in this directory. `career_profiles.user_id` is UNIQUE at the
  DB level (Phase 6B schema), so "find or create" is genuinely
  idempotent: a concurrent duplicate insert fails with ConflictError
  (postgrestErrors.ts maps Postgres 23505 to it), and this function
  simply re-reads the now-existing row instead of treating that as a
  real error - no invented in-memory idempotency key needed for THIS
  operation specifically (contrast with saveCanonicalRuntime()'s own
  disclosed IDEMPOTENCY_SCHEMA_GAP).
*/
import { ConflictError, NotFoundError } from "../errors/domainErrors";
import type { CareerProfileRow } from "../persistence/types";
import type { CanonicalRepositoryBundle } from "../repositories/createRepositories";

export async function ensureProfile(repos: CanonicalRepositoryBundle, userId: string, defaults: { schemaVersion: string; serializerVersion: string }): Promise<CareerProfileRow> {
  const existing = await repos.profiles.getByUserId(userId);
  if (existing) return existing;

  try {
    return await repos.profiles.insert({ user_id: userId, schema_version: defaults.schemaVersion, serializer_version: defaults.serializerVersion });
  } catch (error) {
    if (error instanceof ConflictError) {
      const raced = await repos.profiles.getByUserId(userId);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function requireProfileForUser(repos: CanonicalRepositoryBundle, userId: string): Promise<CareerProfileRow> {
  const profile = await repos.profiles.getByUserId(userId);
  if (!profile) throw new NotFoundError("Career profile");
  return profile;
}

/*
  Second-gate ownership check for any resource that carries its own
  `profile_id` - resolves the profile owning that row and confirms it
  matches the session's own profile before letting a service method
  touch the row. Distinct from auth/authContext.ts's assertOwnership()
  (which compares two user ids directly) because most repository rows
  only carry a profile_id, not a user_id, one hop further from the
  session.
*/
export async function requireOwnedProfile(repos: CanonicalRepositoryBundle, userId: string, profileId: string): Promise<CareerProfileRow> {
  const profile = await repos.profiles.getById(profileId);
  if (!profile || profile.user_id !== userId) throw new NotFoundError("Career profile");
  return profile;
}
