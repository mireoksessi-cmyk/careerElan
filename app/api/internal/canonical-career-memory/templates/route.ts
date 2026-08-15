/*
  Phase 6F - dev-only Template Gallery listing endpoint. Mirrors the
  EXISTING app/api/internal/resume-structured-preview/route.ts
  convention exactly: same isNetlifyRuntime() gate, same unauthenticated-
  but-local-only posture (this endpoint only ever reads registry
  metadata + a static synthetic fixture, never a real user's data, so
  it does not need withCanonicalAuth()'s session requirement - see that
  route's own header comment for why an unauthenticated fixture-only
  preview route is an established, safe pattern in this codebase).
  Never wired into the production Template Selector (lib/brand/render/
  templateId.ts) - spec section 12/22.
*/
import { NextResponse } from "next/server";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";

export async function GET() {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { ensureTemplatesRegistered } = await import("@/lib/resumeTemplates/registry/bootstrap");
  const { listTemplates } = await import("@/lib/resumeTemplates/registry/templateRegistry");
  const { buildCapabilityMatrix } = await import("@/lib/resumeTemplates/engine/templateCapabilities");

  ensureTemplatesRegistered();
  return NextResponse.json({ templates: listTemplates(), capabilityMatrix: buildCapabilityMatrix() });
}
