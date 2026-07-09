/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse-new"],

  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;