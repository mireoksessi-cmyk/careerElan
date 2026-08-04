import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  TASK 4/11 - dev-only inspection endpoint for the Professional ATS
  HTML Preview (lib/documentPreservation/professionalAtsHtml/). Mirrors
  app/api/internal/professional-ats-assembly-preview/route.ts's own
  convention - runs Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 on a
  fixture and returns both the ProfessionalAtsAssemblyDocument (for the
  flat/unpaginated view, TASK 4) and the full
  ProfessionalAtsHtmlPreviewDocument (plan/measurement/validation, for
  the real paginated view added in TASK 11's manual browser review) -
  the client renders both from this single response, this route never
  renders HTML itself.
*/
export async function GET(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures", "resumes");
  const { searchParams } = new URL(req.url);
  const fixture = searchParams.get("fixture");
  const paperSize = searchParams.get("paperSize") === "a4" ? "a4" : "letter";

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
    const { buildProfessionalAtsHtmlPreview } = await import("@/lib/documentPreservation/professionalAtsHtml/buildProfessionalAtsHtmlPreview");

    const buffer = fs.readFileSync(requestedPath);
    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });
    const model = buildStructuredResume(document);
    const assembly = buildProfessionalAtsAssembly(model);
    const preview = await buildProfessionalAtsHtmlPreview(assembly, paperSize);

    return NextResponse.json({ assembly, preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while building the assembly." },
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
