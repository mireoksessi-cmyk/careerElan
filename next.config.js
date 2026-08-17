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
  /*
    @sparticuz/chromium must stay external for a different reason than the
    three above: it locates its own Brotli-compressed binaries at runtime
    via getBinPath() = dirname(fileURLToPath(import.meta.url)) + "/../bin"
    (node_modules/@sparticuz/chromium/build/paths.js). Bundling the package
    moves import.meta.url into a build chunk, so that relative lookup would
    resolve to a directory with no bin/ in it. Upstream states the same
    requirement for every bundler.
  */
  serverExternalPackages: [
    "pdf-parse-new",
    "pdfjs-dist",
    "isomorphic-dompurify",
    "@sparticuz/chromium",
  ],

  /*
    Two runtime data files that output file tracing cannot discover on its
    own, because both are reached through paths computed at runtime rather
    than through a static import:

    - @sparticuz/chromium/bin/* : chromium.br plus the al2023/fonts/
      swiftshader archives, found via the getBinPath() call described above
      and inflated into /tmp on first launch.
    - playwright-core/browsers.json : loaded by coreBundle.js as
      require(path.join(packageRoot, "browsers.json")). Its absence is not
      hypothetical - it is what produced the Production failure
      "Failed to load external module playwright...: Cannot find module
      '/var/task/node_modules/playwright-core/browsers.json'", which throws
      before executablePath is ever consulted. Without this entry the
      Chromium binary below would never be reached.

    Key "/*" targets all routes, which is what this Next version's own
    output.md documents for a global include. Netlify packs every route into
    one ___netlify-server-handler function, so a per-route key would buy no
    size saving while risking a missed route through bracket-segment
    escaping.
  */
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sparticuz/chromium/bin/**",
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