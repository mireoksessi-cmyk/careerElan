/*
  TASK 8 - Server Component wrapper. Same production-isolation pattern
  as app/dev/professional-ats-html/page.tsx: 404s in the real Netlify
  runtime via isNetlifyRuntime() + notFound() at request time.
*/
import { notFound } from "next/navigation";
import { isNetlifyRuntime } from "@/lib/generatePackage/backgroundTarget";
import ProfessionalAtsPdfPreviewClient from "./PreviewClient";

export default function ProfessionalAtsPdfPreviewPage() {
  if (isNetlifyRuntime()) {
    notFound();
  }

  return <ProfessionalAtsPdfPreviewClient />;
}
