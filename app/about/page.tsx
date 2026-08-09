import type { Metadata } from "next";
import AboutPageClient from "./AboutPageClient";

export const metadata: Metadata = {
  title: "About Us | Career Élan",
  description:
    "Career Élan is building a smarter way to navigate the job search - helping people understand opportunities, present their experience clearly, and approach every application with greater confidence.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a
  "use client" file cannot export it). AboutPageClient.tsx has the
  actual page body, wrapped in PublicAuthActionsProvider so Log in/Get
  Started open the real Homepage auth modal directly (Phase 6I.6.28).
*/
export default function AboutPage() {
  return <AboutPageClient />;
}
