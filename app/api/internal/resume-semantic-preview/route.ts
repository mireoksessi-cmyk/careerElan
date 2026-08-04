import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

/*
  TASK 7 - dev-only inspection endpoint for the Lossless Resume Semantic
  Engine (lib/documentPreservation/losslessSemantic/). Reads a fixture
  file straight off local disk and returns the assembled
  LosslessResumeDocument as JSON - nothing here touches Supabase, the
  existing AI generation flow, or any production route. Unauthenticated
  on purpose (matches app/dev/dpe-measure's own established convention -
  see that route's docstring) but gated out of the Netlify runtime
  entirely below, since fixture files live in the repo's fixtures/
  directory and are never part of the deployed Netlify function bundle
  anyway - this route can only ever do useful work under `next dev`/
  `next start` against a local checkout.
*/
export async function GET(req: Request) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures", "resumes");
  const { searchParams } = new URL(req.url);
  const fixture = searchParams.get("fixture");

  if (!fixture) {
    // No fixture requested - list what's available instead of running the engine.
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
    // Lazy-imported so this module's heavy pdfjs-dist/mammoth/Playwright
    // dependency chain is only ever pulled in for an actual dev-tool
    // request, matching this codebase's own established convention (see
    // lib/documentAnalysis worker files' equivalent lazy imports).
    const { analyzeDocument } = await import("@/lib/documentPreservation/layoutAnalysis");
    const { buildLosslessResumeDocument } = await import("@/lib/documentPreservation/losslessSemantic/buildLosslessDocument");

    const buffer = fs.readFileSync(requestedPath);
    const layoutResult = await analyzeDocument("resume", sourceFormat, buffer);
    const document = buildLosslessResumeDocument(layoutResult, { fileName: fixture, fileType: sourceFormat });

    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while running the semantic engine." },
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
