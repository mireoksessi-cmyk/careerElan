"use client";

/*
  TASK 8 - Dev-only UI for the Professional ATS PDF Renderer. fixture
  selector, Letter/A4, Generate PDF, Download PDF, pageCount,
  byteLength, SHA-256, validation status (structural/text/parity),
  source coverage, error diagnostics. Density is not user-selectable
  here (auto-fit only, per spec section 13's "Phase 5A는 다시 density를
  독립 선택하지 않는다") - the chosen density is shown read-only,
  exactly mirroring what buildProfessionalAtsHtmlPreview already chose.
*/
import { useEffect, useState } from "react";
import type { ProfessionalAtsPdfResult } from "@/lib/documentPreservation/professionalAtsPdf/types";

type PaperSize = "letter" | "a4";
type PdfResultWithoutBytes = Omit<ProfessionalAtsPdfResult, "bytes">;

export default function ProfessionalAtsPdfPreviewClient() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [fixture, setFixture] = useState<string>("");
  const [paperSize, setPaperSize] = useState<PaperSize>("letter");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PdfResultWithoutBytes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/professional-ats-pdf-preview")
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
      const params = new URLSearchParams({ fixture, paperSize });
      const res = await fetch(`/api/internal/professional-ats-pdf-preview?${params.toString()}`);
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
    const params = new URLSearchParams({ fixture, paperSize, download: "1" });
    window.location.href = `/api/internal/professional-ats-pdf-preview?${params.toString()}`;
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 900 }}>
      <h1>Professional ATS PDF Preview - Dev Inspection</h1>
      <p style={{ color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. Generates a real PDF via
        Playwright page.pdf() over Phase 4&apos;s already-validated paginated HTML, then structurally/text/parity
        validates the output.
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
        <button onClick={handleGenerate} disabled={loading} style={{ padding: "6px 14px" }}>
          {loading ? "Generating..." : "Generate PDF"}
        </button>
        <button onClick={handleDownload} disabled={!fixture} style={{ padding: "6px 14px" }}>
          Download PDF
        </button>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 16 }}>Error: {error}</div>}

      {result && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            templateId: {result.templateId} · paperSize: {result.paperSize} · density (auto-fit, chosen): {result.density}
          </div>
          <div style={{ marginBottom: 8 }}>
            fileName: <code>{result.fileName}</code>
          </div>
          <div style={{ marginBottom: 8 }}>
            pageCount: {result.pageCount} · byteLength: {result.byteLength} · SHA-256: <code>{result.sha256.slice(0, 16)}...</code>
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

          <h3>Structural</h3>
          <ul>
            <li>validHeader: {String(result.validation.structural.validHeader)}</li>
            <li>parseable: {String(result.validation.structural.parseable)}</li>
            <li>encrypted: {String(result.validation.structural.encrypted)}</li>
            <li>blankPages: {JSON.stringify(result.validation.structural.blankPages)}</li>
            <li>
              mediaBoxes:{" "}
              {result.validation.structural.mediaBoxes.map((m) => `p${m.pageIndex}: ${m.widthPt.toFixed(1)}×${m.heightPt.toFixed(1)}pt`).join(", ")}
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

          <h3>HTML/PDF parity</h3>
          <ul>
            <li>
              htmlPageCount / pdfPageCount: {result.validation.parity.htmlPageCount} / {result.validation.parity.pdfPageCount}
            </li>
            <li>sameDensity: {String(result.validation.parity.sameDensity)}</li>
            <li>sameSectionOrder: {String(result.validation.parity.sameSectionOrder)}</li>
            <li>sourceCoveragePercent: {result.validation.parity.sourceCoveragePercent}%</li>
          </ul>

          <h3>Source page plan</h3>
          <ul>
            {result.sourcePagePlan.map((p) => (
              <li key={p.pageIndex}>
                page {p.pageIndex}: {p.sourceBlockIds.length} blocks
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
