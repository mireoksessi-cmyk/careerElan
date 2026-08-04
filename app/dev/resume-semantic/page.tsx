"use client";

/*
  TASK 7 - Dev-only Inspection UI for the Lossless Resume Semantic
  Engine. Mirrors app/dev/dpe-measure/page.tsx's own established
  convention: unauthenticated, nav-unlinked, no Supabase/network calls
  beyond its own internal fixture-preview route, safe to delete. This is
  a QA/inspection surface for checking semantic correctness and loss -
  explicitly NOT a design/production template (spec section 12).
*/

import { useEffect, useState } from "react";

type SemanticContentBlockView = {
  id: string;
  text: string;
  rawText: string;
  pageIndex: number;
  blockType: string;
};

type LosslessResumeSectionView = {
  id: string;
  originalHeading: string | null;
  normalizedHeading: string | null;
  normalizedType: string;
  displayHeading: string | null;
  sourceOrder: number;
  confidence: number;
  classificationMethod: string;
  reasonCodes: string[];
  blocks: SemanticContentBlockView[];
  rawText: string;
  isUncertain: boolean;
};

type LosslessValidationReportView = {
  passed: boolean;
  sourceElementCount: number;
  representedElementCount: number;
  missingElementIds: string[];
  duplicateElementIds: string[];
  missingTextSpans: string[];
  inventedTextSpans: string[];
  orderViolations: Array<{ beforeId: string; afterId: string }>;
  warnings: string[];
};

type LosslessResumeDocumentView = {
  schemaVersion: string;
  source: { fileName: string; fileType: string; pageCount?: number };
  identityBlocks: SemanticContentBlockView[];
  sections: LosslessResumeSectionView[];
  unassignedBlocks: SemanticContentBlockView[];
  validation: LosslessValidationReportView;
};

function ValidationBadge({ passed }: { passed: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        background: passed ? "#1a7f37" : "#c0362c",
      }}
    >
      {passed ? "VALIDATION PASSED" : "VALIDATION FAILED"}
    </span>
  );
}

function BlockRow({ block }: { block: SemanticContentBlockView }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid #eee" }}>
      <span style={{ color: "#888", minWidth: 90 }}>{block.blockType}</span>
      <span style={{ color: "#888", minWidth: 40 }}>p{block.pageIndex}</span>
      <span style={{ whiteSpace: "pre-wrap" }}>{block.rawText}</span>
    </div>
  );
}

function SectionCard({ section }: { section: LosslessResumeSectionView }) {
  return (
    <div
      style={{
        border: `1px solid ${section.isUncertain ? "#e0a800" : "#ccd6e0"}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        background: section.isUncertain ? "#fffbea" : "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{section.originalHeading ?? "(no heading found)"}</strong>
        <span style={{ fontSize: 12, color: "#555" }}>
          #{section.sourceOrder} · {section.normalizedType} · {section.classificationMethod} · conf {section.confidence.toFixed(2)}
          {section.isUncertain ? " · UNCERTAIN" : ""}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
        normalizedHeading: {section.normalizedHeading ?? "null"} · displayHeading: {section.displayHeading ?? "null"} · {section.blocks.length} blocks
      </div>
      {section.reasonCodes.length > 0 && (
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>reasonCodes: {section.reasonCodes.join(", ")}</div>
      )}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 12 }}>rawText preview / blocks</summary>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 8, marginTop: 6 }}>
          {section.rawText.slice(0, 800)}
          {section.rawText.length > 800 ? "…" : ""}
        </pre>
        <div style={{ marginTop: 6 }}>
          {section.blocks.map((b) => (
            <BlockRow key={b.id} block={b} />
          ))}
        </div>
      </details>
    </div>
  );
}

export default function ResumeSemanticInspectionPage() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [document, setDocument] = useState<LosslessResumeDocumentView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/resume-semantic-preview")
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
    try {
      const res = await fetch(`/api/internal/resume-semantic-preview?fixture=${encodeURIComponent(fixture)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDocument(data.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Lossless Resume Semantic Engine - Dev Inspection</h1>
      <p style={{ fontSize: 13, color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. Runs the Phase 1 rule-based
        engine against a real fixture and shows exactly what was found, classified, and validated.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: 6, minWidth: 320 }}>
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          onClick={() => selected && runFixture(selected)}
          disabled={!selected || loading}
          style={{ padding: "6px 14px" }}
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {error && <div style={{ color: "#c0362c", marginBottom: 16 }}>{error}</div>}

      {document && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13 }}>
              <strong>{document.source.fileName}</strong> · {document.source.fileType} · {document.source.pageCount ?? "?"} page(s) ·
              schema {document.schemaVersion}
            </div>
            <ValidationBadge passed={document.validation.passed} />
          </div>

          <div style={{ fontSize: 12, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>
            source elements: {document.validation.sourceElementCount} · represented: {document.validation.representedElementCount} · missing:{" "}
            {document.validation.missingElementIds.length} · duplicate: {document.validation.duplicateElementIds.length} · missing text spans:{" "}
            {document.validation.missingTextSpans.length} · invented text spans: {document.validation.inventedTextSpans.length} · order
            violations: {document.validation.orderViolations.length}
            {document.validation.warnings.length > 0 && (
              <div style={{ color: "#c07c00", marginTop: 4 }}>warnings: {document.validation.warnings.join(" | ")}</div>
            )}
          </div>

          <h2 style={{ fontSize: 15 }}>Identity blocks ({document.identityBlocks.length})</h2>
          <div style={{ marginBottom: 16 }}>
            {document.identityBlocks.map((b) => (
              <BlockRow key={b.id} block={b} />
            ))}
          </div>

          <h2 style={{ fontSize: 15 }}>Sections ({document.sections.length})</h2>
          {document.sections.map((s) => (
            <SectionCard key={s.id} section={s} />
          ))}

          <h2 style={{ fontSize: 15 }}>Unassigned blocks ({document.unassignedBlocks.length})</h2>
          <div>
            {document.unassignedBlocks.map((b) => (
              <BlockRow key={b.id} block={b} />
            ))}
            {document.unassignedBlocks.length === 0 && <div style={{ fontSize: 12, color: "#888" }}>(none)</div>}
          </div>
        </>
      )}
    </div>
  );
}
