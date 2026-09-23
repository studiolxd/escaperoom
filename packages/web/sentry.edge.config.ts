// Sentry en el runtime edge de Next (middleware, rutas edge; ticket 6.4).
// Misma configuración que el servidor y por el mismo motivo: la política
// vive en el kit, no copiada dos veces.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initNextjsSentry } from "@escaperoom/kit/observability/sentry-nextjs";

initNextjsSentry();
