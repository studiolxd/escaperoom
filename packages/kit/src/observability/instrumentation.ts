/**
 * El `register()` que Next invoca desde `src/instrumentation.ts`: carga la
 * configuración de Sentry del runtime que toque (ticket 6.4). Los
 * `sentry.*.config` viven en la raíz de la app (Next los busca ahí), así que
 * la app pasa los imports.
 */
export interface InstrumentationOptions {
  /** `() => import("../sentry.server.config")`. */
  loadServerConfig(): Promise<unknown>;
  /** `() => import("../sentry.edge.config")`. */
  loadEdgeConfig(): Promise<unknown>;
  /** Trabajo de arranque en desarrollo, best-effort y sin bloquear. */
  onDevBoot?(): Promise<unknown>;
}

export function createInstrumentation({
  loadServerConfig,
  loadEdgeConfig,
  onDevBoot,
}: InstrumentationOptions) {
  return {
    async register(): Promise<void> {
      if (process.env.NEXT_RUNTIME === "nodejs") {
        await loadServerConfig();

        if (process.env.NODE_ENV === "development" && onDevBoot) {
          void onDevBoot().catch(() => {});
        }
      }

      if (process.env.NEXT_RUNTIME === "edge") {
        await loadEdgeConfig();
      }
    },
  };
}
