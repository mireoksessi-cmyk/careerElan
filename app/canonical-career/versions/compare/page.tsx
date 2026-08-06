"use client";

/*
  Phase 6E - Resume Version Compare (spec section "Resume Version
  Compare"). Reads ?from=&to= version ids (set by the Version Browser's
  checkbox selection), fetches both real version snapshots via
  GET /versions/[id], and diffs them with the pure
  lib/canonicalCareerUi/versionCompare.ts - no client-side re-derivation
  of what changed beyond that pure function.
*/
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCanonicalProfile } from "../../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, Badge, toApiError } from "../../_components/shared";
import { getVersion } from "@/lib/canonicalCareerUi/apiClient";
import { compareResumeVersions } from "@/lib/canonicalCareerUi/versionCompare";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type { VersionDiffSummary, ResumeStructuredModel } from "@/lib/canonicalCareerUi/types";

const CHANGE_TONE: Record<string, "neutral" | "green" | "amber" | "red"> = {
  added: "green",
  removed: "red",
  changed: "amber",
  unchanged: "neutral",
};

export default function VersionComparePage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const searchParams = useSearchParams();
  const fromId = searchParams.get("from");
  const toId = searchParams.get("to");

  const [summary, setSummary] = useState<VersionDiffSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState(true);

  useEffect(() => {
    if (!profile || !fromId || !toId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [fromVersion, toVersion] = await Promise.all([getVersion(profile.id, fromId), getVersion(profile.id, toId)]);
        if (cancelled) return;
        const result = compareResumeVersions(fromId, toId, fromVersion.snapshot as unknown as ResumeStructuredModel, toVersion.snapshot as unknown as ResumeStructuredModel);
        setSummary(result);
      } catch (err) {
        if (!cancelled) setError(toApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, fromId, toId]);

  if (!fromId || !toId) {
    return (
      <PageShell title="Compare Versions">
        <div className="rounded-lg border border-neutral-300 bg-white px-4 py-6 text-sm text-neutral-600">
          Select exactly 2 versions from the <Link href="/canonical-career/versions" className="underline">Version Browser</Link> to compare them.
        </div>
      </PageShell>
    );
  }

  if (profileLoading || loading) {
    return (
      <PageShell title="Compare Versions">
        <LoadingState label="Comparing versions…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Compare Versions">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Compare Versions">
        <ErrorBanner error={error} />
      </PageShell>
    );
  }
  if (!summary) return null;

  const visibleRows = hideUnchanged ? summary.rows.filter((r) => r.change !== "unchanged") : summary.rows;

  return (
    <PageShell title="Compare Versions" description={`Diffing version ${fromId.slice(0, 8)}… against ${toId.slice(0, 8)}…`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone="green">+{summary.addedCount} added</Badge>
        <Badge tone="red">-{summary.removedCount} removed</Badge>
        <Badge tone="amber">{summary.changedCount} changed</Badge>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={hideUnchanged} onChange={(e) => setHideUnchanged(e.target.checked)} />
          Hide unchanged
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No differences to show{hideUnchanged ? " (everything is unchanged - try unhiding unchanged rows)" : ""}.</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Section</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Change</th>
                <th className="px-4 py-2">Before</th>
                <th className="px-4 py-2">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleRows.map((row, index) => (
                <tr key={`${row.section}-${row.label}-${index}`}>
                  <td className="px-4 py-2 text-neutral-500">{row.section}</td>
                  <td className="px-4 py-2 font-medium text-neutral-900">{row.label}</td>
                  <td className="px-4 py-2">
                    <Badge tone={CHANGE_TONE[row.change]}>{row.change}</Badge>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-neutral-500">{row.before ?? "—"}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-neutral-500">{row.after ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
