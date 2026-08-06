"use client";

/*
  Phase 6E - Merge Wizard + Conflict Resolver (spec sections 8-9). Pure
  decision computation lives in lib/canonicalCareerUi/{conflictDetection,
  mergeWizard}.ts - this page only collects the user's selections and
  renders the resulting MergePreview. Finalizing writes the merged
  resume through the SAME POST /versions RPC path every other write in
  this UI uses (reason: "merge") - never a direct table write.
*/
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCanonicalProfile } from "../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, EmptyState, Badge, toApiError } from "../_components/shared";
import { listVersions, getVersion, saveVersion, newIdempotencyKey } from "@/lib/canonicalCareerUi/apiClient";
import { detectAllConflicts } from "@/lib/canonicalCareerUi/conflictDetection";
import { computeMergePreview } from "@/lib/canonicalCareerUi/mergeWizard";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type {
  CareerResumeVersionRow,
  ResumeStructuredModel,
  ConflictCard,
  ConflictResolution,
  MergeSelection,
  MergeSectionKey,
  MergePreview,
} from "@/lib/canonicalCareerUi/types";

const SECTION_LABEL: Record<MergeSectionKey, string> = {
  professionalExperience: "Professional experience",
  volunteerExperience: "Volunteer experience",
  education: "Education",
  projects: "Projects",
  credentials: "Credentials",
};

function sectionArray(model: ResumeStructuredModel, section: MergeSectionKey) {
  switch (section) {
    case "professionalExperience":
      return model.professionalExperience;
    case "volunteerExperience":
      return model.volunteerExperience;
    case "education":
      return model.education;
    case "projects":
      return model.projects;
    case "credentials":
      return model.credentials;
  }
}

function entryDisplayLabel(entry: { rawHeaderText: string } & Record<string, unknown>): string {
  const named = entry as { organization?: { value: string }; institution?: { value: string }; name?: { value: string } };
  return named.organization?.value ?? named.institution?.value ?? named.name?.value ?? entry.rawHeaderText;
}

