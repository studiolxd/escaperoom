import { timingSafeEqual } from "node:crypto";
import { logger } from "@escaperoom/kit/logger";
import {
  isBrowserEmittableAnalyticsEventType,
  validateAnalyticsCollect,
  type AnalyticsEventInput,
} from "@escaperoom/shared/schemas";
import { isAnonymous, type Actor } from "@escaperoom/shared/services";

/** Cabecera del secreto servidor-a-servidor (A-2, ticket 6.6). */
export const ANALYTICS_SERVER_SECRET_HEADER = "x-analytics-server-secret";

const NO_STORE = { "Cache-Control": "no-store" };

/** Dependencias inyectables del handler (testeable sin Redis ni base de datos). */
export type AnalyticsCollectDeps = {
  /**
   * Función de emisión (specs/16 §2). Debe encolar y resolver sin tocar la base
   * de datos: la escritura en `analyticsEvent` la hace el worker.
   */
  emit: (events: AnalyticsEventInput[]) => Promise<unknown>;
  /** Actor de la petición (sesión de Better Auth, o anónimo). */
  resolveActor: (request: Request) => Promise<Actor>;
  /**
   * Secreto compartido con Colyseus/el worker (`ANALYTICS_SERVER_SECRET`).
   * `null` desactiva el camino servidor-a-servidor: toda petición se trata
   * como navegador.
   */
  serverSecret: string | null;
};

/**
 * Compara la cabecera del secreto servidor-a-servidor en tiempo constante.
 * Longitudes distintas nunca deben filtrarse por temporización, así que se
 * compara siempre contra un buffer de igual tamaño al del secreto.
 */
function isServerOriginRequest(serverSecret: string | null, header: string | null): boolean {
  if (!serverSecret || !header) return false;
  const expected = Buffer.from(serverSecret);
  const provided = Buffer.from(header);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status: 400, headers: NO_STORE });
}

/**
 * Handler del punto de colección `POST /api/analytics/collect` (specs/16 §5).
 *
 * Valida el lote contra la taxonomía (`specs/16 §2`) y lo encola; responde 202
 * sin esperar a la escritura en base de datos. Nunca bloquea la request: si la
 * cola está deshabilitada o Redis cae, la emisión degrada a no-op y la respuesta
 * sigue siendo 202 (la analítica se pierde, el gameplay no).
 *
 * A-2: una petición sin el secreto servidor-a-servidor viene del navegador, así
 * que (a) solo puede emitir los tipos de `BROWSER_ANALYTICS_EVENT_TYPES` (hoy
 * solo `onboarding_step`) y (b) `playerId` se sustituye siempre por el de la
 * sesión (o se borra si es anónima): nunca se confía en el que venga en el
 * cuerpo, que cualquiera puede rellenar con el id de otro usuario.
 */
export function createAnalyticsCollectHandler(deps: AnalyticsCollectDeps) {
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("INVALID_JSON", "El cuerpo de la petición debe ser JSON válido");
    }

    const result = validateAnalyticsCollect(body);
    if (!result.ok) {
      return badRequest(
        "INVALID_EVENT",
        "El payload no cumple la taxonomía de analítica (specs/16 §2)",
        { issues: result.issues },
      );
    }

    const serverOrigin = isServerOriginRequest(
      deps.serverSecret,
      request.headers.get(ANALYTICS_SERVER_SECRET_HEADER),
    );

    let events = result.events;
    if (!serverOrigin) {
      const disallowed = events.find((event) => !isBrowserEmittableAnalyticsEventType(event.eventType));
      if (disallowed) {
        return badRequest(
          "FORBIDDEN_EVENT_TYPE",
          `El tipo "${disallowed.eventType}" solo lo puede emitir el servidor`,
        );
      }

      const actor = await deps.resolveActor(request);
      const playerId = isAnonymous(actor) ? undefined : actor.userId;
      events = events.map((event) => ({ ...event, playerId }));
    }

    // Fire-and-forget: no esperamos al encolado. El error se registra y se
    // descarta la analítica; la request responde 202 igualmente.
    try {
      void Promise.resolve(deps.emit(events)).catch((err) => {
        logger.warn({ err }, "analytics: no se pudo encolar; se descarta el evento");
      });
    } catch (err) {
      logger.warn({ err }, "analytics: no se pudo encolar; se descarta el evento");
    }

    return Response.json({ accepted: events.length }, { status: 202, headers: NO_STORE });
  };
}
