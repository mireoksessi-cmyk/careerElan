/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse-new", "pdfjs-dist"],

  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;