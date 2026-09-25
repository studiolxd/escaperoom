import { logger } from "@escaperoom/kit/logger";
import type { RoomPackage } from "../schemas";
import {
  isLiveAccessKey,
  type AccessKeyRow,
  type GameSessionRef,
  type GroupRef,
} from "./access-keys";
import type { LiveResult, SessionStoredProgress, StoredProgressSource } from "./event-progress";
import type { EventStore } from "./events";

/**
 * Runtime de los eventos en Colyseus (ticket 5.12): lo que la room `event`
 * necesita de Postgres y nada más.
 *
 * - **Paquete**: al crearse, la room pide el `roomVersion.package` congelado
 *   del evento (`event.roomVersionId`, publicado en 3.9) y juega esa versión
 *   exacta. El evento sale del `joinToken` firmado, nunca de las opciones del
 *   cliente.
 * - **Hitos**: cada hito de la partida (inicio, puzzle resuelto, pista, puerta
 *   abierta, fin con resultado y tiempo) se persiste en `progressEvent` de
 *   forma **asíncrona**: la room los encola en un `ProgressRecorder` y sigue
 *   con el tick; un fallo de base de datos se registra y nunca rompe la
 *   partida.
 * - **Fin de grupo**: el hito `game_ended` (victoria o sin tiempo) marca la
 *   sesión como terminada, escribe `group.completedAt` de los grupos que
 *   jugaron y caduca en ese momento sus claves si el evento tiene la regla
 *   `on_group_complete` (el job de 5.5 hace lo mismo en su siguiente pasada).
 *
 * Este módulo no depende de Prisma (subpath `@escaperoom/shared/event-runtime`):
 * la implementación sobre Postgres está en `event-runtime-prisma-store.ts`.
 */

// ── Hitos ──────────────────────────────────────────────────────────────────

/** Quién provocó un hito: su grupo (del `joinToken`) y su cuenta, si tiene. */
export type MilestoneActor = {
  groupId: string | null;
  /** Id de `user` (solo jugadores con cuenta; los invitados van a `null`). */
  userId: string | null;
};

/** Contadores comunes: tiempo de juego y coste acumulado de pistas en ese instante. */
type MilestoneClock = {
  /** Epoch ms del hito (reloj del servidor de partida, no el de la base de datos). */
  at: number;
  /** Tiempo jugado desde el inicio de la partida. */
  elapsedMs: number;
  /** Coste acumulado de las pistas de la sesión (`GameState.hintsUsed`). */
  hintsUsed: number;
};

export type ProgressMilestone =
  | { kind: "game_started"; at: number; roomId: string }
  | ({ kind: "solved" | "hint_used"; puzzleId: string } & MilestoneActor & MilestoneClock)
  | ({ kind: "door_opened"; objectId: string } & MilestoneActor & MilestoneClock)
  | ({
      kind: "game_ended";
      result: LiveResult;
      /** Grupos que jugaron la partida (los que reciben `completedAt`). */
      groupIds: string[];
    } & MilestoneClock);

export type ProgressMilestoneKind = ProgressMilestone["kind"];

/** Paquete publicado de un evento, tal como se congeló al publicar. */
export type EventPackage = {
  eventId: string;
  roomVersionId: string;
  roomPackage: RoomPackage;
  /** `event.config.allowVideo` (C-3, specs/12 §4): techo de vídeo del token LiveKit; default `false`. */
  allowVideo: boolean;
};

/** Puerto de persistencia del runtime de eventos (Postgres o memoria). */
export interface EventRuntimeStore {
  /** Paquete de la versión del evento; `null` si el evento no existe o no está activo. */
  loadEventPackage(eventId: string): Promise<EventPackage | null>;
  /** Persiste un hito de la sesión (y sus efectos: estado de sesión, fin de grupo). */
  recordMilestone(sessionId: string, milestone: ProgressMilestone): Promise<void>;
}

/** `user:<id>` → `<id>`; los invitados (`guest:<uuid>`) no tienen fila en `user`. */
export function accountUserId(playerId: string): string | null {
  return playerId.startsWith("user:") ? playerId.slice("user:".length) || null : null;
}

/** ¿Este desenlace cierra el grupo (`group.completedAt`)? Abandonar no lo cierra. */
export function completesGroup(result: LiveResult): boolean {
  return result === "victory" || result === "timeout";
}

// ── Grabador asíncrono ─────────────────────────────────────────────────────

