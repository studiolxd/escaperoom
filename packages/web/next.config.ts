import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  transpilePackages: ["@escaperoom/config", "@escaperoom/env", "@escaperoom/shared"],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
