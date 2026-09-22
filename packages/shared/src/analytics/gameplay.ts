import type { AnalyticsEventInput, AnalyticsEventType } from "../schemas/analytics";
import type { PuzzleType } from "../schemas/puzzle";

/**
 * Capa de mapeo gameplay → analítica (specs/16 §2.2, specs/11 §10).
 *
 * El runtime/servicio de juego produce **eventos de gameplay** (puzzle o
 * interacción del motor) con el vocabulario del dominio; esta capa los traduce,
 * de forma **pura**, al sobre `AnalyticsEventInput` de 0.7 (taxonomía Zod en
 * `schemas/analytics.ts`). No importa Redis ni la cola: se puede testear sin
 * infraestructura y la emisión real vive en `gameplay-emitter.ts`.
 *
 * El mapeo 1:1 de la sección §2.2 es:
 *
 * | Evento de gameplay   | Evento de analítica |
 * |----------------------|---------------------|
 * | `puzzle_available`   | `puzzle_available`  |
 * | `puzzle_attempted`   | `puzzle_attempted`  |
 * | `puzzle_solved`      | `puzzle_solved`     |
 * | `puzzle_failed`      | `puzzle_failed`     |
 * | `hint_requested`     | `hint_viewed`       |
 * | `item_granted`       | `item_granted`      |
 * | `item_combined`      | `item_combined`     |
 * | `dialog_read`        | `dialog_read`       |
 */

/**
 * Contexto de sesión que acompaña a todos los eventos de una emisión. Sus ids
 * alimentan el sobre común; `sessionId` y `roomVersionId` deben ser `uuid`
 * (columnas `uuid` de `analyticsEvent`, specs/14 §8).
 */
export interface GameplayAnalyticsContext {
  sessionId?: string;
  playerId?: string;
  roomVersionId?: string;
}

/** Un puzzle pasa a estar disponible (prerrequisitos resueltos). */
export interface PuzzleAvailableEvent {
  type: "puzzle_available";
  puzzleId: string;
  puzzleType: PuzzleType;
  roomId: string;
}

/** Intento de resolver un puzzle (nº de intento acumulado del puzzle). */
export interface PuzzleAttemptedEvent {
  type: "puzzle_attempted";
  puzzleId: string;
  /** Positivo: `attempt_n` del contrato. */
  attempt: number;
}

/** Puzzle resuelto con las métricas acumuladas hasta el momento. */
export interface PuzzleSolvedEvent {
  type: "puzzle_solved";
  puzzleId: string;
  puzzleType: PuzzleType;
  /** Tiempo transcurrido desde que el puzzle quedó disponible (unidades del emisor). */
  durationSinceAvailable: number;
  attempts: number;
  /** Pistas consumidas del puzzle antes de resolverlo. */
  hintsUsedBefore: number;
}

/** Puzzle fallado de forma terminal (agotó intentos o expiró). */
export interface PuzzleFailedEvent {
  type: "puzzle_failed";
  puzzleId: string;
  reason: "attempts" | "timeout";
}

/** El jugador recibe el texto de una pista de un tier concreto. */
export interface HintRequestedEvent {
  type: "hint_requested";
  puzzleId: string;
  /** Positivo: tier de la pista mostrada. */
  tier: number;
}

/** Se otorga un ítem a un jugador (regla, receta o mundo). */
export interface ItemGrantedEvent {
  type: "item_granted";
  itemId: string;
  source: "puzzle" | "recipe" | "world";
}

/** Resultado de combinar ítems (acierto o combinación inválida). */
export interface ItemCombinedEvent {
  type: "item_combined";
  inputs: string[];
  output: string;
  success: boolean;
}

/** El jugador cierra un diálogo (`dialog_show` → leído). */
export interface DialogReadEvent {
  type: "dialog_read";
  dialogId: string;
}

/** Unión de los eventos de gameplay instrumentados (specs/16 §2.2). */
export type GameplayEvent =
  | PuzzleAvailableEvent
  | PuzzleAttemptedEvent
  | PuzzleSolvedEvent
  | PuzzleFailedEvent
  | HintRequestedEvent
  | ItemGrantedEvent
  | ItemCombinedEvent
  | DialogReadEvent;

function toEnvelope(
  eventType: AnalyticsEventType,
  payload: Record<string, unknown>,
  context: GameplayAnalyticsContext,
): AnalyticsEventInput {
  return {
    eventType,
    payload,
    ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
    ...(context.playerId !== undefined ? { playerId: context.playerId } : {}),
    ...(context.roomVersionId !== undefined ? { roomVersionId: context.roomVersionId } : {}),
  };
}

/**
 * Traduce un evento de gameplay al evento de analítica equivalente. Función
 * **pura**: no muta la entrada, no toca red/Redis y devuelve `null` para
 * cualquier evento desconocido (no instrumentado), de modo que el host pueda
 * pasarlo por el mapper sin filtrar antes.
 */
export function mapGameplayEvent(
  event: GameplayEvent,
  context: GameplayAnalyticsContext = {},
): AnalyticsEventInput | null {
  switch (event.type) {
    case "puzzle_available":
      return toEnvelope(
        "puzzle_available",
        {
          puzzle_id: event.puzzleId,
          type: event.puzzleType,
          room_id: event.roomId,
        },
        context,
      );
    case "puzzle_attempted":
      return toEnvelope(
        "puzzle_attempted",
        {
          puzzle_id: event.puzzleId,
          attempt_n: event.attempt,
        },
        context,
      );
    case "puzzle_solved":
      return toEnvelope(
        "puzzle_solved",
        {
          puzzle_id: event.puzzleId,
          type: event.puzzleType,
          duration_since_available: event.durationSinceAvailable,
          attempts: event.attempts,
          hints_used_before: event.hintsUsedBefore,
        },
        context,
      );
    case "puzzle_failed":
      return toEnvelope(
        "puzzle_failed",
        {
          puzzle_id: event.puzzleId,
          reason: event.reason,
        },
        context,
      );
    case "hint_requested":
      return toEnvelope(
        "hint_viewed",
        {
          puzzle_id: event.puzzleId,
          tier: event.tier,
        },
        context,
      );
    case "item_granted":
      return toEnvelope(
        "item_granted",
        {
          item_id: event.itemId,
          source: event.source,
        },
        context,
      );
    case "item_combined":
      return toEnvelope(
        "item_combined",
        {
          inputs: event.inputs,
          output: event.output,
          success: event.success,
        },
        context,
      );
    case "dialog_read":
      return toEnvelope(
        "dialog_read",
        {
          dialog_id: event.dialogId,
        },
        context,
      );
    default:
      return null;
  }
}
