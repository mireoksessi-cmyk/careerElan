"use client";

import { useEffect } from "react";
import { captureAttribution, initAnalytics } from "@/lib/analytics/posthog";

/*
  Renders nothing. Mounted once from the root layout purely so PostHog is
  initialised and the visitor's original acquisition context (utm_*, landing
  path, referrer) is recorded on their very first page - before any funnel
  event fires. No UI, no wrappers, no DOM output, so layout and styling are
  completely unaffected.
*/
export default function AnalyticsProvider() {
  useEffect(() => {
    initAnalytics();
    captureAttribution();
  }, []);

  return null;
}
