import type { Metadata } from "next";
import HowItWorksPageClient from "./HowItWorksPageClient";

export const metadata: Metadata = {
  title: "How It Works | Career Élan",
  description:
    "See the end-to-end workflow: build your career profile once, choose your resume and template on your Dashboard, then let Career Élan help you go from job posting to a tailored, organized application.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a
  "use client" file cannot export it). HowItWorksPageClient.tsx has the
  actual page body, wrapped in PublicAuthActionsProvider so Log in/Get
  Started open the real Homepage auth modal directly (Phase 6I.6.28).
*/
export default function HowItWorksPage() {
  return <HowItWorksPageClient />;
}
