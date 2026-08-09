import type { Metadata } from "next";
import FeaturesPageClient from "./FeaturesPageClient";

export const metadata: Metadata = {
  title: "Features | Career Élan",
  description:
    "Everything you need to apply with confidence — AI job analysis, tailored application packages, Career Memory, resume templates, and more.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a
  "use client" file cannot export it). FeaturesPageClient.tsx has the
  actual page body, wrapped in PublicAuthActionsProvider so Log in/Get
  Started open the real Homepage auth modal directly (Phase 6I.6.28).
*/
export default function FeaturesPage() {
  return <FeaturesPageClient />;
}
