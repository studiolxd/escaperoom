import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Progreso en vivo de las sesiones de un evento y ranking del evento (ticket
 * 5.9, specs/19 §2, specs/21 §4).
 *
 * La `EventRoom` de Colyseus publica en su metadata un `SessionLiveProgress`
 * (proyección **pública**: contadores y tiempos, nunca soluciones) y la ruta
 * interna `GET /internal/events/:eventId/progress` los devuelve todos; web los
 * lee con `createColyseusLiveProgressSource` y el panel los cruza con Postgres
 * (`createEventPanelService`). Este módulo no depende de Prisma (subpath
 * `@escaperoom/shared/event-progress`), así que Colyseus lo importa sin
 * arrastrar el cliente de base de datos.
 *
 * Desde el ticket 5.12 la room además persiste cada hito en `progressEvent`
 * (`event-runtime.ts`) y el panel cruza el vivo con el persistido
 * (`StoredProgressSource`), así que el progreso sobrevive a un reinicio.
 */

/** Ruta interna de Colyseus con el progreso de las rooms de un evento. */
export const EVENT_PROGRESS_INTERNAL_PATH = "/internal/events";

/** Fase de la room tal como la sincroniza la `GameRoom`. */
export const LIVE_PHASES = ["lobby", "playing", "paused", "ended"] as const;
export type LivePhase = (typeof LIVE_PHASES)[number];

/** Resultado canónico de una partida terminada (`SessionResult`). */
export const LIVE_RESULTS = ["victory", "timeout", "aborted"] as const;
export type LiveResult = (typeof LIVE_RESULTS)[number];

/** Progreso de la room de una sesión de evento (lo que sale de Colyseus). */
export const SessionLiveProgressSchema = z.object({
  sessionId: z.string().min(1).max(128),
  eventId: z.string().min(1).max(128),
  /** Id de la room de Colyseus. */
  roomId: z.string().min(1).max(128),
  phase: z.enum(LIVE_PHASES),
  result: z.enum(LIVE_RESULTS).nullable(),
  puzzlesSolved: z.number().int().min(0),
  puzzlesTotal: z.number().int().min(0),
  /** Coste acumulado de las pistas pedidas (`GameState.hintsUsed`). */
  hintsUsed: z.number().int().min(0),
  /** Jugadores conectados ahora (los observadores no cuentan). */
  players: z.number().int().min(0),
  /** `meta.players.min` de la sala (inicio conjunto, panel del organizador). */
  minPlayers: z.number().int().min(0),
  /** Conectados con "Listo" marcado (inicio conjunto, panel del organizador). */
  readyCount: z.number().int().min(0),
  /** Epoch ms del inicio de la partida, `null` en el lobby. */
  startedAt: z.number().nullable(),
  /** Epoch ms del final, `null` mientras se juega. */
  endedAt: z.number().nullable(),
  /** Tiempo jugado (hasta el final o hasta `updatedAt`). */
  elapsedMs: z.number().min(0),
  /** Epoch ms de la última actualización. */
  updatedAt: z.number(),
});
export type SessionLiveProgress = z.infer<typeof SessionLiveProgressSchema>;

const LiveProgressResponse = z.object({ sessions: z.array(SessionLiveProgressSchema) });

/** Fuente del progreso en vivo (Colyseus por HTTP; en memoria en tests). */
export interface LiveProgressSource {
  /** Progreso de las rooms vivas del evento; `null` si la fuente no responde. */
  forEvent(eventId: string): Promise<SessionLiveProgress[] | null>;
}

/**
 * Credencial de la ruta interna: derivada de `JOIN_TOKEN_SECRET` (el secreto
 * web ↔ Colyseus de los eventos), así el secreto en claro no viaja nunca.
 */
export function eventProgressBearer(secret: string): string {
  return createHmac("sha256", secret).update("escaperoom/event-progress/v1").digest("base64url");
}

