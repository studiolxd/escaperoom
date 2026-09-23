import { ServerError, type Client } from "@colyseus/core";
import type { SessionLiveProgress } from "@escaperoom/shared/event-progress";
import {
  accountUserId,
  createProgressRecorder,
  type ProgressRecorder,
} from "@escaperoom/shared/event-runtime";
import {
  readJoinTokenConfig,
  verifyJoinToken,
  verifySpectatorToken,
  type JoinClaims,
  type JoinTokenError,
  type SpectatorClaims,
} from "@escaperoom/shared/join-token";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { MAX_EVENT_SPECTATORS } from "../constants.js";
import { getEventRuntime } from "../events/runtime.js";
import { GameRoom, type GameMilestone, type GameRoomOptions } from "./game-room.js";

/**
 * Opciones de la room de evento: la sesión del evento (para el `filterBy` del
 * matchmaking) y el `joinToken` que devolvió `POST /api/access-keys/redeem`.
 */
export interface EventRoomOptions extends GameRoomOptions {
  sessionId?: string;
  joinToken?: string;
  /** Token de observador del panel del organizador (ticket 5.9); excluye `joinToken`. */
  spectatorToken?: string;
}

/** Metadata de la room en el listado de Colyseus (matchmaking y panel). */
export interface EventRoomMetadata {
  sessionId: string;
  eventId: string;
}

/** Quién es cada cliente: un jugador (con su `joinToken`) o un observador. */
export type EventClientAuth =
  { role: "player"; claims: JoinClaims } | { role: "spectator"; claims: SpectatorClaims };

/** Rechazo de join sin `joinToken` válido (código HTTP-like, como `ServerError`). */
export const EVENT_JOIN_FORBIDDEN_CODE = 403;

/** Motivos de rechazo que ve el cliente (specs/11 §7: nunca un stack trace). */
export const JOIN_TOKEN_ERRORS = {
  missing: "JOIN_TOKEN_REQUIRED",
  invalid: "JOIN_TOKEN_INVALID",
  expired: "JOIN_TOKEN_EXPIRED",
  wrongSession: "JOIN_TOKEN_WRONG_SESSION",
  sessionFull: "SESSION_FULL",
  spectatorInvalid: "SPECTATOR_TOKEN_INVALID",
  /** El evento no existe, no está activo o no hay de dónde leer su paquete. */
  eventUnavailable: "EVENT_UNAVAILABLE",
} as const;

/**
 * `EventRoom` (ticket 5.8, specs/11 §1 y §8): la `GameRoom` de una sesión de
 * evento. Mismo protocolo y motor; lo que cambia es **quién entra**: solo quien
 * presenta un `joinToken` firmado, vigente y emitido para **esta** sesión. El
 * asiento ya se consumió al canjear (web, con Postgres), así que aquí basta con
 * verificar la firma: la room no toca la base de datos.
 *
 * - Una room por `gameSession` (matchmaking por `sessionId`); crearla también
 *   exige token, así nadie levanta la room de una sesión ajena.
 * - El nombre visible sale del token (lo fijó el canje), no de las opciones.
 * - Paquete (ticket 5.12): al crearse, la room pide al runtime de eventos el
 *   `roomVersion.package` congelado del evento del token y juega esa versión
 *   exacta. El cliente no puede elegir ni enviar paquete; `packageId` se
 *   ignora.
 * - Progreso (ticket 5.12): cada hito de la partida se encola en un
 *   `ProgressRecorder` que lo escribe en `progressEvent` sin bloquear el
 *   bucle; al terminar, el hito `game_ended` cierra la sesión y los grupos que
 *   jugaron (`group.completedAt`). La room espera a vaciar la cola al
 *   destruirse.
 *
 * **Modo observador** (ticket 5.9, specs/19 §2): el organizador entra con un
 * `spectatorToken` (firmado por web tras comprobar que es el organizador, otra
 * audiencia y otra clave que el `joinToken`). Un observador recibe el room
 * state —la misma proyección pública que un jugador— y los mensajes
 * difundidos, pero **no es un jugador**: no aparece en `players`, no ocupa
 * plaza de juego, no puede crear la room y cualquier intención suya (mover,
 * interactuar, intentar, pedir pistas, chatear, pedir token de medios) se
 * rechaza con `PERMISSION_DENIED` antes de llegar al motor. Como las
 * respuestas que llevan datos de un puzzle (`puzzle_view`, `attempt_result`,
 * `split_fragments`, `hint_delivered`) solo se envían a quien las pidió, nunca
 * le llega nada que resuelva un puzzle.
 *
 * Además publica el progreso de la partida (`progressSnapshot`, proyección sin
 * soluciones) para el panel del organizador.
 */
export class EventRoom extends GameRoom {
  private eventSessionId = "";
  private eventId = "";
  /** Plazas de juego (las del paquete); las de observador van aparte. */
  private playerCapacity = 0;
  private readonly spectators = new Set<string>();
  private eventPackage!: RoomPackage;
  private roomVersionId = "";
  private recorder?: ProgressRecorder;
  /** Claims de cada jugador que ha entrado (grupo y cuenta para los hitos). */
  private readonly playerClaims = new Map<string, JoinClaims>();

  protected override loadRoomPackage(): RoomPackage {
    return this.eventPackage;
  }

