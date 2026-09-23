// Sentry en el runtime de servidor de Next (ticket 6.4). La configuración
// vive en @escaperoom/kit/observability/sentry-nextjs, no copiada aquí — entre
// otras cosas, ahí está la política de bajar a aviso un corte de conexión a
// Postgres (docs/specs/24-operaciones-y-escalabilidad.md §6).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initNextjsSentry } from "@escaperoom/kit/observability/sentry-nextjs";

initNextjsSentry();
