import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  TASK 8 - dev-only inspection endpoint for the Professional ATS PDF
  Renderer (lib/documentPreservation/professionalAtsPdf/). Mirrors
  professional-ats-html-preview/route.ts's own convention exactly:
  no-fixture -> fixture list, fixture -> run the full pipeline. The
  one addition is `?download=1`, which returns the actual PDF bytes
  with a Content-Disposition header instead of the JSON validation
  report - the client uses this for the real "Download PDF" button;
  everything else (validation status, page count, hash, byte length)
  comes from the JSON response.

  `bytes` is dropped from the JSON response body (never base64-inlined
  into a JSON payload meant for on-screen validation display) - the
  download mode is the only path that ever transmits the actual PDF
  binary.
*/
export async function GET(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures", "resumes");
  const { searchParams } = new URL(req.url);
  const fixture = searchParams.get("fixture");
  const paperSize = searchParams.get("paperSize") === "a4" ? "a4" : "letter";
  const download = searchParams.get("download") === "1";

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
    const { reconstructWrappedLines } = await import("@/lib/documentPreservation/losslessSemantic/wrappedLineReconstruction");
    const { buildStructuredResume } = await import("@/lib/documentPreservation/resumeStructured/buildStructuredResume");
    const { buildProfessionalAtsAssembly } = await import("@/lib/documentPreservation/professionalAtsAssembly/buildProfessionalAtsAssembly");
    const { buildProfessionalAtsPdf } = await import("@/lib/documentPreservation/professionalAtsPdf/buildProfessionalAtsPdf");

    const buffer = fs.readFileSync(requestedPath);
    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
    /*
      Rejoin wrapped physical lines before structured extraction, exactly
      where the canonical import does it - this preview is only useful if
      the model it renders is the one production would have built.
    */
    const model = buildStructuredResume(reconstructWrappedLines(document));
    const assembly = buildProfessionalAtsAssembly(model);
    const result = await buildProfessionalAtsPdf(assembly, paperSize);

    if (download) {
      return new NextResponse(Buffer.from(result.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Length": String(result.byteLength),
        },
      });
    }

    const { bytes: _bytes, ...resultWithoutBytes } = result;
    return NextResponse.json({ result: resultWithoutBytes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while generating the PDF." },
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
