"use client";

/*
  TASK 4/11 - Dev-only Preview UI client component for the Professional
  ATS HTML Preview. Mirrors app/dev/professional-ats-assembly/page.tsx's
  own established convention: unauthenticated, nav-unlinked, no
  Supabase/network calls beyond its own internal fixture-preview route,
  safe to delete.

  Two view modes:
  - Flat: Phase 4's static renderer in one continuous block with
    dashed nominal-page-height markers (TASK 4's original view, still
    useful for eyeballing raw content length before pagination).
  - Paginated: the REAL PaginationPlan (auto-fit density chosen server-
    side via real Playwright measurement) rendered as actual separate
    page containers via ProfessionalAtsPaginatedPages - this is what
    TASK 11's manual browser review actually inspects. Density here is
    NOT user-selectable in this mode; it's real output, showing
    whichever density autoFitDensity() picked for this fixture/paper
    size, exactly as production would.
*/

import { useEffect, useState } from "react";
import { ProfessionalAtsFlatContent } from "@/lib/documentPreservation/professionalAtsHtml/renderers";
import { ProfessionalAtsPaginatedPages } from "@/lib/documentPreservation/professionalAtsHtml/paginatedRenderer";
import { PAPER_DIMENSIONS, DENSITY_SPACING, DENSITY_ESCALATION_ORDER, PROFESSIONAL_ATS_FONT_STACK } from "@/lib/documentPreservation/professionalAtsHtml/designTokens";
import type { PaperSize, ProfessionalAtsHtmlPreviewDocument } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { AssemblyDensity, ProfessionalAtsAssemblyDocument } from "@/lib/documentPreservation/professionalAtsAssembly/types";

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

