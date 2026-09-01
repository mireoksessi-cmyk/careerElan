/*
  Minimal PostHog product-funnel analytics.

  Scope is deliberately tiny: six funnel events plus non-personal acquisition
  metadata. Nothing in this module ever reads resume text, cover letter text,
  job description text, Career Memory content, emails, names, phone numbers,
  addresses, tokens or any other user content - only event names, UTM values
  the visitor themselves arrived with, the landing path, the referrer and a
  coarse device bucket.

  Everything here is a no-op when NEXT_PUBLIC_POSTHOG_KEY is unset, so the
  product behaves identically in any environment that has not configured
  PostHog (local dev, previews, CI).
*/
import posthog from "posthog-js";

const ATTRIBUTION_STORAGE_KEY = "ce_acquisition_attribution";

export type FunnelEvent =
  | "landing_viewed"
  | "get_started_clicked"
  | "signup_viewed"
  | "signup_started"
  | "signup_completed"
  | "first_job_added";

type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_path?: string;
  referrer?: string;
};

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function analyticsKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

/*
  Coarse bucket only - derived from viewport width and the touch-capable UA
  hint, never a fingerprint. Three values: mobile / tablet / desktop.
*/
function deviceType(): "mobile" | "tablet" | "desktop" {
  if (!isBrowser()) return "desktop";
  const width = window.innerWidth || 0;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/*
  The visitor's ORIGINAL acquisition context, captured the first time they
  land and then held for the rest of the funnel so that
  landing -> signup -> first job all attribute back to the same campaign.
  First write wins: a later internal navigation without utm params must not
  overwrite the campaign the visitor actually arrived from.
*/
export function captureAttribution(): void {
  if (!isBrowser()) return;
  try {
    if (window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)) return;

    const params = new URLSearchParams(window.location.search);
    const attribution: Attribution = {
      landing_path: window.location.pathname,
      referrer: document.referrer || undefined,
    };
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) attribution[key] = value.slice(0, 200);
    }
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    /* storage unavailable (private mode / disabled) - analytics stays silent */
  }
}

export function getAttribution(): Attribution {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

let initialised = false;

export function initAnalytics(): void {
  if (!isBrowser() || initialised) return;
  const key = analyticsKey();
  if (!key) return;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    /*
      Autocapture and session recording are BOTH off on purpose. Career Élan's
      authenticated screens render resumes, cover letters and job descriptions,
      and autocapture/recording would sweep that private content into the
      analytics payload. Only the six explicit funnel events below are sent.
    */
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    capture_pageleave: false,
  });
  initialised = true;
}

/*
  Every event carries the same non-personal attribution envelope. Callers pass
  behavioural flags only - never user content.
*/
export function track(event: FunnelEvent, properties?: Record<string, string | number | boolean>): void {
  if (!isBrowser() || !analyticsKey()) return;
  try {
    /*
      Self-initialising on purpose. React runs a child's effects before a later
      sibling's, and AnalyticsProvider is mounted after {children} in the root
      layout - so a page-level effect (landing_viewed) legitimately fires before
      the provider's init would have run. Both calls are idempotent, so this
      just removes any dependency on mount ordering.
    */
    initAnalytics();
    captureAttribution();

    posthog.capture(event, {
      ...getAttribution(),
      device_type: deviceType(),
      ...properties,
    });
  } catch {
    /* analytics must never break the product */
  }
}

/*
  Fires `event` at most once per browser for the given key. Used for the
  once-per-user milestones (signup_started, first_job_added) so a re-render,
  a second keystroke or a reopened package cannot emit duplicates.
*/
export function trackOnce(
  dedupeKey: string,
  event: FunnelEvent,
  properties?: Record<string, string | number | boolean>
): void {
  if (!isBrowser() || !analyticsKey()) return;
  const storageKey = `ce_analytics_once_${dedupeKey}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
    window.localStorage.setItem(storageKey, "1");
  } catch {
    /* if storage is unavailable, fall through and still send once per page */
  }
  track(event, properties);
}