  override async onCreate(options: EventRoomOptions = {}): Promise<void> {
    const claims = authorize(options);
    const runtime = getEventRuntime();
    // Un fallo de base de datos tampoco llega al cliente como stack trace (specs/11 §7).
    const loaded = runtime
      ? await runtime.loadEventPackage(claims.eventId).catch(() => null)
      : null;
    if (!runtime || !loaded) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.eventUnavailable);
    }
    this.eventSessionId = claims.sessionId;
    this.eventId = claims.eventId;
    this.eventPackage = loaded.roomPackage;
    this.roomVersionId = loaded.roomVersionId;
    this.recorder = createProgressRecorder(runtime, claims.sessionId);

    super.onCreate(options);
    this.playerCapacity = this.maxClients;
    this.maxClients = this.playerCapacity + MAX_EVENT_SPECTATORS;
    const metadata: EventRoomMetadata = { sessionId: this.eventSessionId, eventId: this.eventId };
    void this.setMetadata(metadata);
  }

  /** Vacía la cola de hitos antes de destruir la room (también al apagar el servidor). */
  async onDispose(): Promise<void> {
    await this.recorder?.flush();
  }

  /** Versión publicada que juega la room. */
  get playingRoomVersionId(): string {
    return this.roomVersionId;
  }

  /** Espera a que se persistan los hitos encolados (tests y apagado). */
  flushProgress(): Promise<void> {
    return this.recorder?.flush() ?? Promise.resolve();
  }

  protected override onMilestone(milestone: GameMilestone): void {
    const recorder = this.recorder;
    if (!recorder) return;
    switch (milestone.kind) {
      case "game_started":
        recorder.record({ kind: "game_started", at: milestone.at, roomId: this.roomId });
        return;
      case "game_ended": {
        const groupIds = new Set<string>();
        for (const claims of this.playerClaims.values()) {
          if (claims.groupId) groupIds.add(claims.groupId);
        }
        recorder.record({ ...milestone, groupIds: [...groupIds] });
        return;
      }
      default: {
        const { actorId, ...rest } = milestone;
        const claims = actorId ? this.playerClaims.get(actorId) : undefined;
        recorder.record({
          ...rest,
          groupId: claims?.groupId ?? null,
          userId: claims ? accountUserId(claims.playerId) : null,
        });
      }
    }
  }

  override onAuth(_client: Client, options: EventRoomOptions = {}): EventClientAuth {
    if (options.spectatorToken !== undefined) {
      const claims = authorizeSpectator(options);
      if (claims.sessionId !== this.eventSessionId || claims.eventId !== this.eventId) {
        throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
      }
      if (this.spectators.size >= MAX_EVENT_SPECTATORS) {
        throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.sessionFull);
      }
      return { role: "spectator", claims };
    }
    const claims = authorize(options);
    if (claims.sessionId !== this.eventSessionId) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
    }
    if (this.clients.length - this.spectators.size >= this.playerCapacity) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.sessionFull);
    }
    return { role: "player", claims };
  }

  override onJoin(client: Client): void {
    const auth = client.auth as EventClientAuth;
    if (auth.role === "spectator") {
      this.spectators.add(client.sessionId);
      return;
    }
    this.playerClaims.set(client.sessionId, auth.claims);
    super.onJoin(client, { name: auth.claims.displayName });
  }

  override onLeave(client: Client): void {
    if (this.spectators.delete(client.sessionId)) return;
    super.onLeave(client);
  }

  protected override canAct(client: Client): boolean {
    return !this.spectators.has(client.sessionId);
  }

  /** Observadores conectados (el panel no los cuenta como jugadores). */
  get spectatorCount(): number {
    return this.spectators.size;
  }

  /**
   * Progreso público de la sesión para el panel del organizador (ticket 5.9).
   * Lo pide la ruta interna `GET /internal/events/:eventId/progress` con
   * `matchMaker.remoteRoomCall`.
   */
  progressSnapshot(): SessionLiveProgress {
    return {
      sessionId: this.eventSessionId,
      eventId: this.eventId,
      roomId: this.roomId,
      ...this.progressCounters(),
      updatedAt: Date.now(),
    };
  }
}

const MESSAGE_BY_ERROR: Record<JoinTokenError, string> = {
  MALFORMED: JOIN_TOKEN_ERRORS.invalid,
  BAD_SIGNATURE: JOIN_TOKEN_ERRORS.invalid,
  EXPIRED: JOIN_TOKEN_ERRORS.expired,
};

/** Token de observador bien firmado, vigente y de la sesión pedida; si no, `ServerError` 403. */
function authorizeSpectator(options: EventRoomOptions): SpectatorClaims {
  const config = readJoinTokenConfig();
  if (!config || options.joinToken !== undefined) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.spectatorInvalid);
  }
  const verified = verifySpectatorToken(config.secret, options.spectatorToken);
  if (!verified.ok) {
    throw new ServerError(
      EVENT_JOIN_FORBIDDEN_CODE,
      verified.error === "EXPIRED" ? JOIN_TOKEN_ERRORS.expired : JOIN_TOKEN_ERRORS.spectatorInvalid,
    );
  }
  if (verified.claims.sessionId !== options.sessionId) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
  }
  return verified.claims;
}

/** Token presente, bien firmado, vigente y de la sesión pedida; si no, `ServerError` 403. */
function authorize(options: EventRoomOptions): JoinClaims {
  const config = readJoinTokenConfig();
  if (!config || options.joinToken === undefined) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.missing);
  }
  const verified = verifyJoinToken(config.secret, options.joinToken);
  if (!verified.ok) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, MESSAGE_BY_ERROR[verified.error]);
  }
  if (verified.claims.sessionId !== options.sessionId) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
  }
  return verified.claims;
}
