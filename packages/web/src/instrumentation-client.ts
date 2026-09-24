// Sentry en el navegador (ticket 6.4, F-12): antes solo estaba `sentry.server.
// config.ts`/`sentry.edge.config.ts` — los errores de Phaser, LiveKit,
// Colyseus o React que solo ocurren en cliente no llegaban a Sentry. La
// política vive en `@escaperoom/kit/observability/sentry-nextjs-client`, no
// copiada aquí. El origen de Sentry está en `connect-src` de la CSP
// (`src/lib/security-headers.ts`).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initNextjsSentryClient } from "@escaperoom/kit/observability/sentry-nextjs-client";
import * as Sentry from "@sentry/nextjs";

initNextjsSentryClient();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
