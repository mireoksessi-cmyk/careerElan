/*
  Phase 6D - Auth boundary. The ONLY place a userId is allowed to enter
  the Canonical Career Memory system - always derived from a Supabase
  auth session, NEVER from a request body. Every service method in
  lib/careerMemory/services/** takes a `userId` parameter that must have
  come from getAuthenticatedUserId(), never from
  `await req.json()`.

  Duck-typed against the minimal `{ auth: { getUser(): ... } }` shape
  instead of importing `SupabaseClient` from @supabase/supabase-js, so
  this file (and everything that calls it) works unchanged against the
  real client from lib/supabase-server.ts, a fake test client, or any
  future client - no lib/supabase*.ts import here.
*/
import { AuthenticationRequiredError, AuthorizationError } from "../errors/domainErrors";

export type AuthClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

export async function getAuthenticatedUserId(client: AuthClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new AuthenticationRequiredError();
  }
  return data.user.id;
}

/*
  Defense-in-depth ownership check - called by every service method
  AFTER a repository read, never trusted as the only gate (RLS is the
  first gate; this is the second, matching the existing codebase's own
  `.eq("user_id", user.id)` convention in app/api/resumes/[id]/preview-url/
  route.ts). Throws NotFoundError-shaped-as-Authorization rather than
  leaking whether the resource exists for a DIFFERENT user - callers
  that want a 404 instead of 403 for missing-vs-foreign should check
  existence first and call this only once a row is in hand.
*/
export function assertOwnership(resourceOwnerUserId: string, sessionUserId: string): void {
  if (resourceOwnerUserId !== sessionUserId) {
    throw new AuthorizationError();
  }
}
