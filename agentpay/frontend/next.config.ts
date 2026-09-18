import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://frame-backend-868z.onrender.com',
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
