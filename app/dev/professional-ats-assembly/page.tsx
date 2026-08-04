"use client";

/*
  TASK 9 - Dev-only Inspection UI for the Professional ATS Assembly
  Engine. Mirrors app/dev/resume-structured/page.tsx's own established
  convention: unauthenticated, nav-unlinked, no Supabase/network calls
  beyond its own internal fixture-preview route, safe to delete. This is
  NOT a resume design preview - it shows section visibility, fixed
  order, block grouping, and layout intent for QA purposes (spec
  section 12: "이 화면은 디자인 Preview가 아니다").
*/

import { useEffect, useState } from "react";

type SourceTraceView = { sourceSectionId: string; sourceBlockIds: string[]; sourceElementIds: string[] };

type AssemblyBlockView = {
  id: string;
  kind: string;
  sourceEntryId?: string;
  sourceSectionIds: string[];
  sourceBlockIds: string[];
  estimatedContentUnits: number;
  minVisibleContentUnits: number;
  breakPolicy: string;
  keepTogether: string;
  canSplit: boolean;
  splitStrategy: string;
  priority: number;
  isOptional: boolean;
  isUncertain: boolean;
  payload: unknown;
};

type ProfessionalAtsAssemblySectionView = {
  key: string;
  label: string | null;
  order: number;
  visible: boolean;
  visibilityReason: string;
  blocks: AssemblyBlockView[];
  keepHeadingWithFirstBlock: boolean;
  breakBefore: string;
  breakAfter: string;
  minBlocksToShow: number;
  sourceSectionIds: string[];
};

type ProfessionalAtsAssemblyValidationReportView = {
  passed: boolean;
  visibleSectionKeys: string[];
  hiddenSectionKeys: string[];
  orderViolations: string[];
  volunteerPlacementViolations: string[];
  missingEntryIds: string[];
  duplicateEntryIds: string[];
  invalidHiddenSectionsWithBlocks: string[];
  destructiveCompactionFlags: string[];
  warnings: string[];
};

type ProfessionalAtsAssemblyDocumentView = {
  schemaVersion: string;
  templateId: string;
  sourceModelVersion: string;
  sections: ProfessionalAtsAssemblySectionView[];
  visibleSectionKeys: string[];
  hiddenSectionKeys: string[];
  defaultDensity: string;
  compactionPolicy: {
    allowedDensities: string[];
    canReduceSectionSpacing: boolean;
    canReduceEntrySpacing: boolean;
    canReduceBulletSpacing: boolean;
    canTightenSkillLayout: boolean;
    canTrimContent: boolean;
    canDropSections: boolean;
    canDropEntries: boolean;
    canDropBullets: boolean;
  };
  validation: ProfessionalAtsAssemblyValidationReportView;
};

