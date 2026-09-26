import { LOCALES, type Locale } from "@escaperoom/config/locales";
import { resolveMailLocale } from "../mail/templates";
import type { AccessKeyStore, SessionSeats } from "./access-keys";
import { type Actor } from "./actor";
import { UUID_RE, requireUser } from "./common";
import type { EventRow, EventStatus } from "./events";
import type { InvitationStats, InvitationStore } from "./invitations";
import {
  rankEventGroups,
  type LiveProgressSource,
  type LiveResult,
  type SessionLiveProgress,
  type SessionStoredProgress,
  type StoredProgressSource,
} from "./event-progress";
import {
  SPECTATOR_TOKEN_TTL_SECONDS,
  signSpectatorToken,
  type JoinTokenConfig,
} from "./join-token";

/**
 * Panel del organizador (ticket 5.9, specs/19 §2, specs/21 §4): dashboard del
 * evento (estado, claves generadas/enviadas/confirmadas/canjeadas, sesiones),
 * progreso en vivo por grupo, ranking del evento, export CSV y el token de
 * **observador** para entrar en la room de una sesión sin jugar.
 *
 * El panel no calcula nada que no exista ya: los contadores de claves salen de
 * 5.5/5.6 y el progreso, de la proyección pública que publica cada `EventRoom`
 * (`SessionLiveProgress`) y, desde 5.12, de los hitos que la room persiste en
 * `progressEvent` (`SessionStoredProgress`): lo vivo manda y lo persistido
 * cubre las sesiones sin room (terminadas o tras un reinicio de Colyseus).
 * Solo el organizador del evento accede.
 */

// ── Puertos ────────────────────────────────────────────────────────────────

/** Recuento de claves de un evento (Postgres: `groupBy` por estado + `redeemedCount > 0`). */
export type KeyCountsRow = { byStatus: Record<string, number>; redeemed: number };

export type EventPanelDeps = {
  keys: Pick<AccessKeyStore, "findEvent" | "listSessionSeats">;
  invitations: Pick<InvitationStore, "invitationStats">;
  /** Claves del evento por estado y cuántas se han canjeado al menos una vez. */
  keyCounts: (eventId: string) => Promise<KeyCountsRow>;
  live: LiveProgressSource;
  /** Progreso persistido (`progressEvent`, 5.12); sin él, solo lo vivo. */
  stored?: StoredProgressSource;
  /** Secreto de los tokens de evento; `null` desactiva el modo observador. */
  spectator: JoinTokenConfig | null;
  /** Endpoint WebSocket de Colyseus que se devuelve al observador. */
  colyseusEndpoint: string;
  roomName: string;
  now?: () => Date;
};

// ── Errores ────────────────────────────────────────────────────────────────

export { EVENT_PANEL_ERROR_CODES, type EventPanelErrorCode } from "./error-codes";
import type { EventPanelErrorCode } from "./error-codes";

export class EventPanelError extends Error {
  readonly code: EventPanelErrorCode;
  constructor(code: EventPanelErrorCode, message: string) {
    super(message);
    this.name = "EventPanelError";
    this.code = code;
  }
}

// ── Vistas ─────────────────────────────────────────────────────────────────

/**
 * Estado de una sesión en el panel. `offline`: el registro la da por empezada
 * pero no hay room viva (p. ej. Colyseus se reinició).
 */
export const PANEL_SESSION_STATES = [
  "not_started",
  "lobby",
  "playing",
  "ended",
  "offline",
] as const;
export type PanelSessionState = (typeof PANEL_SESSION_STATES)[number];

/** Una fila por sesión (= grupo en juego): la del listado y la del ranking. */
export type EventSessionRow = {
  sessionId: string;
  name: string;
  capacity: number;
  /** Plazas canjeadas. */
  occupied: number;
  state: PanelSessionState;
  result: LiveResult | null;
  puzzlesSolved: number;
  puzzlesTotal: number;
  hintsUsed: number;
  /** Jugadores conectados ahora. */
  players: number;
  elapsedMs: number;
  startedAt: string | null;
  endedAt: string | null;
  /** Posición en el ranking del evento; `null` si aún no ha empezado. */
  rank: number | null;
  /** Se puede observar (hay room viva y la partida no ha terminado). */
  observable: boolean;
};

export type EventKeyCounts = {
  generated: number;
  /** Invitaciones con email ya entregadas (`sentAt`). */
  sent: number;
  confirmed: number;
  /** Claves con al menos un canje (`redeemedCount > 0`). */
  redeemed: number;
  /** Invitaciones aún sin confirmar (las que reenvía el recordatorio). */
  pendingConfirmation: number;
  byStatus: Record<string, number>;
};

