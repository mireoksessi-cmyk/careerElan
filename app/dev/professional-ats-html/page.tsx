/*
  TASK 4 - Server Component wrapper. Unlike Phase 2/3's dev pages
  (app/dev/resume-structured, app/dev/professional-ats-assembly), which
  rely purely on obscurity (no nav link, no auth), this spec explicitly
  requires the dev page itself to 404 in the real Netlify runtime - so
  this route calls isNetlifyRuntime() + notFound() at request time,
  same production-isolation signal already used by
  app/api/internal/*-preview routes. The interactive UI lives in a
  client subcomponent since notFound()/runtime checks must happen in a
  Server Component.
*/
import { notFound } from "next/navigation";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";
import ProfessionalAtsHtmlPreviewClient from "./PreviewClient";

export default function ProfessionalAtsHtmlPreviewPage() {
  if (isNetlifyRuntime()) {
    notFound();
  }

  return <ProfessionalAtsHtmlPreviewClient />;
}
