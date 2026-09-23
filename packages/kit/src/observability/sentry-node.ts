import * as Sentry from "@sentry/node";
import { downgradeDbConnectivityEvent } from "./db-connectivity";

// Procesos sin Next.js (`packages/colyseus-server`, `packages/worker`) no
// pasan por `instrumentation.ts` — este es su equivalente a
// `sentry.server.config.ts` (ticket 6.4).
//
// `enableLogs: true` es lo que hace que `Sentry.logger` exista: sin él,
// `@escaperoom/kit/logger` sigue escribiendo por Pino pero nunca reenvía a
// Sentry.

export interface InitNodeSentryOptions {
  dsn: string | undefined;
}

/** Sin `dsn`, Sentry queda deshabilitado: no hace falta ninguna cuenta real. */
export function initNodeSentry({ dsn }: InitNodeSentryOptions): void {
  Sentry.init({
    dsn,
    enabled: !!dsn,
    enableLogs: true,
    sendDefaultPii: false,
    // Misma política que en el runtime de Next: un corte de base de datos es
    // un aviso agrupado, no un error por proceso y por tarea
    // (`db-connectivity.ts`; docs/specs/24 §6).
    beforeSend: (event, hint) => downgradeDbConnectivityEvent(event, hint),
  });
}