export interface ProgressRecorder {
  /** Encola el hito y vuelve enseguida (no bloquea el bucle de juego). */
  record(milestone: ProgressMilestone): void;
  /** Espera a que se escriba todo lo encolado (al destruir la room). */
  flush(): Promise<void>;
}

/**
 * Grabador de una sesión: escribe los hitos **en orden** (una cadena de
 * promesas) sin que la room espere. Cada escritura se reintenta una vez; si
 * vuelve a fallar se registra y se sigue con la siguiente (la partida manda).
 */
export function createProgressRecorder(
  store: Pick<EventRuntimeStore, "recordMilestone">,
  sessionId: string,
): ProgressRecorder {
  let chain: Promise<void> = Promise.resolve();
  return {
    record(milestone) {
      chain = chain.then(async () => {
        try {
          await store.recordMilestone(sessionId, milestone);
        } catch {
          try {
            await store.recordMilestone(sessionId, milestone);
          } catch (error) {
            logger.warn(
              { sessionId, kind: milestone.kind, err: error },
              "event-runtime: no se pudo persistir un hito de la partida",
            );
          }
        }
      });
    },
    flush: () => chain,
  };
}

// ── Reconstrucción del progreso ────────────────────────────────────────────

/** Una fila de `progressEvent` tal como la lee el panel. */
export type StoredProgressRow = {
  sessionId: string;
  kind: ProgressMilestoneKind | "attempt_failed";
  puzzleId: string | null;
  durationMs: number | null;
  hintsUsed: number;
  result: LiveResult | null;
  createdAt: Date;
};

/**
 * Progreso de una sesión a partir de sus filas de `progressEvent` (en orden de
 * escritura). Solo cuenta la **última partida** (desde el último
 * `game_started`): si la room se recreó tras un reinicio y se volvió a
 * empezar, lo anterior ya no describe la sesión. `null` si no hay partida.
 */
export function aggregateStoredProgress(
  eventId: string,
  sessionId: string,
  rows: readonly StoredProgressRow[],
  puzzlesTotal: number,
): SessionStoredProgress | null {
  const start = rows.findLastIndex((row) => row.kind === "game_started");
  if (start === -1) return null;
  const game = rows.slice(start);
  const started = game[0]!;
  const ended = game.find((row) => row.kind === "game_ended");
  const solved = new Set(
    game.flatMap((row) => (row.kind === "solved" && row.puzzleId ? [row.puzzleId] : [])),
  );
  const last = game.at(-1)!;
  const elapsed = ended?.durationMs ?? Math.max(0, ...game.map((row) => row.durationMs ?? 0));
  return {
    sessionId,
    eventId,
    phase: ended ? "ended" : "playing",
    result: ended?.result ?? null,
    puzzlesSolved: solved.size,
    puzzlesTotal,
    hintsUsed: Math.max(0, ...game.map((row) => row.hintsUsed)),
    startedAt: started.createdAt.getTime(),
    endedAt: ended ? ended.createdAt.getTime() : null,
    elapsedMs: elapsed,
    updatedAt: last.createdAt.getTime(),
  };
}

/** Agrupa filas por sesión y reconstruye cada una (orden de `sessionIds`). */
export function storedProgressForSessions(
  eventId: string,
  sessionIds: readonly string[],
  rows: readonly StoredProgressRow[],
  puzzlesTotal: number,
): SessionStoredProgress[] {
  return sessionIds.flatMap((sessionId) => {
    const progress = aggregateStoredProgress(
      eventId,
      sessionId,
      rows.filter((row) => row.sessionId === sessionId),
      puzzlesTotal,
    );
    return progress ? [progress] : [];
  });
}

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

/** Fila en memoria: la de Postgres con las columnas que escribe el runtime. */
export type InMemoryProgressRow = StoredProgressRow & {
  id: number;
  groupId: string | null;
  playerId: string | null;
  objectId: string | null;
};

/**
 * Store en memoria con la misma semántica que el de Prisma. Comparte sesiones,
 * grupos y claves con el store de claves en memoria (5.5), así un test canjea
 * con el servicio real, juega en Colyseus y comprueba `completedAt` y la
 * caducidad. Sobrevive a "reiniciar" Colyseus: basta con reutilizar la misma
 * instancia desde un servidor nuevo, como haría Postgres.
 */
