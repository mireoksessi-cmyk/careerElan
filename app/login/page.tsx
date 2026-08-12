import type { Metadata } from "next";
import AuthEntryPageClient from "@/components/marketing/AuthEntryPageClient";

export const metadata: Metadata = {
  title: "Log in | Career Élan",
  description: "Log in to Career Élan to continue building tailored application packages.",
};

/*
  Server Component wrapper so `metadata` can stay exported here (a "use
  client" file cannot export it). AuthEntryPageClient auto-opens the real
  homepage auth modal (Phase 2A Quick Win - see that file's header comment).
*/
export default function LoginPage() {
  return <AuthEntryPageClient mode="login" />;
}
