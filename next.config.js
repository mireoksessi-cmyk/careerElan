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
};

module.exports = nextConfig;