import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@escaperoom/env", "@escaperoom/shared"],
};

export default nextConfig;
