"use client";

/*
  Phase 6E - Overlay Viewer (spec section 11): Canonical Resume → Overlay
  → result Preview, with overlay creation supported and the canonical
  resume itself never directly editable from here. Overlays are
  create/delete only (no update endpoint exists server-side - see
  CanonicalOverlayService, which only exposes createOverlay/
  deleteOverlay/listOverlays) - "editing" happens by creating a new
  overlay, matching the real backend contract rather than inventing an
  update capability that doesn't exist.
*/
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCanonicalProfile } from "../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, EmptyState, Badge, ReplayNotice, toApiError } from "../_components/shared";
import { listVersions, listOverlays, createOverlay, deleteOverlay, getVersion, newIdempotencyKey } from "@/lib/canonicalCareerUi/apiClient";
import { previewOverlay, type OverlayPreviewResult } from "../_components/overlayPreview";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type { CareerResumeVersionRow, CareerTailoredResumeRow, ResumeStructuredModel } from "@/lib/canonicalCareerUi/types";

export default function OverlayViewerPage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const [versions, setVersions] = useState<CareerResumeVersionRow[]>([]);
  const [overlays, setOverlays] = useState<CareerTailoredResumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);

  const [expandedOverlayId, setExpandedOverlayId] = useState<string | null>(null);
  const [previewByOverlayId, setPreviewByOverlayId] = useState<Record<string, OverlayPreviewResult | CanonicalApiError>>({});

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<CanonicalApiError | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const [versionRows, overlayRows] = await Promise.all([listVersions(profile.id), listOverlays(profile.id)]);
      versionRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      overlayRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setVersions(versionRows);
      setOverlays(overlayRows);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const latestVersion = versions[0];

  async function togglePreview(overlay: CareerTailoredResumeRow) {
    if (expandedOverlayId === overlay.id) {
      setExpandedOverlayId(null);
      return;
    }
    setExpandedOverlayId(overlay.id);
    if (previewByOverlayId[overlay.id] || !profile) return;
    try {
      const versionId = overlay.resume_version_id ?? latestVersion?.id;
      if (!versionId) throw new CanonicalApiError("VALIDATION_FAILED", "No resume version available to preview this overlay against.", 422);
      const version = await getVersion(profile.id, versionId);
      const preview = previewOverlay(version.snapshot as unknown as ResumeStructuredModel, versionId, overlay.overlay);
      setPreviewByOverlayId((prev) => ({ ...prev, [overlay.id]: preview }));
    } catch (err) {
      setPreviewByOverlayId((prev) => ({ ...prev, [overlay.id]: toApiError(err) }));
    }
  }

  async function handleDelete(overlayId: string) {
    if (!profile) return;
    setDeletingId(overlayId);
    setDeleteError(null);
    try {
      await deleteOverlay(profile.id, overlayId);
      await load();
    } catch (err) {
      setDeleteError(toApiError(err));
    } finally {
      setDeletingId(null);
    }
  }

  if (profileLoading || loading) {
    return (
      <PageShell title="Overlays">
        <LoadingState label="Loading overlays…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Overlays">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Overlays">
        <ErrorBanner error={error} onRetry={load} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Overlays" description="Tailored bullet/summary rewrites layered on top of your canonical resume. The canonical resume itself is never changed by an overlay.">
      <CreateOverlayForm profileId={profile!.id} versions={versions} onCreated={load} />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-700">Existing overlays</h2>
      {deleteError ? <div className="mb-3"><ErrorBanner error={deleteError} /></div> : null}
      {overlays.length === 0 ? (
        <EmptyState>No overlays created yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {overlays.map((overlay) => {
            const preview = previewByOverlayId[overlay.id];
            const expanded = expandedOverlayId === overlay.id;
            return (
              <Card key={overlay.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500">{overlay.id.slice(0, 8)}…</span>
                    {overlay.template_id ? <Badge>{overlay.template_id}</Badge> : null}
                    {overlay.ai_model ? <Badge tone="amber">{overlay.ai_model}</Badge> : null}
                  </div>
                  <span className="text-xs text-neutral-500">{new Date(overlay.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => togglePreview(overlay)} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100">
                    {expanded ? "Hide preview" : "Show result preview"}
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === overlay.id}
                    onClick={() => handleDelete(overlay.id)}
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === overlay.id ? "Deleting…" : "Delete overlay"}
                  </button>
                </div>
                {expanded ? (
                  <div className="mt-4 border-t border-neutral-100 pt-4">
                    {!preview ? (
                      <LoadingState label="Resolving tailored preview…" />
                    ) : preview instanceof CanonicalApiError ? (
                      <ErrorBanner error={preview} />
                    ) : (
                      <OverlayPreviewView preview={preview} />
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function OverlayPreviewView({ preview }: { preview: OverlayPreviewResult }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge tone="green">{preview.appliedEntryIds.length} entries updated</Badge>
        {preview.rejections.length > 0 ? <Badge tone="red">{preview.rejections.length} rejected</Badge> : null}
      </div>
      {preview.rejections.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 text-xs text-red-700">
          {preview.rejections.map((r, i) => (
            <li key={i}>
              {r.reason}
              {r.entryId ? ` (entry: ${r.entryId})` : ""} — {r.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.tailored.professionalSummary ? (
        <div>
          <p className="text-xs font-medium text-neutral-500">Professional summary</p>
          <p className="mt-1 text-neutral-800">{preview.tailored.professionalSummary.text}</p>
        </div>
      ) : null}
      <div>
        <p className="text-xs font-medium text-neutral-500">Updated entries</p>
        <ul className="mt-1 space-y-2">
          {preview.tailored.professionalExperience
            .filter((e) => preview.appliedEntryIds.includes(e.id))
            .map((e) => (
              <li key={e.id} className="rounded-md bg-neutral-50 p-2">
                <p className="font-medium text-neutral-900">{e.organization?.value ?? e.rawHeaderText}</p>
                <ul className="mt-1 list-inside list-disc text-xs text-neutral-600">
                  {e.bullets.map((b) => (
                    <li key={b.id}>{b.text}</li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function CreateOverlayForm({ profileId, versions, onCreated }: { profileId: string; versions: CareerResumeVersionRow[]; onCreated: () => void }) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [entries, setEntries] = useState<{ id: string; label: string }[]>([]);
  const [entryId, setEntryId] = useState("");
  const [bulletText, setBulletText] = useState("");
  const [summaryOverride, setSummaryOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<CanonicalApiError | null>(null);
  const [lastRejections, setLastRejections] = useState<string[] | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [replayed, setReplayed] = useState(false);

  const activeVersionId = versionId || versions[0]?.id || "";

  useEffect(() => {
    if (!activeVersionId) return;
    let cancelled = false;
    (async () => {
      try {
        const version = await getVersion(profileId, activeVersionId);
        const snapshot = version.snapshot as unknown as ResumeStructuredModel;
        if (cancelled) return;
        const options = [
          ...snapshot.professionalExperience.map((e) => ({ id: e.id, label: `[Experience] ${e.organization?.value ?? e.rawHeaderText}` })),
          ...snapshot.projects.map((p) => ({ id: p.id, label: `[Project] ${p.name?.value ?? p.rawHeaderText}` })),
        ];
        setEntries(options);
        setEntryId(options[0]?.id ?? "");
      } catch {
        setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, activeVersionId]);

  const canSubmit = useMemo(() => activeVersionId && entryId && bulletText.trim().length > 0, [activeVersionId, entryId, bulletText]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setLastRejections(null);
    setReplayed(false);
    try {
      const overlay = {
        schemaVersion: "resume-structured-v1",
        ...(summaryOverride.trim() ? { professionalSummaryText: summaryOverride.trim() } : {}),
        entries: [{ entryId, bullets: [{ text: bulletText.trim() }] }],
      };
      const result = await createOverlay({ profileId, resumeVersionId: activeVersionId, overlay }, idempotencyKey);
      if (result.rejections.length > 0) setLastRejections(result.rejections.map((r) => `${r.reason}: ${r.detail}`));
      setBulletText("");
      setIdempotencyKey(newIdempotencyKey());
      onCreated();
    } catch (err) {
      const apiError = toApiError(err);
      setSubmitError(apiError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-neutral-700">Create a new overlay</h2>
      <p className="mt-1 text-xs text-neutral-500">Rewrites a bullet on top of the canonical resume without changing it - protected facts (company, dates, role) can never be overlaid.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-600">
          Base version
          <select value={activeVersionId} onChange={(e) => setVersionId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.created_at).toLocaleString()} ({v.reason})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-600">
          Target entry
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" disabled={entries.length === 0}>
            {entries.length === 0 ? <option>No experience/project entries found</option> : entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-3 block text-xs text-neutral-600">
        New bullet text
        <textarea
          value={bulletText}
          onChange={(e) => setBulletText(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          placeholder="e.g. Directed a 30% reduction in fulfillment cycle time for the target role's logistics focus."
        />
      </label>
      <label className="mt-3 block text-xs text-neutral-600">
        Professional summary override (optional)
        <textarea value={summaryOverride} onChange={(e) => setSummaryOverride(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      </label>

      {submitError ? <div className="mt-3"><ErrorBanner error={submitError} callSite="create_overlay" onRetry={() => setSubmitError(null)} /></div> : null}
      {lastRejections && lastRejections.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">This overlay was created, but part of it was rejected:</p>
          <ul className="mt-1 list-inside list-disc">
            {lastRejections.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {replayed ? <div className="mt-3"><ReplayNotice /></div> : null}

      <button
        type="button"
        disabled={!canSubmit || submitting}
        onClick={handleSubmit}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create overlay"}
      </button>
    </Card>
  );
}
