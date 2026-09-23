import * as Sentry from "@sentry/nextjs";
import { createInstrumentation } from "@escaperoom/kit/observability/instrumentation";

// El arranque de la instrumentación es de esta app (ticket 6.4); los
// `sentry.*.config` viven en su raíz porque ahí los busca Next.
export const { register } = createInstrumentation({
  loadServerConfig: () => import("../sentry.server.config"),
  loadEdgeConfig: () => import("../sentry.edge.config"),
});

export const onRequestError = Sentry.captureRequestError;
