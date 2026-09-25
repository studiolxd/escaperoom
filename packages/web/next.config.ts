import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs/config";
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
    const apiCsp = [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }];
    return [
      { source: "/:path*", headers: staticSecurityHeaders(process.env) },
      { source: "/api/:path*", headers: apiCsp },
      // A-23: la CSP de API también en el descubrimiento OAuth/MCP
      // (`/.well-known/*`) y en las rutas del propio MCP (`/mcp/*`) — antes
      // solo cubría `/api/:path*`, y esas dos sirven JSON igual que la API.
      { source: "/.well-known/:path*", headers: apiCsp },
      { source: "/mcp/:path*", headers: apiCsp },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

/**
 * Sentry (ticket 6.4). `org`/`project`/`authToken` solo hacen falta para subir
 * source maps en el build; sin ellos el build funciona igual, sin subida. Sin
 * `SENTRY_DSN` en runtime, Sentry queda deshabilitado del todo
 * (`@escaperoom/kit/observability/sentry-nextjs`).
 * https://www.npmjs.com/package/@sentry/webpack-plugin#options
 */
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Solo imprime logs de subida de source maps en CI.
  silent: !process.env.CI,
  widenClientFileUpload: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