/** Comprueba la cabecera `Authorization: Bearer …` de la ruta interna (tiempo constante). */
export function isEventProgressAuthorized(secret: string, header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) =>
    createHmac("sha256", "escaperoom/event-progress-check/v1").update(value).digest();
  return timingSafeEqual(
    digest(header.slice("Bearer ".length)),
    digest(eventProgressBearer(secret)),
  );
}

/** Cliente HTTP de la ruta interna; cualquier fallo de red o de forma → `null`. */
export function createColyseusLiveProgressSource(options: {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): LiveProgressSource {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/u, "");
  return {
    async forEvent(eventId) {
      try {
        const res = await doFetch(
          `${base}${EVENT_PROGRESS_INTERNAL_PATH}/${encodeURIComponent(eventId)}/progress`,
          {
            headers: { authorization: `Bearer ${eventProgressBearer(options.secret)}` },
            signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
          },
        );
        if (!res.ok) return null;
        const parsed = LiveProgressResponse.safeParse(await res.json());
        return parsed.success
          ? parsed.data.sessions.filter((session) => session.eventId === eventId)
          : null;
      } catch {
        return null;
      }
    },
  };
}

// ── Inicio conjunto ("Todos los grupos comienzan juntos") ──────────────────

/**
 * Desenlace de `EventRoom.organizerStartGroup` para UN grupo: `started` (se
 * arrancó), `already_started` (fase distinta de `lobby`, no-op), `empty`
 * (sin conectados: nunca arranca, ni con `force`), `min_not_met`/`not_ready`
 * (sin `force`: por debajo del mínimo o con alguien sin "Listo").
 */
export const GROUP_START_STATUSES = [
  "started",
  "already_started",
  "empty",
  "min_not_met",
  "not_ready",
] as const;
export type GroupStartStatus = (typeof GROUP_START_STATUSES)[number];

export type GroupStartResult = {
  sessionId: string;
  status: GroupStartStatus;
  connected: number;
  ready: number;
  min: number;
};

/** Ruta interna de "Comenzar todos" (evento con la opción activa). */
export const EVENT_START_ALL_INTERNAL_PATH = "/internal/events";

const GroupStartResultSchema = z.object({
  sessionId: z.string().min(1).max(128),
  status: z.enum(GROUP_START_STATUSES),
  connected: z.number().int().min(0),
  ready: z.number().int().min(0),
  min: z.number().int().min(0),
});
const StartAllGroupsResponse = z.object({ groups: z.array(GroupStartResultSchema) });

export type StartAllGroupsResult = { groups: GroupStartResult[] };

/** Fuente de "Comenzar todos" (Colyseus por HTTP; en memoria en tests). */
export interface StartAllGroupsSource {
  /** `null` si la fuente no responde (Colyseus caído o sin configurar). */
  startAll(eventId: string, opts: { force: boolean }): Promise<StartAllGroupsResult | null>;
}

/**
 * ¿Arrancan TODOS los grupos no vacíos sin `force`? (specs 11/19, ticket
 * "inicio conjunto"): sin `force`, "Comenzar todos" es todo-o-nada — si
 * cualquier grupo con conectados no cumple mínimo+listos, no arranca
 * ninguno. Los grupos vacíos nunca cuentan como bloqueo (su anfitrión podrá
 * empezar él mismo cuando lleguen jugadores).
 */
export function allNonEmptyGroupsReady(groups: readonly SessionLiveProgress[]): boolean {
  return groups
    .filter((group) => group.phase === "lobby" && group.players > 0)
    .every((group) => group.players >= group.minPlayers && group.readyCount >= group.players);
}

/** Cliente HTTP de la ruta interna de "Comenzar todos"; cualquier fallo → `null`. */
export function createColyseusStartAllGroupsSource(options: {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): StartAllGroupsSource {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/u, "");
  return {
    async startAll(eventId, opts) {
      try {
        const res = await doFetch(
          `${base}${EVENT_START_ALL_INTERNAL_PATH}/${encodeURIComponent(eventId)}/start-all`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${eventProgressBearer(options.secret)}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ force: opts.force }),
            signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
          },
        );
        if (!res.ok) return null;
        const parsed = StartAllGroupsResponse.safeParse(await res.json());
        return parsed.success ? { groups: parsed.data.groups } : null;
      } catch {
        return null;
      }
    },
  };
}

