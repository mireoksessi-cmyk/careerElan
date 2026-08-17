/*
  Phase 6F - Template catalog listing endpoint, now confirmed to be a
  real Production dependency: both app/career-memory/page.tsx's
  runInlineCanonicalFlow() (loadInlineTemplateList()) and
  runManualCanonicalFlow() fetch this route as their ONLY source for
  the Step 9 "Choose a template" card list, for the uploaded-resume and
  Built From Scratch flows respectively. The previous isNetlifyRuntime()
  404 gate (originally mirrored from resume-structured-preview/route.ts,
  a genuinely dev-only route) was factually wrong for how this endpoint
  is actually used - it made Production Career Memory always receive
  templates: [] (confirmed via Production read-only audit: empty
  template cards, default_template_id never set). Removed. Response
  content is unchanged and remains unauthenticated by original design:
  only static template capability metadata (id/label/enabled flags),
  never a real user's data - see listTemplates()/buildCapabilityMatrix().
*/
import { NextResponse } from "next/server";

export async function GET() {
  const { ensureTemplatesRegistered } = await import("@/lib/resumeTemplates/registry/bootstrap");
  const { listTemplates } = await import("@/lib/resumeTemplates/registry/templateRegistry");
  const { buildCapabilityMatrix } = await import("@/lib/resumeTemplates/engine/templateCapabilities");

  ensureTemplatesRegistered();
  return NextResponse.json({ templates: listTemplates(), capabilityMatrix: buildCapabilityMatrix() });
}
