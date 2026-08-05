"use client";

/*
  TASK 8 - Dev-only UI for the Professional ATS Cross-Format Parity
  Engine (Phase 5C). Fixture selector, Letter/A4, Generate All Formats,
  overall PASS/FAIL, per-format validation (missing/invented/duplicate/
  order/protected-fact/hidden-section/policy violations, source
  coverage), pairwise parity, sections/entries/facts/bullets summary,
  layout policy (paper size/density/page-count parity), warnings, page
  counts, Download PDF/Download DOCX.
*/
import { useEffect, useState } from "react";
import type { ProfessionalAtsParityResult } from "@/lib/documentPreservation/professionalAtsParity/buildProfessionalAtsParity";
import type { FormatName, FormatParityResult, PairwiseParityResult } from "@/lib/documentPreservation/professionalAtsParity/types";

type PaperSize = "letter" | "a4";

const FORMAT_LABELS: Record<FormatName, string> = { html: "HTML", pdf: "PDF", docx: "DOCX" };

function StatusPill({ passed }: { passed: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 4,
        background: passed ? "#e6f4ea" : "#fdecea",
        color: passed ? "#1e7e34" : "#b00020",
        fontWeight: 600,
      }}
    >
      {passed ? "PASSED" : "FAILED"}
    </span>
  );
}

