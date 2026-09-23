import * as Sentry from "@sentry/nextjs";
import { downgradeDbConnectivityEvent } from "./db-connectivity";

/**
 * Inicialización de Sentry para los runtimes de Next (servidor y edge) de
 * `packages/web` (ticket 6.4). Los `sentry.server.config.ts` /
 * `sentry.edge.config.ts` viven en la raíz de la app porque ahí los busca
 * Next, pero solo llaman aquí: la política vive en el kit, no en cada app.
 *
 * Sin `SENTRY_DSN`, Sentry queda deshabilitado (`enabled: false`): no hace
 * falta ninguna cuenta real para que el código funcione.
 */
export function initNextjsSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  Sentry.init({
    dsn,
    enabled: !!dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1,
    enableLogs: true,
    sendDefaultPii: false,
    // Conectividad de base de datos = aviso agrupado, nunca un error por
    // petición (`db-connectivity.ts`; docs/specs/24 §6).
    beforeSend: (event, hint) => downgradeDbConnectivityEvent(event, hint),
  });
}
