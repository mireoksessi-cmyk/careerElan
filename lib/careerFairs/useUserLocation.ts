"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeProvinceOrTerritory } from "./provinces";

export type UserLocationStatus =
  | "idle"
  | "checking-permission"
  | "available-not-requested"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported";

export type UserLocationResult = {
  status: UserLocationStatus;
  city: string | null;
  province: ReturnType<typeof normalizeProvinceOrTerritory>;
  requestLocation: () => void;
};

/*
  Never forces the browser's geolocation permission prompt. On mount this
  only checks the Permissions API (if available) and silently reads the
  position ONLY when permission was already previously granted - it never
  calls getCurrentPosition() itself when permission is still in the
  "prompt" (undecided) state. Showing the actual OS/browser prompt only
  happens when the caller invokes requestLocation() in direct response to
  a user action (e.g. clicking a "Use my location" button) - the feature
  works with recommendations immediately either way (the caller falls back
  to the Canada-wide tier until/unless this resolves to "granted").

  Reverse geocoding happens entirely in the browser via a direct client-
  side fetch to BigDataCloud's free reverse-geocode-client endpoint (no
  API key, designed for this exact browser-only use case) - the raw
  latitude/longitude never leaves this hook or reaches this app's own
  server; only the derived city/province strings are ever used by the
  caller (passed as plain query params to /api/career-fairs/recommend),
  and neither this hook nor the server persists them anywhere.
*/
/*
  Whether the browser supports geolocation at all is already known
  synchronously at render time (no async check needed) - computed here via
  a lazy useState initializer instead of an effect that would just set the
  exact same "unsupported" value on mount, which is what a linter flags as
  an avoidable setState-in-effect (see the comment on the early-return
  branch below).
*/
function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation);
}

/*
  Every branch here is synchronously knowable from the browser's own
  capabilities (no async permission check needed to decide between these
  three) - computed once as the initial state instead of inside the mount
  effect below, which used to set this exact same value synchronously on
  every mount for the "unsupported" and "no Permissions API" cases (an
  avoidable react-hooks/set-state-in-effect flag). Only the genuinely async
  case - actually querying navigator.permissions - still needs the effect.
*/
function computeInitialStatus(): UserLocationStatus {
  if (!isGeolocationSupported()) return "unsupported";
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "available-not-requested";
  }
  return "checking-permission";
}

export function useUserLocation(): UserLocationResult {
  const [status, setStatus] = useState<UserLocationStatus>(computeInitialStatus);
  const [city, setCity] = useState<string | null>(null);
  const [province, setProvince] = useState<
    ReturnType<typeof normalizeProvinceOrTerritory>
  >(null);

  const resolveFromCoords = useCallback(
    async (latitude: number, longitude: number) => {
      try {
        const response = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
        );
        if (!response.ok) throw new Error("Reverse geocode request failed.");

        const data = await response.json();
        const resolvedCity: string | null =
          data?.city || data?.locality || null;
        const resolvedProvince = normalizeProvinceOrTerritory(
          data?.principalSubdivision || null
        );

        setCity(resolvedCity);
        setProvince(resolvedProvince);
        setStatus("granted");
      } catch {
        // Reverse-geocoding failed (network, rate limit, etc.) - the
        // caller still has a real granted-permission signal, just no
        // city/province to narrow by; fall back to the Canada-wide tier
        // rather than erroring the whole recommendation flow.
        setStatus("granted");
      }
    },
    []
  );

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void resolveFromCoords(
          position.coords.latitude,
          position.coords.longitude
        );
      },
      () => {
        setStatus("denied");
      },
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  }, [resolveFromCoords]);

  useEffect(() => {
    // Both bail-out cases are already reflected in the lazy initial state
    // above (computeInitialStatus) - only the genuinely async
    // permissions.query() path below needs to run inside an effect.
    if (!isGeolocationSupported() || !navigator.permissions?.query) return;

    let cancelled = false;

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;

        if (result.state === "granted") {
          requestLocation();
        } else {
          setStatus("available-not-requested");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("available-not-requested");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, city, province, requestLocation };
}
