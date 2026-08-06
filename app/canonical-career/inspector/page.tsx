"use client";

/*
  Phase 6E - Runtime Inspector / Developer Mode (spec section 12).
  Reconstructs a CanonicalResumeRuntime from real fetched data (latest
  version snapshot + profile metadata + source documents + overlays)
  purely for DISPLAY - never written back anywhere. overlayState.history
  entries reconstruct appliedEntryIds/rejections as empty (disclosed
  simplification: the Inspector only needs history.length for its
  overlay count, never the per-entry detail, so recomputing each via
  the real merge function here would be real work spent on data this
  view never renders - unlike the Overlay Viewer, which DOES render
  that detail and therefore DOES recompute it via previewOverlay()).
*/
import { useCallback, useEffect, useState } from "react";
import { useCanonicalProfile } from "../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, EmptyState, Badge, JsonBlock, toApiError } from "../_components/shared";
import { listVersions, listSourceDocuments, listOverlays, getVersion } from "@/lib/canonicalCareerUi/apiClient";
import { buildRuntimeInspectorSummary, buildRuntimeJsonPreview } from "@/lib/canonicalCareerUi/runtimeInspector";
import { createCanonicalRuntime, createRuntimeMetadata, createRuntimeVersion, createRuntimeSourceDocument } from "@/lib/careerMemory/runtime/factory";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type { CanonicalResumeRuntime, ResumeStructuredModel, RuntimeInspectorSummary } from "@/lib/canonicalCareerUi/types";

export default function RuntimeInspectorPage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const [runtime, setRuntime] = useState<CanonicalResumeRuntime | null>(null);
  const [summary, setSummary] = useState<RuntimeInspectorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);
  const [showJson, setShowJson] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const versions = await listVersions(profile.id);
      if (versions.length === 0) {
        setRuntime(null);
        setSummary(null);
        return;
      }
      const latest = versions.reduce((acc, v) => (new Date(v.created_at) > new Date(acc.created_at) ? v : acc));
      const [version, sourceDocs, overlays] = await Promise.all([getVersion(profile.id, latest.id), listSourceDocuments(profile.id), listOverlays(profile.id)]);

      const reconstructed: CanonicalResumeRuntime = createCanonicalRuntime({
        resume: version.snapshot as unknown as ResumeStructuredModel,
        version: createRuntimeVersion({ id: version.id, reason: version.reason, createdAt: version.created_at, parentVersionId: version.parent_version_id ?? undefined }),
        metadata: createRuntimeMetadata({ schemaVersion: version.schema_version, serializerVersion: version.serializer_version }),
        sourceDocuments: sourceDocs.map((d) =>
          createRuntimeSourceDocument({ id: d.id, fileName: d.original_file_name ?? "unknown", fileType: d.file_type, contentHash: d.content_hash ?? undefined, addedAt: d.created_at })
        ),
        overlayState: { history: overlays.map((o) => ({ overlay: o.overlay, appliedEntryIds: [], rejections: [] })) },
      });

      setRuntime(reconstructed);
      setSummary(buildRuntimeInspectorSummary(reconstructed));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  if (profileLoading || loading) {
    return (
      <PageShell title="Runtime Inspector">
        <LoadingState label="Reconstructing runtime…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Runtime Inspector">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Runtime Inspector">
        <ErrorBanner error={error} onRetry={load} />
      </PageShell>
    );
  }
  if (!runtime || !summary) {
    return (
      <PageShell title="Runtime Inspector">
        <EmptyState>No versions saved yet - the runtime inspector needs at least one saved version to reconstruct.</EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell title="Runtime Inspector" description="Developer Mode - a read-only view of the reconstructed CanonicalResumeRuntime for the latest version.">
      <div className="space-y-4">
        <Card>
          <Badge>Read-only</Badge>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field label="Schema version" value={summary.schemaVersion} />
            <Field label="Serializer version" value={summary.serializerVersion} />
            <Field label="Runtime serializer version" value={summary.runtimeSerializerVersion} />
            <Field label="Version reason" value={summary.versionReason} />
            <Field label="Version id" value={summary.versionId} mono />
            <Field label="Parent version id" value={summary.parentVersionId ?? "None (root)"} mono />
            <Field label="Overlay count" value={String(summary.overlayCount)} />
            <Field label="Source document count" value={String(summary.sourceDocumentCount)} />
          </dl>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-neutral-700">Validation</h3>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={summary.validationPassed ? "green" : "red"}>{summary.validationPassed ? "Passed" : "Failed"}</Badge>
            <span className="text-xs text-neutral-500">{summary.validationWarningCount} warning(s)</span>
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-neutral-700">Entry counts</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {Object.entries(summary.entryCounts).map(([section, count]) => (
              <div key={section}>
                <dt className="text-xs text-neutral-400">{section}</dt>
                <dd className="font-medium text-neutral-900">{count}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-neutral-700">Full JSON preview</h3>
            <button type="button" onClick={() => setShowJson((v) => !v)} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
              {showJson ? "Hide" : "Show"}
            </button>
          </div>
          {showJson ? (
            <div className="mt-3">
              <JsonBlock value={buildRuntimeJsonPreview(runtime)} />
            </div>
          ) : null}
        </Card>
      </div>
    </PageShell>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`font-medium text-neutral-900 ${mono ? "truncate font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
