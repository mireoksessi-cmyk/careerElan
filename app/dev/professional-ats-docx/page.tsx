/*
  TASK 8 - Server Component wrapper. Same production-isolation pattern
  as app/dev/professional-ats-pdf/page.tsx: 404s in the real Netlify
  runtime via isNetlifyRuntime() + notFound() at request time.
*/
import { notFound } from "next/navigation";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";
import ProfessionalAtsDocxPreviewClient from "./PreviewClient";

export default function ProfessionalAtsDocxPreviewPage() {
  if (isNetlifyRuntime()) {
    notFound();
  }

  return <ProfessionalAtsDocxPreviewClient />;
}
