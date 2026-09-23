import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { buildContentSecurityPolicy, createNonce, NONCE_HEADER } from "./lib/security-headers";

const intl = createMiddleware(routing);

/**
 * `proxy.ts` es el antiguo `middleware.ts` (renombrado en Next 16). Detecta el
 * locale, redirige "/" a `/es` y sirve `/es`, `/es/lobby`, etc.
 *
 * Además fija la CSP de las páginas (ticket 6.3) con un nonce por petición.
 * Next lee la CSP de las cabeceras de la PETICIÓN para poner ese nonce en sus
 * `<script>`; next-intl copia las cabeceras de la petición a su respuesta
 * (`NextResponse.next({ request: { headers } })`), así que basta con fijarlas
 * antes de llamarlo. La respuesta lleva la misma CSP para el navegador.
 */
export default function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env);
  request.headers.set("Content-Security-Policy", csp);
  request.headers.set(NONCE_HEADER, nonce);

  const response = intl(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: "/((?!api|mcp|trpc|_next|_vercel|.*\\..*).*)",
};
