"use client";

/*
  Phase 6E - shared hook every canonical-career page uses to get the
  session user's profile row. Auto-provisions one via POST /profile if
  none exists yet (idempotent server-side via career_profiles.user_id
  UNIQUE - see profileAccess.ts's ensureProfile()) so a brand-new user
  can land on any of these pages without a separate "create profile"
  step. Plain useState/useEffect, matching this repo's existing
  convention (no React Query/SWR dependency - see the research note in
  apiClient.ts's own header comment).
*/
import { useCallback, useEffect, useState } from "react";
import { getProfile, createProfile } from "@/lib/canonicalCareerUi/apiClient";
import { toApiError } from "./shared";
import type { CareerProfileRow } from "@/lib/canonicalCareerUi/types";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";

const DEFAULT_SCHEMA_VERSION = "resume-structured-v1";

export function useCanonicalProfile() {
  const [profile, setProfile] = useState<CareerProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let row = await getProfile();
      if (!row) {
        row = await createProfile({ schemaVersion: DEFAULT_SCHEMA_VERSION });
      }
      setProfile(row);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { profile, loading, error, reload: load };
}
