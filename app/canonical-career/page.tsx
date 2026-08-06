"use client";

/*
  Phase 6E - Career Profile Viewer (spec section 2, landing page).
  Read-only summary of the canonical profile row plus quick counts
  across versions/overlays/source documents, each fetched through
  lib/canonicalCareerUi/apiClient.ts (real internal API calls, no
  Supabase, no mock data - see apiClient.ts's header comment).
*/
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCanonicalProfile } from "./_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, Badge } from "./_components/shared";
import { listVersions, listOverlays, listSourceDocuments } from "@/lib/canonicalCareerUi/apiClient";
import { toApiError } from "./_components/shared";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";

export default function CanonicalCareerProfilePage() {
  const { profile, loading, error, reload } = useCanonicalProfile();
  const [counts, setCounts] = useState<{ versions: number; overlays: number; sources: number } | null>(null);
  const [countsError, setCountsError] = useState<CanonicalApiError | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const [versions, overlays, sources] = await Promise.all([listVersions(profile.id), listOverlays(profile.id), listSourceDocuments(profile.id)]);
        if (!cancelled) setCounts({ versions: versions.length, overlays: overlays.length, sources: sources.length });
      } catch (err) {
        if (!cancelled) setCountsError(toApiError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  return (
    <PageShell title="Career Profile" description="The canonical career profile behind every resume version, overlay, and source document.">
      {loading ? (
        <LoadingState label="Loading your profile…" />
      ) : error ? (
        <ErrorBanner error={error} onRetry={reload} />
      ) : profile ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">Profile ready</Badge>
              <span className="text-xs text-neutral-500">id: {profile.id}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-neutral-500">Schema version</dt>
                <dd className="font-medium text-neutral-900">{profile.schema_version}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Serializer version</dt>
                <dd className="font-medium text-neutral-900">{profile.serializer_version}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Created</dt>
                <dd className="font-medium text-neutral-900">{new Date(profile.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Updated</dt>
                <dd className="font-medium text-neutral-900">{new Date(profile.updated_at).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>

          {countsError ? (
            <ErrorBanner error={countsError} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard href="/canonical-career/versions" label="Resume versions" value={counts?.versions} />
              <StatCard href="/canonical-career/overlays" label="Overlays" value={counts?.overlays} />
              <StatCard href="/canonical-career/sources" label="Source documents" value={counts?.sources} />
            </div>
          )}

          <Card className="text-sm text-neutral-600">
            <p>
              Every write here (saving a version, restoring, creating an overlay, registering a source document) goes through the same transactional RPCs and
              idempotency layer verified in Phase 6D.1 - this UI is the first thing to actually call them.
            </p>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}

function StatCard({ href, label, value }: { href: string; label: string; value: number | undefined }) {
  return (
    <Link href={href}>
      <Card className="transition hover:border-neutral-400">
        <p className="text-xs text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">{value ?? "…"}</p>
      </Card>
    </Link>
  );
}
