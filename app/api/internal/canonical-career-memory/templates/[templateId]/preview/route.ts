/*
  Phase 6F - dev-only Template Gallery preview endpoint. Renders the
  PII-free Jordan Ellis synthetic fixture (spec section 12: "실제
  Canonical 데이터를 API로 읽을 수 없는 환경에서는 PII-free synthetic
  canonical fixture로 dev preview를 제공") through the real Template
  Registry/Engine pipeline - never a mock/stub renderer. Same
  isNetlifyRuntime() gate + unauthenticated-fixture-only posture as
  the sibling templates/route.ts (see that file's own header comment).
  Not the same runtime source a real per-user preview would eventually
  use (CanonicalCareerMemoryService.getCanonicalRuntime(userId), see
  the Phase 6F pre-report's research on why no existing route calls it
  yet) - that wiring is explicitly out of scope for this round's dev
  Gallery.
*/
import { NextResponse } from "next/server";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";
import { ensureTemplatesRegistered } from "@/lib/resumeTemplates/registry/bootstrap";
import { validateTemplateId } from "@/lib/resumeTemplates/registry/templateRegistry";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import { TemplateContractError } from "@/lib/resumeTemplates/contracts/validation";
import { buildJordanEllisRuntime } from "../../../../../../../fixtures/resumes/template-preview/jordanEllisFixture";
import type { PaperSize, TemplateDensity, TemplateFormat } from "@/lib/resumeTemplates/contracts/types";

const VALID_FORMATS: TemplateFormat[] = ["html", "pdf", "docx"];
const VALID_PAPER_SIZES: PaperSize[] = ["letter", "a4"];
const VALID_DENSITIES: TemplateDensity[] = ["spacious", "comfortable", "balanced", "compact"];

export async function GET(request: Request, context: { params: Promise<{ templateId: string }> }) {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { templateId } = await context.params;
  const { searchParams } = new URL(request.url);
  const formatParam = searchParams.get("format") ?? "html";
  const paperSizeParam = searchParams.get("paperSize") ?? "letter";
  const densityParam = searchParams.get("density") ?? undefined;

  if (!VALID_FORMATS.includes(formatParam as TemplateFormat)) {
    return NextResponse.json({ error: `Invalid format '${formatParam}'. Expected one of: ${VALID_FORMATS.join(", ")}.` }, { status: 400 });
  }
  if (!VALID_PAPER_SIZES.includes(paperSizeParam as PaperSize)) {
    return NextResponse.json({ error: `Invalid paperSize '${paperSizeParam}'. Expected one of: ${VALID_PAPER_SIZES.join(", ")}.` }, { status: 400 });
  }
  if (densityParam && !VALID_DENSITIES.includes(densityParam as TemplateDensity)) {
    return NextResponse.json({ error: `Invalid density '${densityParam}'. Expected one of: ${VALID_DENSITIES.join(", ")}.` }, { status: 400 });
  }

  ensureTemplatesRegistered();

  try {
    const validId = validateTemplateId(templateId);
    const runtime = buildJordanEllisRuntime();
    const format = formatParam as TemplateFormat;
    const options = {
      templateId: validId,
      paperSize: paperSizeParam as PaperSize,
      density: densityParam as TemplateDensity | undefined,
      generatedAt: new Date().toISOString(),
    };

    if (format === "html") {
      const result = await renderTemplateFromRuntime(runtime, options, "html");
      return new NextResponse(result.html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (format === "pdf") {
      const result = await renderTemplateFromRuntime(runtime, options, "pdf");
      return new NextResponse(new Uint8Array(result.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${validId}-preview.pdf"` } });
    }
    const result = await renderTemplateFromRuntime(runtime, options, "docx");
    return new NextResponse(new Uint8Array(result.bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${validId}-preview.docx"` } });
  } catch (error) {
    if (error instanceof TemplateContractError) {
      const status = error.code === "unknown-template-id" ? 404 : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error while rendering template preview." }, { status: 500 });
  }
}
