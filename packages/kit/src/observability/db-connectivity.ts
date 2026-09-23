/**
 * Política: **un corte de conexión a Postgres es un AVISO, no un error de
 * aplicación** (docs/specs/24-operaciones-y-escalabilidad.md §6, ticket 6.4).
 *
 * Quien vigila que Postgres esté arriba es Uptime Kuma, que sondea
 * `/api/health` (ticket 6.4). Sin este filtro, Sentry recibiría un evento de
 * error por petición durante cualquier reinicio de Postgres/PgBouncer del
 * `infra/docker-compose.dev.yml` (o del equivalente en producción) —
 * potencialmente decenas de eventos en unos segundos, todos por la misma
 * causa. Adaptado de @slxd/kit/observability/db-connectivity.
 *
 * Qué NO hace: descartar el evento. El corte se quiere ver — una vez, en un
 * issue agrupado, en nivel `warning`. Los errores de negocio no se tocan.
 */

/** Fingerprint común: agrupa todos los cortes de un proceso en un solo issue. */
export const DB_UNREACHABLE_FINGERPRINT = "db-unreachable";

/**
 * Códigos de Prisma que significan «no he podido hablar con la base», no
 * «la base me ha dicho que no» (mismo cliente Prisma que
 * `packages/shared/src/db/index.ts`, generado desde `packages/shared/prisma/schema.prisma`):
 * - `P1001` no se alcanza el servidor (reinicio del contenedor de Postgres),
 * - `P1002` el servidor se alcanzó pero venció el tiempo de espera,
 * - `P1017` el servidor cerró la conexión.
 */
const CONNECTIVITY_CODES = new Set(["P1001", "P1002", "P1017"]);

/**
 * Mensajes que hay que reconocer por texto porque llegan envueltos: el error
 * de Prisma cruza tRPC, Better Auth o el render de una página y lo que se
 * conserva es la cadena.
 */
const CONNECTIVITY_MESSAGES = [
  "can't reach database server",
  "server has closed the connection",
  "timed out fetching a new connection from the connection pool",
];

function codeOf(err: object): unknown {
  if ("code" in err) return (err as { code: unknown }).code;
  if ("errorCode" in err) return (err as { errorCode: unknown }).errorCode;
  return undefined;
}

function messageLooksLikeConnectivity(message: string): boolean {
  const lower = message.toLowerCase();
  return CONNECTIVITY_MESSAGES.some((needle) => lower.includes(needle));
}

/** ¿Este error es «no llego a la base» (y no un fallo de consulta o de datos)? */
export function isDbConnectivityError(err: unknown): boolean {
  if (typeof err === "string") return messageLooksLikeConnectivity(err);
  if (!err || typeof err !== "object") return false;

  const code = codeOf(err);
  if (typeof code === "string" && CONNECTIVITY_CODES.has(code)) return true;

  const message = (err as { message?: unknown }).message;
  if (typeof message === "string" && messageLooksLikeConnectivity(message)) {
    return true;
  }

  // Un error envuelto (`new Error("…", { cause })`, el `err` de un job) sigue
  // llevando dentro el de Prisma.
  const cause = (err as { cause?: unknown }).cause;
  return cause ? isDbConnectivityError(cause) : false;
}

/** Lo mínimo que este módulo necesita de un evento de Sentry. */
export interface DowngradableEvent {
  level?: string;
  fingerprint?: string[];
  exception?: {
    values?: { type?: string; value?: string }[];
  };
}

/**
 * `beforeSend` de Sentry: baja a `warning` y fija el fingerprint común los
 * eventos de conectividad que llegan por vías que este módulo no controla
 * directamente (SSR de una página, tRPC, Better Auth, un job de BullMQ).
 *
 * Devuelve SIEMPRE el evento: nunca se descarta nada.
 */
export function downgradeDbConnectivityEvent<E extends DowngradableEvent>(
  event: E,
  hint?: { originalException?: unknown },
): E {
  const fromHint = isDbConnectivityError(hint?.originalException);
  const fromEvent = (event.exception?.values ?? []).some(
    (value) => typeof value.value === "string" && isDbConnectivityError(value.value),
  );
  if (!fromHint && !fromEvent) return event;

  return { ...event, level: "warning", fingerprint: [DB_UNREACHABLE_FINGERPRINT] };
}