export function createInMemoryEventRuntimeStore(opts: {
  events: Pick<EventStore, "findEvent">;
  /** Paquetes publicados por `roomVersionId` (el `roomVersion.package`). */
  packages: Record<string, RoomPackage>;
  keys: {
    sessions: GameSessionRef[];
    groups: Array<GroupRef & { completedAt: Date | null }>;
    keys: AccessKeyRow[];
  };
}): EventRuntimeStore &
  StoredProgressSource & {
    rows: InMemoryProgressRow[];
    /** `startedAt`/`endedAt`/`colyseusRoomId` de `gameSession` (el store de claves no los lleva). */
    sessionTimes: Map<string, { startedAt: Date | null; endedAt: Date | null; roomId: string }>;
    /** Si es `true`, cada escritura falla (simula Postgres caído). */
    down: boolean;
  } {
  const rows: InMemoryProgressRow[] = [];
  const sessionTimes = new Map<
    string,
    { startedAt: Date | null; endedAt: Date | null; roomId: string }
  >();
  let nextId = 1;

  const store = {
    rows,
    sessionTimes,
    down: false,

    async loadEventPackage(eventId: string): Promise<EventPackage | null> {
      const event = await opts.events.findEvent(eventId);
      if (!event || event.status !== "active") return null;
      const roomPackage = opts.packages[event.roomVersionId];
      return roomPackage
        ? {
            eventId,
            roomVersionId: event.roomVersionId,
            roomPackage: structuredClone(roomPackage),
            allowVideo: event.config.allowVideo,
          }
        : null;
    },

    async recordMilestone(sessionId: string, milestone: ProgressMilestone): Promise<void> {
      if (store.down) throw new Error("progressEvent: base de datos no disponible");
      const session = opts.keys.sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error(`gameSession desconocida: ${sessionId}`);
      const createdAt = new Date(milestone.at);
      const base = {
        id: nextId++,
        sessionId,
        kind: milestone.kind,
        createdAt,
        puzzleId: null as string | null,
        objectId: null as string | null,
        groupId: null as string | null,
        playerId: null as string | null,
        durationMs: null as number | null,
        hintsUsed: 0,
        result: null as LiveResult | null,
      };
      switch (milestone.kind) {
        case "game_started": {
          rows.push({ ...base, durationMs: 0 });
          const times = sessionTimes.get(sessionId);
          sessionTimes.set(sessionId, {
            startedAt: times?.startedAt ?? createdAt,
            endedAt: null,
            roomId: milestone.roomId,
          });
          if (session.status === "pending") session.status = "in_progress";
          return;
        }
        case "solved":
        case "hint_used":
        case "door_opened":
          rows.push({
            ...base,
            puzzleId: milestone.kind === "door_opened" ? null : milestone.puzzleId,
            objectId: milestone.kind === "door_opened" ? milestone.objectId : null,
            groupId: milestone.groupId,
            playerId: milestone.userId,
            durationMs: milestone.elapsedMs,
            hintsUsed: milestone.hintsUsed,
          });
          return;
        case "game_ended": {
          rows.push({
            ...base,
            durationMs: milestone.elapsedMs,
            hintsUsed: milestone.hintsUsed,
            result: milestone.result,
          });
          session.status = milestone.result === "aborted" ? "aborted" : "ended";
          const times = sessionTimes.get(sessionId);
          sessionTimes.set(sessionId, {
            startedAt: times?.startedAt ?? null,
            endedAt: createdAt,
            roomId: times?.roomId ?? "",
          });
          if (!completesGroup(milestone.result)) return;
          const completed = new Set<string>();
          for (const group of opts.keys.groups) {
            if (group.sessionId !== sessionId || !milestone.groupIds.includes(group.id)) continue;
            group.completedAt ??= createdAt;
            completed.add(group.id);
          }
          const event = await opts.events.findEvent(session.eventId);
          if (!event?.expiryRules.some((rule) => rule.type === "on_group_complete")) return;
          for (const key of opts.keys.keys) {
            if (key.groupId !== null && completed.has(key.groupId) && isLiveAccessKey(key.status)) {
              key.status = "expired";
            }
          }
          return;
        }
      }
    },

    async forEvent(eventId: string): Promise<SessionStoredProgress[]> {
      const event = await opts.events.findEvent(eventId);
      if (!event) return [];
      const sessionIds = opts.keys.sessions.filter((s) => s.eventId === eventId).map((s) => s.id);
      const total = opts.packages[event.roomVersionId]?.puzzles.length ?? 0;
      return storedProgressForSessions(eventId, sessionIds, rows, total);
    },
  };
  return store;
}
