/*
  TASK 8 - Server Component wrapper. Same production-isolation pattern
  as app/dev/professional-ats-pdf/page.tsx and
  app/dev/professional-ats-docx/page.tsx: 404s in the real Netlify
  runtime via isNetlifyRuntime() + notFound() at request time.
*/
import { notFound } from "next/navigation";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";
import ProfessionalAtsParityPreviewClient from "./PreviewClient";

export default function ProfessionalAtsParityPreviewPage() {
  if (isNetlifyRuntime()) {
    notFound();
  }

  return <ProfessionalAtsParityPreviewClient />;
}
