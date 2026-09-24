import * as Sentry from "@sentry/nextjs";
import { createInstrumentation } from "@escaperoom/kit/observability/instrumentation";

// El arranque de la instrumentación es de esta app (ticket 6.4); los
// `sentry.*.config` viven en su raíz porque ahí los busca Next.
const { register: registerObservability } = createInstrumentation({
  loadServerConfig: () => import("../sentry.server.config"),
  loadEdgeConfig: () => import("../sentry.edge.config"),
});

/**
 * Además de Sentry: valida el entorno (E-4) antes de que el servidor acepte
 * tráfico. Solo en el runtime Node (no edge) y no durante `next build`: Next
 * llama a `register()` al arrancar un servidor real, nunca al compilar.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOnBoot } = await import("./env");
    validateEnvOnBoot();
  }
  await registerObservability();
}

export const onRequestError = Sentry.captureRequestError;
