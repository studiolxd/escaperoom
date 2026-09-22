import {
  createDefineQueue,
  readQueuesRuntimeConfig,
  type QueueHandle,
  type QueuesRuntimeConfig,
} from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import type { AnalyticsEventInput } from "../schemas/analytics";

/**
 * Cola de analítica (specs/16 §1): Next API y Colyseus encolan aquí; el worker
 * de `@escaperoom/worker` la consume e inserta en `analyticsEvent` (specs/14 §8).
 *
 * El encolado NUNCA bloquea ni rompe la request: con `QUEUES_ENABLED=false` o
 * sin Redis, `defineQueue` degrada a no-op (specs/16 §1: si la cola cae, se
 * pierde analítica, nunca gameplay).
 */

export const ANALYTICS_QUEUE_NAME = "analytics.event";

/** Construye el handle de la cola con una config explícita (tests, otros procesos). */
export function createAnalyticsQueue(
  config: QueuesRuntimeConfig = readQueuesRuntimeConfig(),
): QueueHandle<AnalyticsEventInput> {
  return createDefineQueue(config)<AnalyticsEventInput>({ name: ANALYTICS_QUEUE_NAME });
}

/** Handle por defecto, atado a `QUEUES_ENABLED` de `@escaperoom/env`. */
export const analyticsQueue = createAnalyticsQueue();

export type EmitAnalyticsResult = {
  /** Nº de eventos encolados. */
  accepted: number;
  /** Id de job por evento; `null` cuando la cola está deshabilitada o cayó Redis. */
  jobIds: (string | null)[];
};

/**
 * Función de emisión reutilizable (specs/16 §2). Recibe eventos ya validados
 * por el punto de colección y los encola. Es best-effort: nunca lanza hacia
 * quien emite.
 */
export async function emitAnalyticsEvents(
  events: readonly AnalyticsEventInput[],
  queue: QueueHandle<AnalyticsEventInput> = analyticsQueue,
): Promise<EmitAnalyticsResult> {
  const jobIds = await Promise.all(events.map((event) => queue.enqueue(event)));
  if (jobIds.some((id) => id === null)) {
    logger.debug(
      { accepted: events.length },
      "analytics: cola deshabilitada o Redis caído; parte del lote se descarta",
    );
  }
  return { accepted: events.length, jobIds };
}
