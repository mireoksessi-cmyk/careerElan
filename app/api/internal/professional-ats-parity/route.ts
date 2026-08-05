import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  TASK 8 - dev-only inspection endpoint for the Professional ATS
  Cross-Format Parity Engine (Phase 5C). Mirrors the established
  professional-ats-pdf-preview/professional-ats-docx-preview
  convention exactly: no-fixture -> fixture list, fixture -> run the
  full pipeline (Phase 1-3 parse, then Phase 4/5A/5B/5C generate +
  compare), `?downloadPdf=1`/`?downloadDocx=1` -> real binary with a
  Content-Disposition header instead of the JSON report.

  Downloads regenerate the requested format directly (rather than
  threading pdf/docx bytes through buildProfessionalAtsParity's own
  return type, which intentionally omits bytes - same "never inline
  binary into a JSON validation payload" rule Phase 5B's own preview
  route already follows) using the SAME density Phase 5C's own
  orchestrator would converge on (HTML's auto-fit density), so a
  downloaded file matches exactly what the parity report just
  validated.
*/
export async function GET(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures", "resumes");
  const { searchParams } = new URL(req.url);
  const fixture = searchParams.get("fixture");
  const paperSize = searchParams.get("paperSize") === "a4" ? "a4" : "letter";
  const downloadPdf = searchParams.get("downloadPdf") === "1";
  const downloadDocx = searchParams.get("downloadDocx") === "1";

  if (!fixture) {
    const list = listFixtureFiles(FIXTURES_DIR);
    return NextResponse.json({ fixtures: list });
  }

  const requestedPath = path.resolve(FIXTURES_DIR, fixture);
  if (!requestedPath.startsWith(FIXTURES_DIR + path.sep)) {
    return NextResponse.json({ error: "Invalid fixture path." }, { status: 400 });
  }
  if (!fs.existsSync(requestedPath)) {
    return NextResponse.json({ error: "Fixture not found." }, { status: 404 });
  }

  const ext = path.extname(requestedPath).toLowerCase();
  const sourceFormat = ext === ".docx" ? "docx" : ext === ".pdf" ? "pdf" : null;
  if (!sourceFormat) {
    return NextResponse.json({ error: "Unsupported fixture type - only .pdf/.docx." }, { status: 400 });
  }

  try {
    const { analyzeDocument } = await import("@/lib/documentPreservation/layoutAnalysis");
    const { buildLosslessResumeDocument } = await import("@/lib/documentPreservation/losslessSemantic/buildLosslessDocument");
    const { buildStructuredResume } = await import("@/lib/documentPreservation/resumeStructured/buildStructuredResume");
    const { buildProfessionalAtsAssembly } = await import("@/lib/documentPreservation/professionalAtsAssembly/buildProfessionalAtsAssembly");

    const buffer = fs.readFileSync(requestedPath);
    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
    const model = buildStructuredResume(document);
    const assembly = buildProfessionalAtsAssembly(model);

    if (downloadPdf || downloadDocx) {
      const { buildHtmlSnapshot } = await import("@/lib/documentPreservation/professionalAtsParity/htmlFormatAdapter");
      const { htmlPreview } = await buildHtmlSnapshot(assembly, paperSize);

      if (downloadPdf) {
        const { buildPdfSnapshot } = await import("@/lib/documentPreservation/professionalAtsParity/pdfFormatAdapter");
        const { pdfResult } = await buildPdfSnapshot(assembly, paperSize);
        return new NextResponse(Buffer.from(pdfResult.bytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfResult.fileName}"`,
            "Content-Length": String(pdfResult.byteLength),
          },
        });
      }

      const { buildDocxSnapshot } = await import("@/lib/documentPreservation/professionalAtsParity/docxFormatAdapter");
      const { docxResult } = await buildDocxSnapshot(assembly, paperSize, htmlPreview.plan.density);
      return new NextResponse(Buffer.from(docxResult.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${docxResult.fileName}"`,
          "Content-Length": String(docxResult.byteLength),
        },
      });
    }

    const { buildProfessionalAtsParity } = await import("@/lib/documentPreservation/professionalAtsParity/buildProfessionalAtsParity");
    const result = await buildProfessionalAtsParity(assembly, paperSize);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while generating the parity report." },
      { status: 500 }
    );
  }
}

function listFixtureFiles(dir: string, prefix = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFixtureFiles(path.join(dir, entry.name), relative));
    } else if (/\.(pdf|docx)$/i.test(entry.name)) {
      files.push(relative);
    }
  }
  return files.sort();
}
