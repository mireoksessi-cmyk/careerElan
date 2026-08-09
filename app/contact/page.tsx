import type { Metadata } from "next";
import ContactPageClient from "./ContactPageClient";

export const metadata: Metadata = {
  title: "Contact | Career Élan",
  description:
    "Have a question about Career Élan? Contact us at careerelanhq@gmail.com.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a
  "use client" file cannot export it). ContactPageClient.tsx has the
  actual page body, wrapped in PublicAuthActionsProvider so Log in/Get
  Started open the real Homepage auth modal directly (Phase 6I.6.29).
*/
export default function ContactPage() {
  return <ContactPageClient />;
}
