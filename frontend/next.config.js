const directusBase = (process.env.DIRECTUS_URL || process.env.NEXT_PUBLIC_DIRECTUS_URL || "http://localhost:28055").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/directus/:path*",
        destination: `${directusBase}/:path*`
      }
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/hctxf-assets/**"
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "8055",
        pathname: "/assets/**"
      },
      {
        protocol: "http",
        hostname: "directus",
        port: "8055",
        pathname: "/assets/**"
      }
    ]
  },
  env: {
    ENABLE_LAYOUT_MOCK: process.env.ENABLE_LAYOUT_MOCK || "false"
  }
};

module.exports = nextConfig;
