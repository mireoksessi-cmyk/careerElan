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

  /*
    Two runtime inputs that output file tracing cannot discover on its own,
    because neither is reached through a static import:

    - build/chromium-runtime/** : the packaged Chromium runtime produced by
      scripts/prepare-chromium-runtime.mjs before `next build`. It is read at
      request time by lib/documentPreservation/sharedBrowser.ts, which resolves
      it by walking up from its own module location.
    - playwright-core/browsers.json : coreBundle.js builds its browser registry
      at module load via require(path.join(packageRoot, "browsers.json")), a
      runtime-computed path the tracer cannot follow. Its absence is not
      hypothetical - it previously produced "Failed to load external module
      playwright...: Cannot find module '/var/task/node_modules/playwright-core/
      browsers.json'" in Production, thrown before executablePath was ever read.

    Key "/*" targets all routes, which is what this Next version's own output.md
    documents for a global include. Netlify packs every route into one
    ___netlify-server-handler, so a per-route key would save nothing while
    risking a missed route through bracket-segment escaping.
  */
  outputFileTracingIncludes: {
    "/*": [
      "./build/chromium-runtime/**",
      "./node_modules/playwright-core/browsers.json",
    ],
  },

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