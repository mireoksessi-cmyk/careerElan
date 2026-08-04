"use client";

/*
  TASK 9 - Dev-only Inspection UI for the Resume Structured Model.
  Mirrors app/dev/resume-semantic/page.tsx's own established convention:
  unauthenticated, nav-unlinked, no Supabase/network calls beyond its
  own internal fixture-preview route, safe to delete. This is a QA/
  inspection surface for checking Phase 2's decomposition against Phase
  1's own output - explicitly NOT a design/production preview (spec
  section 20: "이 화면은 디자인 Preview가 아니다").
*/

import { useEffect, useState } from "react";

type SourceTraceView = { sourceSectionId: string; sourceBlockIds: string[]; sourceElementIds: string[] };
type StructuredTextValueView = { value: string; confidence: number; extractionMethod: string; source: SourceTraceView };
type StructuredBulletView = { id: string; text: string; source: SourceTraceView };

type ResumeIdentityView = {
  fullName?: StructuredTextValueView;
  headline?: StructuredTextValueView;
  email?: StructuredTextValueView;
  phone?: StructuredTextValueView;
  location?: StructuredTextValueView;
  linkedin?: StructuredTextValueView;
  portfolio?: StructuredTextValueView;
  otherContactLines: StructuredTextValueView[];
};

type ExperienceEntryView = {
  id: string;
  organization?: StructuredTextValueView;
  role?: StructuredTextValueView;
  location?: StructuredTextValueView;
  dateRangeText?: StructuredTextValueView;
  bullets: StructuredBulletView[];
  descriptionParagraphs: StructuredTextValueView[];
  rawHeaderText: string;
  isVolunteer: boolean;
  isUncertain: boolean;
  reasonCodes: string[];
  source: SourceTraceView;
};

type GenericEntryView = {
  id: string;
  rawHeaderText: string;
  isUncertain: boolean;
  reasonCodes: string[];
  source: SourceTraceView;
  [key: string]: unknown;
};

type CustomSectionView = {
  id: string;
  originalHeading: string | null;
  displayHeading: string | null;
  paragraphs: StructuredTextValueView[];
  bullets: StructuredBulletView[];
  sourceOrder: number;
  source: SourceTraceView;
};

type StructuredResumeValidationReportView = {
  passed: boolean;
  sourceSectionCount: number;
  representedSectionCount: number;
  missingSectionIds: string[];
  sourceBlockCount: number;
  representedBlockCount: number;
  missingBlockIds: string[];
  duplicateBlockIds: string[];
  inventedFactValues: string[];
  volunteerMixedIntoProfessional: string[];
  missingCustomSections: string[];
  warnings: string[];
};

type ResumeStructuredModelView = {
  schemaVersion: string;
  source: { fileName: string; fileType: string };
  identity?: ResumeIdentityView;
  professionalSummary?: { text: string; source: SourceTraceView };
  skillGroups: { label?: string; skills: string[]; source: SourceTraceView }[];
  professionalExperience: ExperienceEntryView[];
  volunteerExperience: ExperienceEntryView[];
  education: GenericEntryView[];
  credentials: GenericEntryView[];
  projects: ExperienceEntryView[];
  awards: GenericEntryView[];
  publications: GenericEntryView[];
  customSections: CustomSectionView[];
  slotAvailability: Record<string, boolean>;
  validation: StructuredResumeValidationReportView;
};

type LosslessResumeDocumentView = {
  schemaVersion: string;
  source: { fileName: string; fileType: string; pageCount?: number };
  sections: { id: string; originalHeading: string | null; normalizedType: string; blocks: unknown[] }[];
  validation: { passed: boolean; missingElementIds: string[]; duplicateElementIds: string[] };
};

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        background: ok ? "#1a7f37" : "#c0362c",
      }}
    >
      {label}
    </span>
  );
}

function ConfidenceValue({ v, label }: { v?: StructuredTextValueView; label: string }) {
  if (!v) return null;
  return (
    <div style={{ fontSize: 13, marginBottom: 2 }}>
      <span style={{ color: "#888", minWidth: 90, display: "inline-block" }}>{label}</span>
      {v.value}
      <span style={{ color: "#aaa", fontSize: 11, marginLeft: 6 }}>
        ({v.extractionMethod}, conf {v.confidence.toFixed(2)}, blocks: {v.source.sourceBlockIds.join(",")})
      </span>
    </div>
  );
}