export default function ProfessionalAtsHtmlPreviewClient() {
  const [fixtures, setFixtures] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [paperSize, setPaperSize] = useState<PaperSize>("letter");
  const [density, setDensity] = useState<AssemblyDensity>("comfortable");
  const [viewMode, setViewMode] = useState<"flat" | "paginated">("paginated");
  const [assembly, setAssembly] = useState<ProfessionalAtsAssemblyDocument | null>(null);
  const [preview, setPreview] = useState<ProfessionalAtsHtmlPreviewDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/professional-ats-html-preview")
      .then((res) => res.json())
      .then((data) => {
        const list: string[] = data.fixtures ?? [];
        setFixtures(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch((err) => setError(String(err)));
  }, []);

  async function runFixture(fixture: string, paper: PaperSize) {
    setLoading(true);
    setError(null);
    setAssembly(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/internal/professional-ats-html-preview?fixture=${encodeURIComponent(fixture)}&paperSize=${paper}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAssembly(data.assembly);
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const paper = PAPER_DIMENSIONS[paperSize];
  const flatTokens = DENSITY_SPACING[density];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Professional ATS HTML Preview - Dev Inspection</h1>
      <p style={{ fontSize: 13, color: "#666" }}>
        Internal QA tool. Not linked from any navigation, not part of the production flow. Renders the real Phase 4
        HTML renderer through the real measurement -&gt; pagination -&gt; density-auto-fit -&gt; validation pipeline.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: 6, minWidth: 320 }}>
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={() => selected && runFixture(selected, paperSize)} disabled={!selected || loading} style={{ padding: "6px 14px" }}>
          {loading ? "Running…" : "Run"}
        </button>

        <label style={{ fontSize: 13 }}>
          Paper:{" "}
          <select value={paperSize} onChange={(e) => setPaperSize(e.target.value as PaperSize)} style={{ padding: 4 }}>
            <option value="letter">Letter (8.5×11in)</option>
            <option value="a4">A4 (210×297mm)</option>
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          View:{" "}
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value as "flat" | "paginated")} style={{ padding: 4 }}>
            <option value="paginated">Paginated (real plan)</option>
            <option value="flat">Flat (unpaginated)</option>
          </select>
        </label>

        {viewMode === "flat" && (
          <label style={{ fontSize: 13 }}>
            Density (flat view only):{" "}
            <select value={density} onChange={(e) => setDensity(e.target.value as AssemblyDensity)} style={{ padding: 4 }}>
              {DENSITY_ESCALATION_ORDER.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <div style={{ color: "#c0362c", marginBottom: 16 }}>{error}</div>}

      {assembly && preview && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, border: "1px solid #ddd", borderRadius: 8, padding: 10, fontSize: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ color: "#666" }}>
              templateId: {assembly.templateId} · visible: {assembly.visibleSectionKeys.join(", ") || "(none)"} <br />
              chosen density: <strong>{preview.plan.density}</strong> · pageCount: <strong>{preview.plan.pageCount}</strong> · densityFallbackHistory:{" "}
              {preview.densityFallbackHistory.join(" → ")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge ok={preview.measurement.measurable} label={preview.measurement.measurable ? "MEASURABLE" : "NOT MEASURABLE"} />
              <Badge ok={!preview.measurement.overflowDetected} label={preview.measurement.overflowDetected ? "OVERFLOW DETECTED" : "NO OVERFLOW"} />
              <Badge ok={preview.validation.passed} label={preview.validation.passed ? "VALIDATION PASSED" : "VALIDATION FAILED"} />
            </div>
          </div>

          {!preview.validation.passed && (
            <pre style={{ fontSize: 11, background: "#fff5f5", border: "1px solid #f5c2c2", borderRadius: 6, padding: 10, overflowX: "auto", marginBottom: 12 }}>
              {JSON.stringify(preview.validation, null, 2)}
            </pre>
          )}

          {viewMode === "flat" ? (
            <div style={{ overflowX: "auto", paddingBottom: 24 }}>
              <div
                data-preview-page-container="true"
                style={{
                  position: "relative",
                  width: paper.width,
                  minHeight: paper.height,
                  margin: "0 auto",
                  background: "#fff",
                  boxShadow: "0 0 0 1px #ccc, 0 4px 16px rgba(0,0,0,0.08)",
                  padding: `${flatTokens.pagePaddingPx}px`,
                  fontFamily: PROFESSIONAL_ATS_FONT_STACK,
                  fontSize: `${flatTokens.fontSizePt}pt`,
                  lineHeight: flatTokens.lineHeight,
                  color: "#111",
                  boxSizing: "border-box",
                }}
              >
                <PageHeightMarkers paperHeight={paper.height} />
                <div style={{ display: "flex", flexDirection: "column", gap: `${flatTokens.sectionGapPx}px`, position: "relative" }}>
                  <ProfessionalAtsFlatContent assembly={assembly} spacing={flatTokens} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <PaginatedPagesView assembly={assembly} plan={preview.plan} paperSize={paperSize} density={preview.plan.density} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/*
  Renders each real page as its own bordered container at true paper
  dimensions, reusing ProfessionalAtsPaginatedPages's own per-page
  grouping so what's inspected here is exactly the same structure
  htmlValidator.ts validates (paginatedRenderer.ts's buildPageItems).
*/
function PaginatedPagesView({
  assembly,
  plan,
  paperSize,
  density,
}: {
  assembly: ProfessionalAtsAssemblyDocument;
  plan: ProfessionalAtsHtmlPreviewDocument["plan"];
  paperSize: PaperSize;
  density: AssemblyDensity;
}) {
  const paper = PAPER_DIMENSIONS[paperSize];
  const tokens = DENSITY_SPACING[density];
  return (
    <div
      style={{
        width: paper.width,
        fontFamily: PROFESSIONAL_ATS_FONT_STACK,
        fontSize: `${tokens.fontSizePt}pt`,
        lineHeight: tokens.lineHeight,
        color: "#111",
      }}
    >
      <style>{`
        [data-page-index] {
          background: #fff;
          box-shadow: 0 0 0 1px #ccc, 0 4px 16px rgba(0,0,0,0.08);
          box-sizing: border-box;
          padding: ${tokens.pagePaddingPx}px;
          min-height: ${paper.height};
          margin-bottom: 20px;
          position: relative;
        }
        [data-page-index]::before {
          content: "page " attr(data-page-index);
          position: absolute;
          top: -18px;
          left: 0;
          font-size: 10px;
          color: #888;
        }
      `}</style>
      <ProfessionalAtsPaginatedPages assembly={assembly} plan={plan} spacing={tokens} />
    </div>
  );
}

/*
  Draws a dashed line at every multiple of one nominal page height, for
  as many multiples as fit in a generously tall container (the flat,
  unpaginated content can run arbitrarily long). Purely visual - not
  used by any measurement/validation logic.
*/
function PageHeightMarkers({ paperHeight }: { paperHeight: string }) {
  const markerCount = 6;
  return (
    <>
      {Array.from({ length: markerCount }, (_, i) => i + 1).map((multiple) => (
        <div
          key={multiple}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `calc(${paperHeight} * ${multiple})`,
            borderTop: "1px dashed #d9534f",
            pointerEvents: "none",
          }}
        >
          <span style={{ position: "absolute", right: 4, top: -14, fontSize: 10, color: "#d9534f" }}>
            page {multiple} boundary
          </span>
        </div>
      ))}
    </>
  );
}
