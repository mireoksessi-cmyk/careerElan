import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  TASK 8 - dev-only inspection endpoint for the Professional ATS DOCX
  Renderer (lib/documentPreservation/professionalAtsDocx/). Mirrors
  professional-ats-pdf-preview/route.ts's own convention exactly:
  no-fixture -> fixture list, fixture -> run the full pipeline,
  `?download=1` -> real DOCX bytes with a Content-Disposition header
  instead of the JSON validation report. Unlike Phase 5A's PDF
  endpoint, this one also accepts an explicit `density` param - Phase
  5B does not chain through Phase 4's auto-fit density selection (spec
  section 4: consumes ProfessionalAtsAssemblyDocument directly), so the
  caller picks density directly here, same as buildProfessionalAtsDocx
  itself requires.

  `bytes` is dropped from the JSON response body (never base64-inlined
  into a JSON payload meant for on-screen validation display) - the
  download mode is the only path that ever transmits the actual DOCX
  binary.

  TASK 12 - `?render=html` additionally converts the generated DOCX
  back through mammoth.convertToHtml() (same call docxTextExtraction.ts
  already uses for text-preservation validation, just keeping its HTML
  instead of stripping tags) and returns it directly as a viewable
  text/html page. This is a manual/visual review aid only - mammoth's
  HTML rendering is an approximation (no exact font/pagination/spacing
  fidelity to real Word), not a substitute for the structural/text/
  parity validation the JSON mode already performs.
*/
export async function GET(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures", "resumes");
  const { searchParams } = new URL(req.url);
  const fixture = searchParams.get("fixture");
  const paperSize = searchParams.get("paperSize") === "a4" ? "a4" : "letter";
  const VALID_DENSITIES = ["comfortable", "balanced", "compact", "ultra-compact"] as const;
  type Density = (typeof VALID_DENSITIES)[number];
  const densityParam = searchParams.get("density");
  const density: Density = (VALID_DENSITIES as readonly string[]).includes(densityParam ?? "") ? (densityParam as Density) : "comfortable";
  const download = searchParams.get("download") === "1";
  const renderHtml = searchParams.get("render") === "html";

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
    const { buildProfessionalAtsDocx } = await import("@/lib/documentPreservation/professionalAtsDocx/buildProfessionalAtsDocx");

    const buffer = fs.readFileSync(requestedPath);
    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
    const model = buildStructuredResume(document);
    const assembly = buildProfessionalAtsAssembly(model);
    const result = await buildProfessionalAtsDocx(assembly, paperSize, density);

    if (download) {
      return new NextResponse(Buffer.from(result.bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Length": String(result.byteLength),
        },
      });
    }

    if (renderHtml) {
      const mammoth = (await import("mammoth")).default;
      const converted = await mammoth.convertToHtml({ buffer: Buffer.from(result.bytes) });
      const page = `<!doctype html><html><head><meta charset="utf-8"><title>${result.fileName} - mammoth render</title>
<style>
  body { font-family: Arial, "Malgun Gothic", sans-serif; max-width: 8.5in; margin: 24px auto; padding: 0.5in; border: 1px solid #ccc; }
  p { margin: 0 0 6px; }
  ul { margin: 0 0 6px; padding-left: 24px; }
  strong { font-weight: 700; }
</style></head><body>${converted.value}</body></html>`;
      return new NextResponse(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const { bytes: _bytes, ...resultWithoutBytes } = result;
    return NextResponse.json({ result: resultWithoutBytes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while generating the DOCX." },
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
