import * as Sentry from "@sentry/nextjs";

/**
 * Inicialización de Sentry para el runtime de navegador de Next (ticket 6.4,
 * F-12): `src/instrumentation-client.ts` vive en `packages/web` porque ahí
 * lo busca Next, pero solo llama aquí — misma política que
 * `sentry-nextjs.ts` (servidor/edge), sin `beforeSend` de conectividad de
 * base de datos porque eso no aplica al navegador.
 *
 * Sin `NEXT_PUBLIC_SENTRY_DSN`, Sentry queda deshabilitado (`enabled:
 * false`): no hace falta ninguna cuenta real para que el código funcione.
 * El origen de Sentry debe estar en `connect-src` de la CSP
 * (`src/lib/security-headers.ts`) o el navegador bloquea el envío.
 */
export function initNextjsSentryClient(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  Sentry.init({
    dsn,
    enabled: !!dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1,
    sendDefaultPii: false,
  });
}
