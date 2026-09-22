import { logger } from "@escaperoom/kit/logger";
import {
  validateAnalyticsCollect,
  type AnalyticsEventInput,
} from "@escaperoom/shared/schemas";

/** Dependencias inyectables del handler (testeable sin Redis ni base de datos). */
export type AnalyticsCollectDeps = {
  /**
   * Función de emisión (specs/16 §2). Debe encolar y resolver sin tocar la base
   * de datos: la escritura en `analyticsEvent` la hace el worker.
   */
  emit: (events: AnalyticsEventInput[]) => Promise<unknown>;
};

/**
 * Handler del punto de colección `POST /api/analytics/collect` (specs/16 §5).
 *
 * Valida el lote contra la taxonomía (`specs/16 §2`) y lo encola; responde 202
 * sin esperar a la escritura en base de datos. Nunca bloquea la request: si la
 * cola está deshabilitada o Redis cae, la emisión degrada a no-op y la respuesta
 * sigue siendo 202 (la analítica se pierde, el gameplay no).
 */
export function createAnalyticsCollectHandler(deps: AnalyticsCollectDeps) {
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "El cuerpo de la petición debe ser JSON válido",
          },
        },
        { status: 400 },
      );
    }

    const result = validateAnalyticsCollect(body);
    if (!result.ok) {
      return Response.json(
        {
          error: {
            code: "INVALID_EVENT",
            message: "El payload no cumple la taxonomía de analítica (specs/16 §2)",
            issues: result.issues,
          },
        },
        { status: 400 },
      );
    }

    // Fire-and-forget: no esperamos al encolado. El error se registra y se
    // descarta la analítica; la request responde 202 igualmente.
    try {
      void Promise.resolve(deps.emit(result.events)).catch((err) => {
        logger.warn({ err }, "analytics: no se pudo encolar; se descarta el evento");
      });
    } catch (err) {
      logger.warn({ err }, "analytics: no se pudo encolar; se descarta el evento");
    }

    return Response.json({ accepted: result.events.length }, { status: 202 });
  };
}
