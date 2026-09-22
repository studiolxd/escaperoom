import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * `proxy.ts` es el antiguo `middleware.ts` (renombrado en Next 16). Detecta el
 * locale, redirige "/" a `/es` y sirve `/es`, `/es/lobby`, etc.
 */
export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|mcp|trpc|_next|_vercel|.*\\..*).*)",
};
