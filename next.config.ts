import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose site URL to the client when set in Vercel (e.g. https://aimani.ai).
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID:
      process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID,
  },
};

export default nextConfig;
