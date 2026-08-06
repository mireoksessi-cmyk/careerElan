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
import { ensureTemplatesRegistered } from "@/lib/resumeTemplates/registry/bootstrap";
import { listTemplates } from "@/lib/resumeTemplates/registry/templateRegistry";
import { buildCapabilityMatrix } from "@/lib/resumeTemplates/engine/templateCapabilities";

export async function GET() {
  if (isNetlifyRuntime()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  ensureTemplatesRegistered();
  return NextResponse.json({ templates: listTemplates(), capabilityMatrix: buildCapabilityMatrix() });
}
