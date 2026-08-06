"use client";

/*
  Phase 6E - Resume Version Browser + History Timeline + Restore (spec
  sections 6-7). Every version shown here is a real
  CareerResumeVersionRow returned by GET /versions - no client-side
  invention of history. Restore calls POST /versions/[id]/restore,
  which always creates a NEW version row (never overwrites the target -
  spec section 7's explicit requirement), verified against the real
  route in lib/canonicalCareerUi/apiClient.test.ts's restore block.
*/
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCanonicalProfile } from "../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, EmptyState, Badge, ReplayNotice, toApiError } from "../_components/shared";
import { listVersions, listOverlays, restoreVersion, newIdempotencyKey } from "@/lib/canonicalCareerUi/apiClient";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type { CareerResumeVersionRow } from "@/lib/canonicalCareerUi/types";

const REASON_TONE: Record<string, "neutral" | "green" | "amber"> = {
  initial: "neutral",
  reanalysis: "amber",
  user_edit: "amber",
  merge: "amber",
  import: "neutral",
  restore: "green",
};

export default function VersionBrowserPage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const [versions, setVersions] = useState<CareerResumeVersionRow[]>([]);
  const [overlayCountByVersionId, setOverlayCountByVersionId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<CanonicalApiError | null>(null);
  const [lastRestoreKeyByTarget, setLastRestoreKeyByTarget] = useState<Record<string, string>>({});
  const [replayedTargetId, setReplayedTargetId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const [versionRows, overlayRows] = await Promise.all([listVersions(profile.id), listOverlays(profile.id)]);
      versionRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setVersions(versionRows);
      const counts: Record<string, number> = {};
      for (const overlay of overlayRows) {
        if (!overlay.resume_version_id) continue;
        counts[overlay.resume_version_id] = (counts[overlay.resume_version_id] ?? 0) + 1;
      }
      setOverlayCountByVersionId(counts);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const versionById = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);

  function toggleCompare(id: string) {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  async function handleRestore(targetVersionId: string) {
    if (!profile) return;
    setRestoringId(targetVersionId);
    setRestoreError(null);
    setReplayedTargetId(null);
    /* Reuse the SAME idempotency key on a retry of the SAME target, so a
       retry after a network failure/timeout replays rather than creating
       a second restored version (spec section 14's Idempotency Replay
       requirement) - only mint a fresh key the first time this target is
       restored in this session. */
    const key = lastRestoreKeyByTarget[targetVersionId] ?? newIdempotencyKey();
    setLastRestoreKeyByTarget((prev) => ({ ...prev, [targetVersionId]: key }));
    try {
      const result = await restoreVersion(profile.id, targetVersionId, key);
      const alreadyKnown = versions.some((v) => v.id === result.version.id);
      if (alreadyKnown) setReplayedTargetId(targetVersionId);
      await load();
    } catch (err) {
      setRestoreError(toApiError(err));
    } finally {
      setRestoringId(null);
    }
  }

  function goToCompare() {
    if (selectedForCompare.length !== 2) return;
    router.push(`/canonical-career/versions/compare?from=${selectedForCompare[0]}&to=${selectedForCompare[1]}`);
  }

  if (profileLoading || loading) {
    return (
      <PageShell title="Resume Versions">
        <LoadingState label="Loading version history…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Resume Versions">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Resume Versions">
        <ErrorBanner error={error} onRetry={load} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Resume Versions" description="Every saved version of your canonical resume, newest first. Restoring always creates a new version.">
      {restoreError ? <div className="mb-4"><ErrorBanner error={restoreError} callSite="restore_version" onRetry={() => setRestoreError(null)} /></div> : null}

      {selectedForCompare.length === 2 ? (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-neutral-300 bg-white px-4 py-3 text-sm">
          <span>2 versions selected for comparison</span>
          <button type="button" onClick={goToCompare} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">
            Compare selected
          </button>
        </div>
      ) : null}

      {versions.length === 0 ? (
        <EmptyState>No versions yet. Saving your canonical resume for the first time will create one.</EmptyState>
      ) : (
        <ol className="space-y-3 border-l border-neutral-200 pl-6">
          {versions.map((version) => {
            const parent = version.parent_version_id ? versionById.get(version.parent_version_id) : undefined;
            const overlayCount = overlayCountByVersionId[version.id] ?? 0;
            return (
              <li key={version.id} className="relative">
                <span className="absolute -left-[29px] top-2 h-2.5 w-2.5 rounded-full bg-neutral-400" />
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={REASON_TONE[version.reason] ?? "neutral"}>{version.reason}</Badge>
                      <span className="text-sm text-neutral-500">{new Date(version.created_at).toLocaleString()}</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <input type="checkbox" checked={selectedForCompare.includes(version.id)} onChange={() => toggleCompare(version.id)} />
                      Select to compare
                    </label>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600 sm:grid-cols-4">
                    <div>
                      <dt className="text-neutral-400">Version id</dt>
                      <dd className="truncate font-mono">{version.id}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Parent version</dt>
                      <dd className="truncate">{parent ? new Date(parent.created_at).toLocaleDateString() : version.parent_version_id ? "(not loaded)" : "None (root)"}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Source document</dt>
                      <dd className="truncate">{version.source_document_id ?? "None"}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Overlays built on this version</dt>
                      <dd>{overlayCount}</dd>
                    </div>
                  </dl>
                  {replayedTargetId === version.id ? (
                    <div className="mt-3">
                      <ReplayNotice />
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={restoringId === version.id}
                      onClick={() => handleRestore(version.id)}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {restoringId === version.id ? "Restoring…" : "Restore this version"}
                    </button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </PageShell>
  );
}
