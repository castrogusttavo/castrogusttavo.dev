import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  experimental: {
    // The root layout lives under app/[locale], a top-level dynamic segment,
    // so Next can't compose a single 404 from layout.js + not-found.js.
    globalNotFound: true,
  },
};

export default nextConfig;
