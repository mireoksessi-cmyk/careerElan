import type { Metadata } from "next";
import AuthEntryPageClient from "@/components/marketing/AuthEntryPageClient";

export const metadata: Metadata = {
  title: "Sign up | Career Élan",
  description: "Create a Career Élan account to build one profile and apply everywhere.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a "use
  client" file cannot export it). AuthEntryPageClient auto-opens the real
  homepage auth modal (Phase 2A Quick Win - see that file's header comment).
*/
export default function SignUpPage() {
  return <AuthEntryPageClient mode="signup" />;
}