export type EventDashboard = {
  event: {
    id: string;
    title: string;
    status: EventStatus;
    roomId: string;
    roomVersionId: string;
    requireConfirmation: boolean;
    playersPlanned: number;
  };
  keys: EventKeyCounts;
  invitations: InvitationStats;
  sessions: { total: number; active: number; ended: number; notStarted: number };
  metrics: {
    /** Tiempo medio de los grupos que escaparon. */
    averageEscapeMs: number | null;
    /** Pistas medias por grupo que ha empezado. */
    averageHints: number | null;
  };
  /** Sesiones en el orden del ranking (las no empezadas, al final). */
  rows: EventSessionRow[];
  /** `false` si Colyseus no respondió: el panel muestra solo lo persistido. */
  liveAvailable: boolean;
  generatedAt: string;
};

export type SpectatorTicket = {
  sessionId: string;
  spectatorToken: string;
  expiresAt: string;
  colyseus: { endpoint: string; roomName: string };
};

function liveState(progress: SessionLiveProgress): PanelSessionState {
  if (progress.phase === "lobby") return "lobby";
  if (progress.phase === "ended") return "ended";
  return "playing";
}

function storedState(status: SessionSeats["status"]): PanelSessionState {
  if (status === "pending") return "not_started";
  if (status === "in_progress") return "offline";
  return "ended";
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Estado de una sesión sin room viva según sus hitos persistidos: terminada si
 * llegó al final; si no, la partida se quedó a medias (`offline`).
 */
function persistedState(progress: SessionStoredProgress): PanelSessionState {
  return progress.phase === "ended" ? "ended" : "offline";
}

/**
 * Cruza las sesiones con el progreso en vivo y el persistido y las ordena por
 * ranking. Por sesión manda la room viva; sin ella, lo persistido; sin nada,
 * el estado de `gameSession`.
 */
export function buildSessionRows(
  sessions: readonly SessionSeats[],
  live: readonly SessionLiveProgress[],
  stored: readonly SessionStoredProgress[] = [],
): EventSessionRow[] {
  const liveBySession = new Map(live.map((progress) => [progress.sessionId, progress]));
  const storedBySession = new Map(stored.map((progress) => [progress.sessionId, progress]));
  const rows = sessions.map((session) => {
    const room = liveBySession.get(session.id);
    const saved = storedBySession.get(session.id);
    // Una room recién recreada (tras un reinicio) en la sala de espera no borra
    // la partida que ya consta: hasta que empiece, se muestra lo persistido.
    const liveProgress = room && !(room.phase === "lobby" && saved) ? room : undefined;
    const persisted = liveProgress ? undefined : saved;
    const progress: SessionStoredProgress | undefined =
      liveProgress ?? persisted;
    const state = liveProgress
      ? liveState(liveProgress)
      : persisted
        ? persistedState(persisted)
        : storedState(session.status);
    return {
      sessionId: session.id,
      name: session.name,
      capacity: session.capacity,
      occupied: session.occupied,
      state,
      result: progress?.result ?? null,
      puzzlesSolved: progress?.puzzlesSolved ?? 0,
      puzzlesTotal: progress?.puzzlesTotal ?? 0,
      hintsUsed: progress?.hintsUsed ?? 0,
      players: room?.players ?? 0,
      elapsedMs: progress?.elapsedMs ?? 0,
      startedAt: iso(progress?.startedAt ?? null),
      endedAt: iso(progress?.endedAt ?? null),
      started: progress ? progress.startedAt !== null : state !== "not_started",
      observable: room !== undefined && room.phase !== "ended",
    };
  });
  return rankEventGroups(rows).map((row): EventSessionRow => {
    const { started, ...visible } = row;
    void started;
    return visible;
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

// ── Export CSV ─────────────────────────────────────────────────────────────

type CsvCopy = {
  headers: [string, string, string, string, string, string, string, string, string, string];
  states: Record<PanelSessionState, string>;
  results: Record<LiveResult, string>;
};

/** Textos del CSV en los 6 locales (la paridad con `LOCALES` la comprueba un test). */
export const EVENT_CSV_COPY: Record<Locale, CsvCopy> = {
  es: {
    headers: [
      "Puesto",
      "Grupo",
      "Estado",
      "Resultado",
      "Puzzles resueltos",
      "Puzzles totales",
      "Pistas usadas",
      "Tiempo",
      "Jugadores conectados",
      "Plazas canjeadas",
    ],
    states: {
      not_started: "Sin empezar",
      lobby: "En la sala de espera",
      playing: "Jugando",
      ended: "Terminada",
      offline: "Sin conexión",
    },
    results: { victory: "Escapó", timeout: "Sin tiempo", aborted: "Abandonada" },
  },
  en: {
    headers: [
      "Rank",
      "Group",
      "Status",
      "Result",
      "Puzzles solved",
      "Total puzzles",
      "Hints used",
      "Time",
      "Players online",
      "Seats redeemed",
    ],
    states: {
      not_started: "Not started",
      lobby: "In the lobby",
      playing: "Playing",
      ended: "Finished",
      offline: "Offline",
    },
    results: { victory: "Escaped", timeout: "Out of time", aborted: "Abandoned" },
  },
  fr: {
    headers: [
      "Rang",
      "Groupe",
      "État",
      "Résultat",
      "Énigmes résolues",
      "Énigmes au total",
      "Indices utilisés",
      "Temps",
      "Joueurs connectés",
      "Places utilisées",
    ],
    states: {
      not_started: "Pas commencée",
      lobby: "En salle d’attente",
      playing: "En cours",
      ended: "Terminée",
      offline: "Hors ligne",
    },
    results: { victory: "Évadé", timeout: "Temps écoulé", aborted: "Abandonnée" },
  },
  de: {
    headers: [
      "Platz",
      "Gruppe",
      "Status",
      "Ergebnis",
      "Gelöste Rätsel",
      "Rätsel gesamt",
      "Genutzte Hinweise",
      "Zeit",
      "Spieler online",
      "Eingelöste Plätze",
    ],
    states: {
      not_started: "Nicht begonnen",
      lobby: "Im Warteraum",
      playing: "Läuft",
      ended: "Beendet",
      offline: "Offline",
    },
    results: { victory: "Entkommen", timeout: "Zeit abgelaufen", aborted: "Abgebrochen" },
  },
  nl: {
    headers: [
      "Plaats",
      "Groep",
      "Status",
      "Resultaat",
      "Opgeloste puzzels",
      "Totaal puzzels",
      "Gebruikte hints",
      "Tijd",
      "Spelers online",
      "Ingewisselde plaatsen",
    ],
    states: {
      not_started: "Niet gestart",
      lobby: "In de wachtruimte",
      playing: "Bezig",
      ended: "Afgelopen",
      offline: "Offline",
    },
    results: { victory: "Ontsnapt", timeout: "Tijd op", aborted: "Afgebroken" },
  },
  pt: {
    headers: [
      "Posição",
      "Grupo",
      "Estado",
      "Resultado",
      "Puzzles resolvidos",
      "Total de puzzles",
      "Pistas usadas",
      "Tempo",
      "Jogadores ligados",
      "Lugares resgatados",
    ],
    states: {
      not_started: "Não iniciada",
      lobby: "Na sala de espera",
      playing: "A jogar",
      ended: "Terminada",
      offline: "Sem ligação",
    },
    results: { victory: "Escapou", timeout: "Sem tempo", aborted: "Abandonada" },
  },
};

/** `H:MM:SS` de una duración en ms. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Celda CSV (RFC 4180): entre comillas si hace falta y con un apóstrofo
 * delante si empieza como una fórmula (`=`, `+`, `-`, `@`), para que la hoja
 * de cálculo no ejecute nada que venga de un nombre de grupo.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n;]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** CSV del progreso/ranking (UTF-8 con BOM para que Excel respete los acentos). */
export function eventProgressCsv(rows: readonly EventSessionRow[], locale: Locale): string {
  const copy = EVENT_CSV_COPY[locale];
  const lines = [
    copy.headers.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.rank ?? "",
        row.name,
        copy.states[row.state],
        row.result ? copy.results[row.result] : "",
        row.puzzlesSolved,
        row.puzzlesTotal,
        row.hintsUsed,
        formatElapsed(row.elapsedMs),
        row.players,
        `${row.occupied}/${row.capacity}`,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Idioma del CSV: el pedido, el del evento o `es`. */
export function eventCsvLocale(requested: unknown, event: Pick<EventRow, "config">): Locale {
  if (typeof requested === "string" && (LOCALES as readonly string[]).includes(requested)) {
    return requested as Locale;
  }
  return resolveMailLocale(event.config.locale);
}

// ── Servicio ───────────────────────────────────────────────────────────────

export function createEventPanelService(deps: EventPanelDeps) {
  const now = deps.now ?? (() => new Date());

  /** Solo el organizador del evento (specs/19 §2): ni otros usuarios ni anónimos. */
  async function findOwnEvent(actor: Actor, eventId: string): Promise<EventRow> {
    requireUser(actor, EventPanelError);
    const event = UUID_RE.test(eventId) ? await deps.keys.findEvent(eventId) : null;
    if (!event) throw new EventPanelError("NOT_FOUND", "Evento no encontrado");
    if (event.organizerId !== actor.userId) {
      throw new EventPanelError("FORBIDDEN", "Solo el organizador puede ver el panel del evento");
    }
    return event;
  }

  async function dashboardFor(event: EventRow): Promise<EventDashboard> {
    const [sessions, live, stored, counts, invitations] = await Promise.all([
      deps.keys.listSessionSeats(event.id),
      deps.live.forEvent(event.id),
      deps.stored?.forEvent(event.id) ?? [],
      deps.keyCounts(event.id),
      deps.invitations.invitationStats(event.id),
    ]);
    const rows = buildSessionRows(sessions, live ?? [], stored);
    const byStatus = counts.byStatus;
    const escaped = rows.filter((row) => row.result === "victory").map((row) => row.elapsedMs);
    const started = rows.filter((row) => row.rank !== null).map((row) => row.hintsUsed);
    return {
      event: {
        id: event.id,
        title: event.title,
        status: event.status,
        roomId: event.roomId,
        roomVersionId: event.roomVersionId,
        requireConfirmation: event.requireConfirmation,
        playersPlanned: event.playersPurchased,
      },
      keys: {
        generated: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        sent: invitations.sent,
        confirmed: invitations.confirmed,
        redeemed: counts.redeemed,
        pendingConfirmation: invitations.pending,
        byStatus: { ...byStatus },
      },
      invitations,
      sessions: {
        total: rows.length,
        active: rows.filter((row) => row.state === "lobby" || row.state === "playing").length,
        ended: rows.filter((row) => row.state === "ended").length,
        notStarted: rows.filter((row) => row.state === "not_started").length,
      },
      metrics: { averageEscapeMs: average(escaped), averageHints: average(started) },
      rows,
      liveAvailable: live !== null,
      generatedAt: now().toISOString(),
    };
  }

  return {
    /** `GET /api/events/:id/dashboard` — panel en vivo (lo sondea la UI). */
    async getDashboard(actor: Actor, eventId: string): Promise<EventDashboard> {
      return dashboardFor(await findOwnEvent(actor, eventId));
    },

    /** `GET /api/events/:id/progress.csv` — ranking/progreso en CSV. */
    async exportProgressCsv(
      actor: Actor,
      eventId: string,
      opts: { locale?: unknown } = {},
    ): Promise<{ filename: string; csv: string; locale: Locale }> {
      const event = await findOwnEvent(actor, eventId);
      const dashboard = await dashboardFor(event);
      const locale = eventCsvLocale(opts.locale, event);
      const day = dashboard.generatedAt.slice(0, 10);
      return {
        filename: `evento-${event.id.slice(0, 8)}-progreso-${day}.csv`,
        csv: eventProgressCsv(dashboard.rows, locale),
        locale,
      };
    },

    /**
     * `POST /api/events/:id/sessions/:sessionId/spectate` — token de observador
     * para la room de una sesión en curso. Observar nunca añade un jugador: la
     * room lo acepta como observador de solo lectura (specs/19 §2).
     */
    async issueSpectatorTicket(
      actor: Actor,
      eventId: string,
      sessionId: string,
    ): Promise<SpectatorTicket> {
      const event = await findOwnEvent(actor, eventId);
      const sessions = await deps.keys.listSessionSeats(event.id);
      if (!sessions.some((session) => session.id === sessionId)) {
        throw new EventPanelError("SESSION_NOT_FOUND", "La sesión no es de este evento");
      }
      if (!deps.spectator) {
        throw new EventPanelError(
          "SPECTATOR_UNAVAILABLE",
          "El modo observador no está configurado",
        );
      }
      const live = await deps.live.forEvent(event.id);
      const progress = live?.find((row) => row.sessionId === sessionId);
      if (!progress || progress.phase === "ended") {
        throw new EventPanelError("SESSION_NOT_LIVE", "La sesión no tiene una partida en curso");
      }
      const issuedAt = now().getTime();
      const expiresAt = issuedAt + SPECTATOR_TOKEN_TTL_SECONDS * 1000;
      return {
        sessionId,
        spectatorToken: signSpectatorToken(
          deps.spectator.secret,
          { organizerId: event.organizerId, eventId: event.id, sessionId },
          { now: issuedAt, expiresAt },
        ),
        expiresAt: new Date(expiresAt).toISOString(),
        colyseus: { endpoint: deps.colyseusEndpoint, roomName: deps.roomName },
      };
    },
  };
}

export type EventPanelService = ReturnType<typeof createEventPanelService>;

/** Recuento en memoria de un conjunto de claves (tests y el store en memoria). */
export function countKeys(
  keys: ReadonlyArray<{ status: string; redeemedCount: number }>,
): KeyCountsRow {
  const byStatus: Record<string, number> = {};
  for (const key of keys) byStatus[key.status] = (byStatus[key.status] ?? 0) + 1;
  return { byStatus, redeemed: keys.filter((key) => key.redeemedCount > 0).length };
}
