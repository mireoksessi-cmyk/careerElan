"use client";

/*
  TASK 8 - Dev-only UI for the Professional ATS DOCX Renderer. fixture
  selector, Letter/A4, density (user-selectable here, unlike Phase 5A's
  PDF UI - Phase 5B does not inherit an auto-fit density from Phase 4,
  spec section 4's own input contract takes density directly), Generate
  DOCX, Download DOCX, byteLength/SHA-256/structural/text/pagination-
  intent/parity display.
*/
import { useEffect, useState } from "react";
import type { ProfessionalAtsDocxResult } from "@/lib/documentPreservation/professionalAtsDocx/types";
import type { AssemblyDensity } from "@/lib/documentPreservation/professionalAtsAssembly/types";

type PaperSize = "letter" | "a4";
type DocxResultWithoutBytes = Omit<ProfessionalAtsDocxResult, "bytes">;

const DENSITIES: AssemblyDensity[] = ["comfortable", "balanced", "compact", "ultra-compact"];

export default function ProfessionalAtsDocxPreviewClient() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [fixture, setFixture] = useState<string>("");
  const [paperSize, setPaperSize] = useState<PaperSize>("letter");
  const [density, setDensity] = useState<AssemblyDensity>("comfortable");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DocxResultWithoutBytes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/professional-ats-docx-preview")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.fixtures)) {
          setFixtures(data.fixtures);
          if (data.fixtures.length > 0) setFixture(data.fixtures[0]);
        }
      })
      .catch(() => setError("Failed to load fixture list."));
  }, []);

  async function handleGenerate() {
    if (!fixture) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ fixture, paperSize, density });
      const res = await fetch(`/api/internal/professional-ats-docx-preview?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!fixture) return;
    const params = new URLSearchParams({ fixture, paperSize, density, download: "1" });
    window.location.href = `/api/internal/professional-ats-docx-preview?${params.toString()}`;
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 900 }}>
      <h1>Professional ATS DOCX Preview - Dev Inspection</h1>
      <p style={{ color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. Generates a real editable
        OOXML DOCX via the `docx` package directly from Phase 3&apos;s assembly, then structurally/text/pagination-
        intent/parity validates the output.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select value={paperSize} onChange={(e) => setPaperSize(e.target.value as PaperSize)}>
          <option value="letter">Letter (8.5×11in)</option>
          <option value="a4">A4 (210×297mm)</option>
        </select>
        <select value={density} onChange={(e) => setDensity(e.target.value as AssemblyDensity)}>
          {DENSITIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button onClick={handleGenerate} disabled={loading} style={{ padding: "6px 14px" }}>
          {loading ? "Generating..." : "Generate DOCX"}
        </button>
        <button onClick={handleDownload} disabled={!fixture} style={{ padding: "6px 14px" }}>
          Download DOCX
        </button>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 16 }}>Error: {error}</div>}

      {result && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            templateId: {result.templateId} · paperSize: {result.paperSize} · density: {result.density}
          </div>
          <div style={{ marginBottom: 8 }}>
            fileName: <code>{result.fileName}</code>
          </div>
          <div style={{ marginBottom: 8 }}>
            byteLength: {result.byteLength} · SHA-256: <code>{result.sha256.slice(0, 16)}...</code>
          </div>
          <div
            style={{
              display: "inline-block",
              padding: "2px 10px",
              borderRadius: 4,
              marginBottom: 12,
              background: result.validation.passed ? "#e6f4ea" : "#fdecea",
              color: result.validation.passed ? "#1e7e34" : "#b00020",
              fontWeight: 600,
            }}
          >
            {result.validation.passed ? "VALIDATION PASSED" : "VALIDATION FAILED"}
          </div>

          <h3>Structure summary</h3>
          <ul>
            <li>paragraphCount: {result.structure.paragraphCount}</li>
            <li>textRunCount: {result.structure.textRunCount}</li>
            <li>bulletCount: {result.structure.bulletCount}</li>
            <li>sectionCount: {result.structure.sectionCount}</li>
          </ul>

          <h3>Structural validation</h3>
          <ul>
            <li>validZipHeader: {String(result.validation.structural.validZipHeader)}</li>
            <li>parseableZip: {String(result.validation.structural.parseableZip)}</li>
            <li>requiredPartsPresent: {String(result.validation.structural.requiredPartsPresent)}</li>
            <li>missingParts: {JSON.stringify(result.validation.structural.missingParts)}</li>
            <li>parseableXml: {String(result.validation.structural.parseableXml)}</li>
            <li>macroFree: {String(result.validation.structural.macroFree)}</li>
            <li>encrypted: {String(result.validation.structural.encrypted)}</li>
            <li>externalRelationships: {JSON.stringify(result.validation.structural.externalRelationships)}</li>
            <li>
              pageSize: {result.validation.structural.pageSize.widthTwips}×{result.validation.structural.pageSize.heightTwips} twips (
              {result.validation.structural.pageSize.orientation})
            </li>
          </ul>

          <h3>Text preservation</h3>
          <ul>
            <li>
              expected/found: {result.validation.text.expectedFragmentCount} / {result.validation.text.foundFragmentCount}
            </li>
            <li>missingFragments: {result.validation.text.missingFragments.length}</li>
            <li>inventedFragments: {result.validation.text.inventedFragments.length}</li>
            <li>duplicateEntryIds: {result.validation.text.duplicateEntryIds.length}</li>
          </ul>

          <h3>Pagination intent</h3>
          <ul>
            <li>headingsWithKeepNext: {result.validation.paginationIntent.headingsWithKeepNext}</li>
            <li>entryHeadersWithKeepNext: {result.validation.paginationIntent.entryHeadersWithKeepNext}</li>
            <li>bulletsWithKeepLines: {result.validation.paginationIntent.bulletsWithKeepLines}</li>
            <li>violations: {JSON.stringify(result.validation.paginationIntent.violations)}</li>
          </ul>

          <h3>HTML/PDF/DOCX content parity</h3>
          <ul>
            <li>sameVisibleSections: {String(result.validation.parity.sameVisibleSections)}</li>
            <li>sameSectionOrder: {String(result.validation.parity.sameSectionOrder)}</li>
            <li>sameEntryOrder: {String(result.validation.parity.sameEntryOrder)}</li>
            <li>sameProtectedFacts: {String(result.validation.parity.sameProtectedFacts)}</li>
            <li>sourceCoveragePercent: {result.validation.parity.sourceCoveragePercent}%</li>
          </ul>

          <h3>Source mapping</h3>
          <ul>
            {result.sourceMapping.map((m) => (
              <li key={`${m.sourceBlockId}#${m.sourceEntryId ?? ""}`}>
                {m.sourceBlockId}
                {m.sourceEntryId ? ` (${m.sourceEntryId})` : ""}: paragraphs {JSON.stringify(m.paragraphIndexes)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