function FormatResultCard({ format, r }: { format: FormatName; r: FormatParityResult }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{FORMAT_LABELS[format]}</strong>
        <StatusPill passed={r.passed} />
      </div>
      <ul style={{ marginTop: 0 }}>
        <li>missingFragments: {r.missingFragments.length}</li>
        <li>inventedFragments: {r.inventedFragments.length}</li>
        <li>duplicateEntries: {r.duplicateEntries.length}</li>
        <li>sectionOrderViolations: {r.sectionOrderViolations.length}</li>
        <li>entryOrderViolations: {r.entryOrderViolations.length}</li>
        <li>bulletOrderViolations: {r.bulletOrderViolations.length}</li>
        <li>protectedFactViolations: {r.protectedFactViolations.length}</li>
        <li>hiddenSectionViolations: {r.hiddenSectionViolations.length}</li>
        <li>policyViolations: {r.policyViolations.length}</li>
        <li>sourceCoveragePercent: {r.sourceCoveragePercent}%</li>
        <li>paperSizeMatches: {String(r.paperSizeMatches)}</li>
        <li>densityMatches: {String(r.densityMatches)}</li>
      </ul>
      {[
        ...r.missingFragments,
        ...r.inventedFragments,
        ...r.duplicateEntries,
        ...r.sectionOrderViolations,
        ...r.entryOrderViolations,
        ...r.bulletOrderViolations,
        ...r.protectedFactViolations,
        ...r.hiddenSectionViolations,
        ...r.policyViolations,
      ].length > 0 && (
        <details>
          <summary>Mismatch detail</summary>
          <ul>
            {[
              ...r.missingFragments,
              ...r.inventedFragments,
              ...r.duplicateEntries,
              ...r.sectionOrderViolations,
              ...r.entryOrderViolations,
              ...r.bulletOrderViolations,
              ...r.protectedFactViolations,
              ...r.hiddenSectionViolations,
              ...r.policyViolations,
            ].map((m, i) => (
              <li key={i}>
                <code>{m.reasonCode}</code> — {m.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PairwiseCard({ label, p }: { label: string; p: PairwiseParityResult }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <strong>{label}</strong>
      <ul>
        <li>sameVisibleSections: {String(p.sameVisibleSections)}</li>
        <li>sameSectionOrder: {String(p.sameSectionOrder)}</li>
        <li>sameEntryOrder: {String(p.sameEntryOrder)}</li>
        <li>mismatches: {p.mismatches.length}</li>
      </ul>
    </div>
  );
}

export default function ProfessionalAtsParityPreviewClient() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [fixture, setFixture] = useState<string>("");
  const [paperSize, setPaperSize] = useState<PaperSize>("letter");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProfessionalAtsParityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/professional-ats-parity")
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
      const res = await fetch(`/api/internal/professional-ats-parity?${params.toString()}`);
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

  function handleDownload(kind: "downloadPdf" | "downloadDocx") {
    if (!fixture) return;
    const params = new URLSearchParams({ fixture, paperSize, [kind]: "1" });
    window.location.href = `/api/internal/professional-ats-parity?${params.toString()}`;
  }

  const report = result?.report;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000 }}>
      <h1>Professional ATS Cross-Format Parity - Dev Inspection</h1>
      <p style={{ color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. Generates HTML, PDF, and
        DOCX from the same Phase 3 assembly and cross-verifies section/entry/protected-fact/bullet order, visibility,
        paper size, and density parity against a renderer-independent Canonical Parity Manifest.
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
          <option value="letter">Letter (8.5x11in)</option>
          <option value="a4">A4 (210x297mm)</option>
        </select>
        <button onClick={handleGenerate} disabled={loading} style={{ padding: "6px 14px" }}>
          {loading ? "Generating..." : "Generate All Formats"}
        </button>
        <button onClick={() => handleDownload("downloadPdf")} disabled={!fixture} style={{ padding: "6px 14px" }}>
          Download PDF
        </button>
        <button onClick={() => handleDownload("downloadDocx")} disabled={!fixture} style={{ padding: "6px 14px" }}>
          Download DOCX
        </button>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 16 }}>Error: {error}</div>}

      {result && report && (
        <div>
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Overall</h2>
            <StatusPill passed={report.passed} />
          </div>

          <ul>
            <li>
              htmlPageCount: {result.htmlPageCount} · pdfPageCount: {result.pdfPageCount}
            </li>
            <li>
              pdfByteLength: {result.pdfByteLength} · docxByteLength: {result.docxByteLength}
            </li>
            <li>
              pdfFileName: <code>{result.pdfFileName}</code> · docxFileName: <code>{result.docxFileName}</code>
            </li>
          </ul>

          <h2>Manifest summary</h2>
          <ul>
            <li>fragmentCount: {report.manifest.fragmentCount}</li>
            <li>sectionCount: {report.manifest.sectionCount}</li>
            <li>entryCount: {report.manifest.entryCount}</li>
            <li>sourceCoveragePercent: {report.manifest.sourceCoveragePercent}%</li>
          </ul>

          <h2>Per-format results</h2>
          <FormatResultCard format="html" r={report.formats.html} />
          <FormatResultCard format="pdf" r={report.formats.pdf} />
          <FormatResultCard format="docx" r={report.formats.docx} />

          <h2>Pairwise parity</h2>
          <PairwiseCard label="HTML vs PDF" p={report.pairwise.htmlVsPdf} />
          <PairwiseCard label="HTML vs DOCX" p={report.pairwise.htmlVsDocx} />
          <PairwiseCard label="PDF vs DOCX" p={report.pairwise.pdfVsDocx} />

          <h2>Sections</h2>
          <ul>
            <li>expected: {JSON.stringify(report.sections.expected)}</li>
            <li>html: {JSON.stringify(report.sections.html)}</li>
            <li>pdf: {JSON.stringify(report.sections.pdf)}</li>
            <li>docx: {JSON.stringify(report.sections.docx)}</li>
            <li>mismatches: {JSON.stringify(report.sections.mismatches)}</li>
          </ul>

          <h2>Entries</h2>
          <ul>
            <li>expectedIds: {report.entries.expectedIds.length}</li>
            <li>missingByFormat: {JSON.stringify(report.entries.missingByFormat)}</li>
            <li>duplicateByFormat: {JSON.stringify(report.entries.duplicateByFormat)}</li>
            <li>orderViolationsByFormat: {JSON.stringify(report.entries.orderViolationsByFormat)}</li>
          </ul>

          <h2>Protected facts</h2>
          <ul>
            <li>missing: {report.facts.missing.length}</li>
            <li>changed: {report.facts.changed.length}</li>
            <li>invented: {report.facts.invented.length}</li>
          </ul>

          <h2>Bullets</h2>
          <ul>
            <li>missing: {report.bullets.missing.length}</li>
            <li>duplicated: {report.bullets.duplicated.length}</li>
            <li>reordered: {report.bullets.reordered.length}</li>
          </ul>

          <h2>Layout policy</h2>
          <ul>
            <li>samePaperSize: {String(report.layoutPolicy.samePaperSize)}</li>
            <li>sameDensity: {String(report.layoutPolicy.sameDensity)}</li>
            <li>htmlPdfPageParity: {String(report.layoutPolicy.htmlPdfPageParity)}</li>
            <li>docxPageParityRequired: {String(report.layoutPolicy.docxPageParityRequired)}</li>
          </ul>

          {report.warnings.length > 0 && (
            <>
              <h2>Warnings</h2>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