function EntryCard({ entry }: { entry: ExperienceEntryView }) {
  return (
    <div
      style={{
        border: `1px solid ${entry.isUncertain ? "#e0a800" : "#ccd6e0"}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        background: entry.isUncertain ? "#fffbea" : "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>
          {entry.role?.value ?? "(no role)"} {entry.organization ? `@ ${entry.organization.value}` : ""}
        </strong>
        <span style={{ fontSize: 12, color: "#555" }}>
          {entry.isVolunteer ? "VOLUNTEER · " : ""}
          {entry.isUncertain ? "UNCERTAIN" : "confident"}
        </span>
      </div>
      <ConfidenceValue v={entry.organization} label="organization" />
      <ConfidenceValue v={entry.role} label="role" />
      <ConfidenceValue v={entry.location} label="location" />
      <ConfidenceValue v={entry.dateRangeText} label="dateRangeText" />
      {entry.reasonCodes.length > 0 && <div style={{ fontSize: 11, color: "#888" }}>reasonCodes: {entry.reasonCodes.join(", ")}</div>}
      {entry.bullets.length > 0 && (
        <ul style={{ fontSize: 12, margin: "6px 0 0 18px" }}>
          {entry.bullets.map((b) => (
            <li key={b.id}>{b.text}</li>
          ))}
        </ul>
      )}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, color: "#888" }}>rawHeaderText / full source trace</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 6 }}>{entry.rawHeaderText}</pre>
        <div style={{ fontSize: 11, color: "#888" }}>
          section: {entry.source.sourceSectionId} · blocks: {entry.source.sourceBlockIds.join(", ")}
        </div>
      </details>
    </div>
  );
}

function GenericEntryCard({ entry, titleField }: { entry: GenericEntryView; titleField: string[] }) {
  const title = titleField.map((f) => (entry[f] as StructuredTextValueView | undefined)?.value).filter(Boolean).join(" · ") || "(untitled)";
  return (
    <div
      style={{
        border: `1px solid ${entry.isUncertain ? "#e0a800" : "#ccd6e0"}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        background: entry.isUncertain ? "#fffbea" : "#fff",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{title}</strong>
        <span style={{ color: "#555" }}>{entry.isUncertain ? "UNCERTAIN" : "confident"}</span>
      </div>
      {entry.reasonCodes.length > 0 && <div style={{ color: "#888" }}>reasonCodes: {entry.reasonCodes.join(", ")}</div>}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: "#888" }}>raw / full field JSON</summary>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 6 }}>{JSON.stringify(entry, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function ResumeStructuredInspectionPage() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [document, setDocument] = useState<LosslessResumeDocumentView | null>(null);
  const [model, setModel] = useState<ResumeStructuredModelView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/resume-structured-preview")
      .then((res) => res.json())
      .then((data) => {
        const list: string[] = data.fixtures ?? [];
        setFixtures(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch((err) => setError(String(err)));
  }, []);

  async function runFixture(fixture: string) {
    setLoading(true);
    setError(null);
    setDocument(null);
    setModel(null);
    try {
      const res = await fetch(`/api/internal/resume-structured-preview?fixture=${encodeURIComponent(fixture)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDocument(data.document);
      setModel(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Resume Structured Model - Dev Inspection</h1>
      <p style={{ fontSize: 13, color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. This is not a design preview -
        it shows Phase 1 (Lossless Semantic) vs Phase 2 (Structured Model) side by side to verify decomposition
        correctness, source traceability, and validator results.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: 6, minWidth: 320 }}>
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={() => selected && runFixture(selected)} disabled={!selected || loading} style={{ padding: "6px 14px" }}>
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {error && <div style={{ color: "#c0362c", marginBottom: 16 }}>{error}</div>}

      {model && document && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>Phase 1 - Lossless Semantic</strong>
                <Badge ok={document.validation.passed} label={document.validation.passed ? "PASSED" : "FAILED"} />
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {document.sections.length} sections · missing elements: {document.validation.missingElementIds.length} · duplicate elements:{" "}
                {document.validation.duplicateElementIds.length}
              </div>
            </div>
            <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>Phase 2 - Structured Model</strong>
                <Badge ok={model.validation.passed} label={model.validation.passed ? "PASSED" : "FAILED"} />
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                sections: {model.validation.representedSectionCount}/{model.validation.sourceSectionCount} · blocks:{" "}
                {model.validation.representedBlockCount}/{model.validation.sourceBlockCount} · missing:{" "}
                {model.validation.missingBlockIds.length} · duplicate: {model.validation.duplicateBlockIds.length} · invented:{" "}
                {model.validation.inventedFactValues.length} · volunteer-mixed: {model.validation.volunteerMixedIntoProfessional.length} ·
                missing-custom: {model.validation.missingCustomSections.length}
              </div>
              {model.validation.warnings.length > 0 && (
                <div style={{ fontSize: 11, color: "#c07c00", marginTop: 4 }}>warnings: {model.validation.warnings.join(" | ")}</div>
              )}
            </div>
          </div>

          <h2 style={{ fontSize: 15 }}>Slot Availability</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {Object.entries(model.slotAvailability).map(([slot, available]) => (
              <span
                key={slot}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: available ? "#e6f4ea" : "#f2f2f2",
                  color: available ? "#1a7f37" : "#999",
                }}
              >
                {slot}
              </span>
            ))}
          </div>

          <h2 style={{ fontSize: 15 }}>Identity</h2>
          <div style={{ border: "1px solid #ccd6e0", borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13 }}>
            {model.identity ? (
              <>
                <ConfidenceValue v={model.identity.fullName} label="fullName" />
                <ConfidenceValue v={model.identity.headline} label="headline" />
                <ConfidenceValue v={model.identity.email} label="email" />
                <ConfidenceValue v={model.identity.phone} label="phone" />
                <ConfidenceValue v={model.identity.location} label="location" />
                <ConfidenceValue v={model.identity.linkedin} label="linkedin" />
                <ConfidenceValue v={model.identity.portfolio} label="portfolio" />
                {model.identity.otherContactLines.map((v, i) => (
                  <ConfidenceValue key={i} v={v} label="other" />
                ))}
              </>
            ) : (
              <span style={{ color: "#888" }}>(no identity resolved for this fixture)</span>
            )}
          </div>

          <h2 style={{ fontSize: 15 }}>Professional Summary</h2>
          <div style={{ border: "1px solid #ccd6e0", borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 13, whiteSpace: "pre-wrap" }}>
            {model.professionalSummary?.text ?? <span style={{ color: "#888" }}>(none)</span>}
          </div>

          <h2 style={{ fontSize: 15 }}>Core Skills ({model.skillGroups.length} groups)</h2>
          <div style={{ marginBottom: 16, fontSize: 13 }}>
            {model.skillGroups.map((g, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <strong>{g.label ?? "(unlabeled)"}</strong>: {g.skills.join(", ")}
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: 15 }}>Professional Experience ({model.professionalExperience.length})</h2>
          {model.professionalExperience.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}

          <h2 style={{ fontSize: 15 }}>Volunteer Experience ({model.volunteerExperience.length})</h2>
          {model.volunteerExperience.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}

          <h2 style={{ fontSize: 15 }}>Education ({model.education.length})</h2>
          {model.education.map((e) => (
            <GenericEntryCard key={e.id} entry={e} titleField={["institution", "credential"]} />
          ))}

          <h2 style={{ fontSize: 15 }}>Certifications / Licenses ({model.credentials.length})</h2>
          {model.credentials.map((e) => (
            <GenericEntryCard key={e.id} entry={e} titleField={["name", "issuer"]} />
          ))}

          <h2 style={{ fontSize: 15 }}>Projects ({model.projects.length})</h2>
          {model.projects.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}

          <h2 style={{ fontSize: 15 }}>Awards ({model.awards.length})</h2>
          {model.awards.map((e) => (
            <GenericEntryCard key={e.id} entry={e} titleField={["name", "issuer"]} />
          ))}

          <h2 style={{ fontSize: 15 }}>Publications ({model.publications.length})</h2>
          {model.publications.map((e) => (
            <GenericEntryCard key={e.id} entry={e} titleField={["title"]} />
          ))}

          <h2 style={{ fontSize: 15 }}>Additional Information / Custom ({model.customSections.length})</h2>
          {model.customSections.map((c) => (
            <div key={c.id} style={{ border: "1px solid #ccd6e0", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 12 }}>
              <strong>{c.originalHeading ?? "(no heading found)"}</strong>
              <div style={{ marginTop: 4 }}>
                {c.paragraphs.map((p, i) => (
                  <div key={i}>{p.value}</div>
                ))}
                {c.bullets.length > 0 && (
                  <ul style={{ margin: "4px 0 0 18px" }}>
                    {c.bullets.map((b) => (
                      <li key={b.id}>{b.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}

          <h2 style={{ fontSize: 15 }}>Full Model JSON</h2>
          <details style={{ marginBottom: 24 }}>
            <summary style={{ cursor: "pointer", fontSize: 12 }}>expand full ResumeStructuredModel</summary>
            <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 8, maxHeight: 500, overflow: "auto" }}>
              {JSON.stringify(model, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