export default function MergeWizardPage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const [versions, setVersions] = useState<CareerResumeVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);

  const [baseVersionId, setBaseVersionId] = useState("");
  const [incomingVersionId, setIncomingVersionId] = useState("");
  const [baseResume, setBaseResume] = useState<ResumeStructuredModel | null>(null);
  const [incomingResume, setIncomingResume] = useState<ResumeStructuredModel | null>(null);
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [resumeError, setResumeError] = useState<CanonicalApiError | null>(null);

  const [selections, setSelections] = useState<MergeSelection[]>([]);
  const [resolutions, setResolutions] = useState<ConflictResolution[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<CanonicalApiError | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listVersions(profile.id);
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setVersions(rows);
      if (rows.length >= 2) {
        setBaseVersionId((prev) => prev || rows[0].id);
        setIncomingVersionId((prev) => prev || rows[1].id);
      }
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile || !baseVersionId || !incomingVersionId) return;
    let cancelled = false;
    setLoadingResumes(true);
    setResumeError(null);
    setSelections([]);
    setResolutions([]);
    setSaveSuccess(false);
    (async () => {
      try {
        const [base, incoming] = await Promise.all([getVersion(profile.id, baseVersionId), getVersion(profile.id, incomingVersionId)]);
        if (cancelled) return;
        setBaseResume(base.snapshot as unknown as ResumeStructuredModel);
        setIncomingResume(incoming.snapshot as unknown as ResumeStructuredModel);
      } catch (err) {
        if (!cancelled) setResumeError(toApiError(err));
      } finally {
        if (!cancelled) setLoadingResumes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, baseVersionId, incomingVersionId]);

  const conflicts: ConflictCard[] = useMemo(() => {
    if (!baseResume || !incomingResume) return [];
    return detectAllConflicts(baseResume, incomingResume);
  }, [baseResume, incomingResume]);

  const preview: MergePreview | null = useMemo(() => {
    if (!baseResume || !incomingResume) return null;
    return computeMergePreview(baseResume, incomingResume, { baseVersionId, incomingVersionId, selections, resolutions });
  }, [baseResume, incomingResume, baseVersionId, incomingVersionId, selections, resolutions]);

  function resolveConflict(conflictId: string, choice: ConflictResolution["choice"]) {
    setResolutions((prev) => [...prev.filter((r) => r.conflictId !== conflictId), { conflictId, choice }]);
    setSaveSuccess(false);
  }

  function setSelection(section: MergeSectionKey, itemId: string, choice: MergeSelection["choice"]) {
    setSelections((prev) => [...prev.filter((s) => !(s.section === section && s.itemId === itemId)), { section, itemId, choice }]);
    setSaveSuccess(false);
  }

  const conflictedIds = useMemo(() => {
    const bySection: Record<MergeSectionKey, Set<string>> = {
      professionalExperience: new Set(),
      volunteerExperience: new Set(),
      education: new Set(),
      projects: new Set(),
      credentials: new Set(),
    };
    for (const card of conflicts) {
      const section: MergeSectionKey = card.kind === "experience" ? "professionalExperience" : "education";
      bySection[section].add(card.left.entry.id);
      bySection[section].add(card.right.entry.id);
    }
    return bySection;
  }, [conflicts]);

  async function handleFinalize() {
    if (!profile || !preview || !baseResume) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const latest = await listVersions(profile.id);
      const currentLatestId = latest.reduce<CareerResumeVersionRow | null>((acc, v) => (!acc || new Date(v.created_at) > new Date(acc.created_at) ? v : acc), null)?.id ?? null;

      await saveVersion(
        {
          runtime: {
            resume: preview.resume,
            metadata: { schemaVersion: baseResume.schemaVersion, serializerVersion: "career-memory-runtime-v1" },
            version: { id: "pending", reason: "merge", createdAt: new Date().toISOString() },
            sourceDocuments: [],
            serializerVersion: "career-memory-runtime-v1",
            overlayState: { history: [] },
          },
          expectedCurrentVersionId: currentLatestId,
        },
        newIdempotencyKey()
      );
      setSaveSuccess(true);
      await load();
    } catch (err) {
      setSaveError(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading || loading) {
    return (
      <PageShell title="Merge Wizard">
        <LoadingState label="Loading versions…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Merge Wizard">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Merge Wizard">
        <ErrorBanner error={error} onRetry={load} />
      </PageShell>
    );
  }
  if (versions.length < 2) {
    return (
      <PageShell title="Merge Wizard">
        <EmptyState>You need at least 2 saved versions to merge. Save another version first.</EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell title="Merge Wizard" description="Pick every conflict and pending item by hand - nothing here is merged automatically.">
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-neutral-600">
            Base version
            <select value={baseVersionId} onChange={(e) => setBaseVersionId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.created_at).toLocaleString()} ({v.reason})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Incoming version
            <select value={incomingVersionId} onChange={(e) => setIncomingVersionId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.created_at).toLocaleString()} ({v.reason})
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {loadingResumes ? (
        <div className="mt-4">
          <LoadingState label="Loading both resumes…" />
        </div>
      ) : resumeError ? (
        <div className="mt-4">
          <ErrorBanner error={resumeError} />
        </div>
      ) : baseResume && incomingResume && preview ? (
        <div className="mt-6 space-y-6">
          {conflicts.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-neutral-700">Conflicts ({conflicts.length})</h2>
              <div className="space-y-3">
                {conflicts.map((card) => {
                  const resolved = resolutions.find((r) => r.conflictId === card.id);
                  return (
                    <Card key={card.id} className="border-amber-200">
                      <div className="flex items-center gap-2">
                        <Badge tone="amber">{card.kind}</Badge>
                        <span className="font-medium text-neutral-900">{card.sharedLabel}</span>
                      </div>
                      <ul className="mt-2 list-inside list-disc text-xs text-neutral-600">
                        {card.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <ConflictSideCard label="Base version" side={card.left} />
                        <ConflictSideCard label="Incoming version" side={card.right} />
                      </div>
                      <div className="mt-3 flex gap-2">
                        {(["left", "right", "both"] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => resolveConflict(card.id, choice)}
                            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                              resolved?.choice === choice ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                            }`}
                          >
                            {choice === "left" ? "Keep base" : choice === "right" ? "Take incoming" : "Keep both"}
                          </button>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-700">Pending items</h2>
            <div className="space-y-4">
              {(Object.keys(SECTION_LABEL) as MergeSectionKey[]).map((section) => (
                <PendingSectionCard
                  key={section}
                  section={section}
                  base={baseResume}
                  incoming={incomingResume}
                  conflictedIds={conflictedIds[section]}
                  selections={selections}
                  onSelect={setSelection}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-700">Merge preview</h2>
            <Card>
              <table className="w-full text-xs">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-1">Section</th>
                    <th className="py-1">Kept base</th>
                    <th className="py-1">Took incoming</th>
                    <th className="py-1">Kept both</th>
                    <th className="py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sectionDiffs.map((d) => (
                    <tr key={d.section} className="border-t border-neutral-100">
                      <td className="py-1.5">{SECTION_LABEL[d.section]}</td>
                      <td className="py-1.5">{d.keptFromBase}</td>
                      <td className="py-1.5">{d.takenFromIncoming}</td>
                      <td className="py-1.5">{d.keptBoth}</td>
                      <td className="py-1.5 font-medium">{d.totalInPreview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.unresolvedConflictIds.length > 0 ? (
                <p className="mt-3 text-xs text-amber-700">{preview.unresolvedConflictIds.length} conflict(s) still need a choice before you can finalize.</p>
              ) : (
                <p className="mt-3 text-xs text-green-700">All conflicts resolved.</p>
              )}
            </Card>
          </section>

          {saveError ? <ErrorBanner error={saveError} callSite="save_version" onRetry={() => setSaveError(null)} /> : null}
          {saveSuccess ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Merge saved as a new version.</div> : null}

          <button
            type="button"
            disabled={preview.unresolvedConflictIds.length > 0 || saving}
            onClick={handleFinalize}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving merge…" : "Finalize merge as a new version"}
          </button>
        </div>
      ) : null}
    </PageShell>
  );
}

function ConflictSideCard({ label, side }: { label: string; side: ConflictCard["left"] }) {
  const entry = side.entry as unknown as { organization?: { value: string }; institution?: { value: string }; role?: { value: string }; fieldOfStudy?: { value: string }; dateRangeText?: { value: string } };
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
      <p className="font-medium text-neutral-700">{label}</p>
      <p className="mt-1 text-neutral-600">{entry.role?.value ?? entry.fieldOfStudy?.value ?? "—"}</p>
      <p className="text-neutral-500">{entry.dateRangeText?.value ?? ""}</p>
    </div>
  );
}

function PendingSectionCard({
  section,
  base,
  incoming,
  conflictedIds,
  selections,
  onSelect,
}: {
  section: MergeSectionKey;
  base: ResumeStructuredModel;
  incoming: ResumeStructuredModel;
  conflictedIds: Set<string>;
  selections: MergeSelection[];
  onSelect: (section: MergeSectionKey, itemId: string, choice: MergeSelection["choice"]) => void;
}) {
  const baseEntries = sectionArray(base, section);
  const incomingEntries = sectionArray(incoming, section);
  const baseById = new Map(baseEntries.map((e) => [e.id, e]));
  const incomingById = new Map(incomingEntries.map((e) => [e.id, e]));
  const candidateIds = [...new Set([...baseById.keys(), ...incomingById.keys()])].filter((id) => !conflictedIds.has(id));

  if (candidateIds.length === 0) return null;

  return (
    <Card>
      <h3 className="text-xs font-semibold text-neutral-700">{SECTION_LABEL[section]}</h3>
      <ul className="mt-2 space-y-2">
        {candidateIds.map((id) => {
          const inBase = baseById.has(id);
          const inIncoming = incomingById.has(id);
          const label = entryDisplayLabel((baseById.get(id) ?? incomingById.get(id))! as never);
          const current = selections.find((s) => s.section === section && s.itemId === id)?.choice;
          return (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-neutral-50 px-3 py-2 text-xs">
              <span className="font-medium text-neutral-800">{label}</span>
              <div className="flex gap-1.5">
                {inBase ? (
                  <ChoiceButton active={current === "keep-base"} onClick={() => onSelect(section, id, "keep-base")}>
                    Keep
                  </ChoiceButton>
                ) : null}
                {inIncoming ? (
                  <ChoiceButton active={current === "take-incoming"} onClick={() => onSelect(section, id, "take-incoming")}>
                    Take incoming
                  </ChoiceButton>
                ) : null}
                {inBase && inIncoming ? (
                  <ChoiceButton active={current === "keep-both"} onClick={() => onSelect(section, id, "keep-both")}>
                    Keep both
                  </ChoiceButton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs font-medium ${active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"}`}
    >
      {children}
    </button>
  );
}