// ── Progreso persistido (ticket 5.12) ──────────────────────────────────────

/**
 * Progreso de una sesión reconstruido desde `progressEvent` (Postgres): lo
 * que sobrevive a un reinicio de Colyseus. Misma forma que el vivo salvo lo
 * que solo existe con una room viva (`roomId`, jugadores conectados).
 */
export type SessionStoredProgress = Omit<
  SessionLiveProgress,
  "roomId" | "players" | "minPlayers" | "readyCount"
>;

/** Fuente del progreso persistido de las sesiones de un evento. */
export interface StoredProgressSource {
  /** Una entrada por sesión con hitos persistidos (las demás no aparecen). */
  forEvent(eventId: string): Promise<SessionStoredProgress[]>;
}

/** Fuente en memoria (tests y superficies sin Colyseus). */
export function createInMemoryLiveProgressSource(
  rows: SessionLiveProgress[] = [],
): LiveProgressSource & { rows: SessionLiveProgress[]; down: boolean } {
  const source = {
    rows,
    down: false,
    async forEvent(eventId: string) {
      if (source.down) return null;
      return source.rows.filter((row) => row.eventId === eventId).map((row) => ({ ...row }));
    },
  };
  return source;
}

// ── Ranking del evento (specs/21 §1 y §4) ──────────────────────────────────

/** Lo mínimo que necesita el ranking de cada grupo (una sesión = un grupo en juego). */
export type RankableProgress = {
  started: boolean;
  result: LiveResult | null;
  puzzlesSolved: number;
  hintsUsed: number;
  elapsedMs: number;
  players: number;
};

/**
 * Orden del ranking del evento entre sus grupos (specs/21):
 *
 * 1. Primero los grupos que **escaparon** (`victory`), por tiempo de
 *    finalización ascendente; desempates: menos pistas usadas y, como
 *    penalización suave, menos jugadores.
 * 2. Después el resto de grupos que han empezado (en juego, sin tiempo o
 *    abandonados): más puzzles resueltos, menos pistas y menos tiempo.
 * 3. Los que no han empezado no entran en el ranking.
 *
 * Negativo si `a` va antes que `b`; `0` si empatan.
 */
export function compareRanking(a: RankableProgress, b: RankableProgress): number {
  const tier = (p: RankableProgress) => (p.result === "victory" ? 0 : p.started ? 1 : 2);
  const byTier = tier(a) - tier(b);
  if (byTier !== 0) return byTier;
  if (tier(a) === 0) {
    return a.elapsedMs - b.elapsedMs || a.hintsUsed - b.hintsUsed || a.players - b.players;
  }
  return (
    b.puzzlesSolved - a.puzzlesSolved || a.hintsUsed - b.hintsUsed || a.elapsedMs - b.elapsedMs
  );
}

/**
 * Ordena `rows` según `compareRanking` y asigna la posición (1, 2, 2, 4…:
 * los empates comparten puesto). Los que no han empezado quedan al final con
 * `rank: null`. No muta la entrada; el orden de entrada desempata la vista.
 */
export function rankEventGroups<T extends RankableProgress>(
  rows: readonly T[],
): Array<T & { rank: number | null }> {
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareRanking(x.row, y.row) || x.index - y.index);
  const ranked: Array<T & { rank: number | null }> = [];
  sorted.forEach(({ row }, position) => {
    if (!row.started) {
      ranked.push({ ...row, rank: null });
      return;
    }
    const previous = ranked[position - 1];
    const tied = previous && previous.rank !== null && compareRanking(previous, row) === 0;
    ranked.push({ ...row, rank: tied ? previous.rank : position + 1 });
  });
  return ranked;
}
