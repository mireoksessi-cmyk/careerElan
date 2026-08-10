/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
    isomorphic-dompurify wraps jsdom, which has a long-standing history of
    breaking when a bundler tries to statically package it (dynamic
    requires, native-ish internals) - the same class of problem
    pdfjs-dist already needed this same fix for. Externalizing it, on top
    of app/api/process-resume-design/route.ts already dynamic-importing
    it instead of loading it at module top-level, is belt-and-suspenders
    for the exact failure mode that route was hitting in Production
    (every request crashing before any of the route's own code ran).
  */
  serverExternalPackages: [
    "pdf-parse-new",
    "pdfjs-dist",
    "isomorphic-dompurify",
  ],

  eslint: {
    ignoreDuringBuilds: true,
  },

  /*
    Next.js 16's dev-only cross-origin guard treats "localhost" and
    "127.0.0.1" as different origins even though both point at the same
    dev server. The Playwright E2E suite (e2e/helpers/env.ts) navigates
    via 127.0.0.1 specifically (a DEDICATED origin, chosen so the E2E
    server is never confused with a developer's own localhost session -
    see e2e/globalSetup.ts), which without this entry gets every
    /_next/* dev resource (including the webpack-hmr websocket AND,
    critically, hydration-relevant chunks) silently blocked - the page
    looks visually correct (server-rendered HTML) but no client
    component ever mounts, since the client runtime it depends on never
    loads. Dev-only setting; no effect on `next build`/`next start`.
  */
  allowedDevOrigins: ["127.0.0.1"],
};

module.exports = nextConfig;