type ResumeStructuredModelView = {
  professionalExperience: unknown[];
  volunteerExperience: unknown[];
  education: unknown[];
  credentials: unknown[];
  projects: unknown[];
  awards: unknown[];
  publications: unknown[];
  customSections: unknown[];
  skillGroups: unknown[];
  identity?: unknown;
  professionalSummary?: unknown;
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

function BlockRow({ block }: { block: AssemblyBlockView }) {
  return (
    <div
      style={{
        border: `1px solid ${block.isUncertain ? "#e0a800" : "#ccd6e0"}`,
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        background: block.isUncertain ? "#fffbea" : "#fff",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{block.kind}</strong>
        <span style={{ color: "#555" }}>priority {block.priority}{block.isUncertain ? " · UNCERTAIN" : ""}</span>
      </div>
      <div style={{ color: "#666", marginTop: 4 }}>
        units: {block.estimatedContentUnits} (min {block.minVisibleContentUnits}) · break: {block.breakPolicy} · keepTogether: {block.keepTogether} · canSplit:{" "}
        {String(block.canSplit)} ({block.splitStrategy})
      </div>
      <div style={{ color: "#888", marginTop: 2 }}>
        source: {block.sourceSectionIds.join(", ")} · blocks: {block.sourceBlockIds.join(", ") || "(none)"}
        {block.sourceEntryId ? ` · entryId: ${block.sourceEntryId}` : ""}
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: ProfessionalAtsAssemblySectionView }) {
  return (
    <div
      style={{
        border: `1px solid ${section.visible ? "#ccd6e0" : "#e0e0e0"}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        background: section.visible ? "#fff" : "#fafafa",
        opacity: section.visible ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 13 }}>
          #{section.order} {section.label ?? `(${section.key}, no label)`}
        </strong>
        <span style={{ fontSize: 12 }}>
          <Badge ok={section.visible} label={section.visible ? "VISIBLE" : `HIDDEN (${section.visibilityReason})`} />
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
        {section.blocks.length} block(s) · keepHeadingWithFirstBlock: {String(section.keepHeadingWithFirstBlock)} · breakBefore: {section.breakBefore} ·
        breakAfter: {section.breakAfter}
      </div>
      {section.blocks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {section.blocks.map((b) => (
            <BlockRow key={b.id} block={b} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProfessionalAtsAssemblyInspectionPage() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [model, setModel] = useState<ResumeStructuredModelView | null>(null);
  const [assembly, setAssembly] = useState<ProfessionalAtsAssemblyDocumentView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/professional-ats-assembly-preview")
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
    setModel(null);
    setAssembly(null);
    try {
      const res = await fetch(`/api/internal/professional-ats-assembly-preview?fixture=${encodeURIComponent(fixture)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModel(data.model);
      setAssembly(data.assembly);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Professional ATS Assembly Engine - Dev Inspection</h1>
      <p style={{ fontSize: 13, color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. This is NOT a resume design
        preview - it shows section visibility, fixed order, entry-to-block grouping, and renderer-independent layout
        intent (break/keep-together policy, content units, density policy) for verification purposes only.
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

      {model && assembly && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              templateId: {assembly.templateId} · schema {assembly.schemaVersion} · sourceModelVersion {assembly.sourceModelVersion} · default density:{" "}
              {assembly.defaultDensity}
            </div>
            <Badge ok={assembly.validation.passed} label={assembly.validation.passed ? "VALIDATION PASSED" : "VALIDATION FAILED"} />
          </div>

          <div style={{ fontSize: 12, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>
            visible: {assembly.visibleSectionKeys.join(", ") || "(none)"} <br />
            hidden: {assembly.hiddenSectionKeys.join(", ") || "(none)"} <br />
            phase2 counts - prof: {model.professionalExperience.length} · vol: {model.volunteerExperience.length} · edu: {model.education.length} · cred:{" "}
            {model.credentials.length} · proj: {model.projects.length} · award: {model.awards.length} · pub: {model.publications.length} · custom:{" "}
            {model.customSections.length} · skillGroups: {model.skillGroups.length} · identity: {model.identity ? "y" : "n"} · summary:{" "}
            {model.professionalSummary ? "y" : "n"}
            {(assembly.validation.orderViolations.length > 0 ||
              assembly.validation.volunteerPlacementViolations.length > 0 ||
              assembly.validation.missingEntryIds.length > 0 ||
              assembly.validation.duplicateEntryIds.length > 0 ||
              assembly.validation.invalidHiddenSectionsWithBlocks.length > 0 ||
              assembly.validation.destructiveCompactionFlags.length > 0) && (
              <div style={{ color: "#c0362c", marginTop: 6 }}>
                {assembly.validation.orderViolations.length > 0 && <div>orderViolations: {assembly.validation.orderViolations.join(" | ")}</div>}
                {assembly.validation.volunteerPlacementViolations.length > 0 && (
                  <div>volunteerPlacementViolations: {assembly.validation.volunteerPlacementViolations.join(" | ")}</div>
                )}
                {assembly.validation.missingEntryIds.length > 0 && <div>missingEntryIds: {assembly.validation.missingEntryIds.join(", ")}</div>}
                {assembly.validation.duplicateEntryIds.length > 0 && <div>duplicateEntryIds: {assembly.validation.duplicateEntryIds.join(", ")}</div>}
                {assembly.validation.invalidHiddenSectionsWithBlocks.length > 0 && (
                  <div>invalidHiddenSectionsWithBlocks: {assembly.validation.invalidHiddenSectionsWithBlocks.join(", ")}</div>
                )}
                {assembly.validation.destructiveCompactionFlags.length > 0 && (
                  <div>destructiveCompactionFlags: {assembly.validation.destructiveCompactionFlags.join(", ")}</div>
                )}
              </div>
            )}
            {assembly.validation.warnings.length > 0 && <div style={{ color: "#c07c00", marginTop: 4 }}>warnings: {assembly.validation.warnings.join(" | ")}</div>}
          </div>

          <h2 style={{ fontSize: 15 }}>Compaction Policy</h2>
          <div style={{ fontSize: 12, marginBottom: 16, border: "1px solid #ccd6e0", borderRadius: 8, padding: 10 }}>
            allowedDensities: {assembly.compactionPolicy.allowedDensities.join(", ")} <br />
            canReduceSectionSpacing: {String(assembly.compactionPolicy.canReduceSectionSpacing)} · canReduceEntrySpacing:{" "}
            {String(assembly.compactionPolicy.canReduceEntrySpacing)} · canReduceBulletSpacing: {String(assembly.compactionPolicy.canReduceBulletSpacing)} ·
            canTightenSkillLayout: {String(assembly.compactionPolicy.canTightenSkillLayout)} <br />
            <strong>
              canTrimContent: {String(assembly.compactionPolicy.canTrimContent)} · canDropSections: {String(assembly.compactionPolicy.canDropSections)} ·
              canDropEntries: {String(assembly.compactionPolicy.canDropEntries)} · canDropBullets: {String(assembly.compactionPolicy.canDropBullets)}
            </strong>
          </div>

          <h2 style={{ fontSize: 15 }}>Sections (fixed order, {assembly.sections.length} slots)</h2>
          {assembly.sections.map((s) => (
            <SectionCard key={s.key} section={s} />
          ))}
        </>
      )}
    </div>
  );
}
