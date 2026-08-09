import type { Metadata } from "next";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "Pricing | Career Élan",
  description:
    "Start with Career Élan for free. Generate up to 3 tailored application packages every month.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a
  "use client" file cannot export it). PricingPageClient.tsx has the
  actual page body, wrapped in PublicAuthActionsProvider so Log in/Get
  Started open the real Homepage auth modal directly (Phase 6I.6.28).
*/
export default function PricingPage() {
  return <PricingPageClient />;
}
