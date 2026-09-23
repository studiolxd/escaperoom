import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { API_CONTENT_SECURITY_POLICY, staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@escaperoom/config",
    "@escaperoom/editor",
    "@escaperoom/env",
    "@escaperoom/game-runtime",
    "@escaperoom/kit",
    "@escaperoom/mcp-server",
    "@escaperoom/shared",
  ],
  poweredByHeader: false,
  /**
   * Cabeceras de seguridad (ticket 6.3). Las fijas van en todas las respuestas;
   * la CSP de las páginas lleva nonce y la pone `src/proxy.ts` por petición. La
   * API, que solo sirve JSON, lleva una CSP que no permite cargar nada.
   */
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders(process.env) },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
