import { logger } from "@escaperoom/kit/logger";
import type { QueueHandle } from "@escaperoom/kit/queue";
import type { AnalyticsEventInput } from "../schemas/analytics";
import { validateAnalyticsEvent } from "../schemas/analytics";
import { mapGameplayEvent, type GameplayAnalyticsContext, type GameplayEvent } from "./gameplay";
import { analyticsQueue, emitAnalyticsEvents, type EmitAnalyticsResult } from "./queue";

/**
 * Punto de emisión de analítica de gameplay (specs/16 §2.2, specs/11 §10).
 *
 * Este es el punto claro y único que deben usar el runtime y los servicios de
 * juego (Colyseus GameRoom, host de Phaser/React) para instrumentar partidas:
 *
 * ```ts
 * const emit = createGameplayAnalyticsEmitter();
 * await emit([{ type: "puzzle_solved", puzzleId, puzzleType, ... }], {
 *   sessionId, playerId, roomVersionId,
 * });
 * ```
 *
 * Es **best-effort**: valida contra la taxonomía de 0.7, descarta lo que no
 * encaje (sin lanzar) y delega el encolado en `emitAnalyticsEvents`, que degrada
 * a no-op si la cola está deshabilitada o Redis cae. Igual que en 0.7, la
 * analítica nunca bloquea ni rompe el gameplay.
 */

/** Resultado de emitir un lote de eventos de gameplay. */
export interface EmitGameplayResult extends EmitAnalyticsResult {
  /** Nº de eventos de gameplay descartados (desconocidos o payload inválido). */
  skipped: number;
}

/**
 * Mapea y emite un lote de eventos de gameplay. Reutiliza el mapper puro y el
 * emisor de cola de 0.7. Nunca lanza: los eventos desconocidos o con payload
 * fuera de la taxonomía se descartan y se cuentan en `skipped`.
 */
export async function emitGameplayEvents(
  events: readonly GameplayEvent[],
  context: GameplayAnalyticsContext = {},
  queue: QueueHandle<AnalyticsEventInput> = analyticsQueue,
): Promise<EmitGameplayResult> {
  const accepted: AnalyticsEventInput[] = [];
  let skipped = 0;

  for (const event of events) {
    const analyticsEvent = mapGameplayEvent(event, context);
    if (analyticsEvent === null) {
      skipped += 1;
      continue;
    }
    const validation = validateAnalyticsEvent(analyticsEvent);
    if (!validation.ok) {
      skipped += 1;
      logger.warn(
        { eventType: analyticsEvent.eventType, issues: validation.issues },
        "analytics: evento de gameplay fuera de la taxonomía; se descarta",
      );
      continue;
    }
    accepted.push(validation.data);
  }

  const result = await emitAnalyticsEvents(accepted, queue);
  return { ...result, skipped };
}

/** Emisor atado a una cola concreta (inyectable en tests y servicios). */
export type GameplayAnalyticsEmitter = (
  events: readonly GameplayEvent[],
  context?: GameplayAnalyticsContext,
) => Promise<EmitGameplayResult>;

/**
 * Construye un emisor de analítica de gameplay con su propia cola. Útil para
 * inyectar una conexión/cola en tests o en un proceso de servidor concreto.
 */
export function createGameplayAnalyticsEmitter(
  queue: QueueHandle<AnalyticsEventInput> = analyticsQueue,
): GameplayAnalyticsEmitter {
  return (events, context) => emitGameplayEvents(events, context, queue);
}
