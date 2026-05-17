import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose site URL to the client when set in Vercel (e.g. https://aimani.ai).
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
};

export default nextConfig;
