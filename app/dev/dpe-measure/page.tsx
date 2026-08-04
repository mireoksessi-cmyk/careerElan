"use client";

/*
  Document Preservation Engine (DPE) - Phase 4B completion. Internal,
  unauthenticated, dev-only measurement harness - NOT linked from any
  nav, NOT part of the production app flow, makes no Supabase/network
  calls. Exists solely so a headless browser (Playwright, driven from
  lib/documentPreservation/executionEngine/browserMeasurement.ts) can
  navigate here and read REAL DOM geometry from the EXISTING, UNMODIFIED
  A4DocumentPreview component - the same production Renderer every real
  page (app/paste-job/page.tsx, app/job-tracker/page.tsx) already uses,
  fed with arbitrary (not-yet-persisted) candidate text so DPE can
  measure a Replacement Plan's output before it is ever saved anywhere.

  Mirrors the existing, already-established app/dev/brand-poc/page.tsx
  convention (unauthenticated dev harness, safe to delete, touches no
  production route/component/data) - not a new pattern.

  Text/templateId arrive via query string rather than POST body, since
  this is a GET-navigable page a headless browser can load directly; see
  browserMeasurement.ts for the practical size ceiling this implies.

  No client-side "ready" flag here on purpose - an earlier version used a
  requestAnimationFrame-based window flag, but rAF callbacks are
  unreliable (throttled or never fire) in a backgrounded/automated tab,
  confirmed by direct testing in this session. browserMeasurement.ts
  instead polls a concrete DOM condition itself (Playwright's own
  waitForFunction) - the actual thing it needs (the hidden measureRef
  div existing with a settled, non-zero scrollHeight), not a proxy flag.
*/

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import A4DocumentPreview from "@/lib/brand/render/A4DocumentPreview";

/*
  useSearchParams() requires a Suspense boundary for `next build`'s static
  prerendering (real build error confirmed via `npm run build` in this
  phase: "useSearchParams() should be wrapped in a suspense boundary" -
  dev mode never surfaces this since dev never prerenders). This page is
  never statically prerendered in practice (Playwright always navigates
  to it with real query params at request time), but the production
  build still requires the boundary to exist for the route to compile.
*/
function DpeMeasureContent() {
  const searchParams = useSearchParams();
  const text = searchParams.get("text") ?? "";
  const templateId = searchParams.get("templateId") ?? "classic";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div style={{ background: "#f6fbff", minHeight: "100vh", padding: 0 }}>
      <A4DocumentPreview text={text} templateId={templateId} />
    </div>
  );
}

export default function DpeMeasurePage() {
  return (
    <Suspense fallback={null}>
      <DpeMeasureContent />
    </Suspense>
  );
}
