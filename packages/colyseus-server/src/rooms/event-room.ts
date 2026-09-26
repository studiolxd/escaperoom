import { ServerError, type Client } from "@colyseus/core";
import { logger } from "@escaperoom/kit/logger";
import type { GroupStartResult, SessionLiveProgress } from "@escaperoom/shared/event-progress";
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
import type { MediaRole } from "../media/index.js";
import { GAME_ACCESS_ERRORS, GameRoom, type GameMilestone, type GameRoomOptions } from "./game-room.js";

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
  /** `events.config.allowVideo` (C-3, specs/12 §4): techo de vídeo del token LiveKit. */
  private eventAllowVideo = false;
  /**
   * `event.config.timeLimitMinutes` (ticket duración-salas): override del
   * organizador por encima de la duración de la sala. `undefined` = sin
   * override (usa la de la sala, como `GameRoom`); `null` = "sin duración".
   */
  private eventTimeLimitOverrideMinutes?: number | null;
  /**
   * `event.config.allGroupsStartTogether` (ticket "inicio conjunto"): se
   * sincroniza en `state.organizerControlsStart` para que el cliente oculte
   * "Empezar" al anfitrión del grupo.
   */
  private organizerControlsStart = false;
  private recorder?: ProgressRecorder;
  /** Claims de cada jugador que ha entrado (grupo y cuenta para los hitos). */
  private readonly playerClaims = new Map<string, JoinClaims>();
  /**
   * C-1: `playerId` (identidad estable del `joinToken`) → `sessionId` del
   * cliente activo con esa identidad. Detecta duplicados —misma persona con
   * varias pestañas, o una pestaña que se cerró y se reabre— sin depender
   * del token nativo de reconexión de Colyseus.
   */
  private readonly activeSeatByPlayerId = new Map<string, string>();
  /**
   * C-15: autorizados en `onAuth` que aún no han terminado `onJoin` — el
   * cliente no cuenta en `this.clients` hasta entonces, así que el cupo por
   * sí solo no basta para cerrar la carrera de varios `onAuth` a la vez.
   */
  private inFlightJoins = 0;

  protected override loadRoomPackage(): RoomPackage {
    return this.eventPackage;
  }

  /**
   * Ticket duración-salas: el override del organizador (si lo hay) pisa la
   * duración propia de la sala, exactamente como `allowVideo` es un techo
   * fijado por el evento. Sin override, cae al comportamiento normal de
   * `GameRoom` (la duración de la sala).
   */
  protected override timeLimitSeconds(): number | undefined {
    const minutes = this.eventTimeLimitOverrideMinutes;
    if (minutes === undefined) return super.timeLimitSeconds();
    return minutes === null ? undefined : minutes * 60;
  }

  /** La `EventRoom` se autoriza con el `joinToken` del canje, no con `gameToken` (C-4). */
  protected override requiresGameAccessToken(): boolean {
    return false;
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
    this.eventAllowVideo = loaded.allowVideo;
    if ("timeLimitOverrideMinutes" in loaded) {
      this.eventTimeLimitOverrideMinutes = loaded.timeLimitOverrideMinutes;
    }
    this.organizerControlsStart = loaded.allGroupsStartTogether && !loaded.anyGroupAlreadyStarted;
    this.recorder = createProgressRecorder(runtime, claims.sessionId);

    await super.onCreate(options);
    this.state.organizerControlsStart = this.organizerControlsStart;
    this.playerCapacity = this.maxClients;
    this.maxClients = this.playerCapacity + MAX_EVENT_SPECTATORS;
    const metadata: EventRoomMetadata = { sessionId: this.eventSessionId, eventId: this.eventId };
    // C-15: la ruta interna `/internal/events/:id/progress` filtra por esta
    // metadata; si `setMetadata` fallara en silencio, la room quedaría
    // invisible para el panel del organizador sin ningún aviso.
    await this.setMetadata(metadata).catch((err: unknown) => {
      logger.warn(
        { err, roomId: this.roomId, sessionId: this.eventSessionId },
        "event-room: fallo al fijar la metadata de la room",
      );
    });
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

  /** C-13: identidad estable del `joinToken` — el `playerId` de evento, no el `seatKey`. */
  protected override identityFor(sessionId: string): string | undefined {
    return this.playerClaims.get(sessionId)?.playerId;
  }

  protected override onMilestone(milestone: GameMilestone): void {
    this.recordAnalytics(milestone);
    const recorder = this.recorder;
    if (!recorder) return;
    switch (milestone.kind) {
      // C-13: sin tabla de persistencia propia todavía (fuera de alcance de
      // esta entrega); ya queda en la analítica estructurada de arriba.
      case "player_left":
        return;
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
    try {
      return this.authorizeEventJoin(_client, options);
    } catch (err) {
      if (err instanceof ServerError) {
        this.roomLogger.warn({ code: err.code, message: err.message }, "event-room: token de acceso rechazado");
      }
      throw err;
    }
  }

  private authorizeEventJoin(_client: Client, options: EventRoomOptions): EventClientAuth {
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
    // C-13: expulsado de esta partida — ni con el enlace de invitación ni con
    // otra clave de acceso del MISMO `playerId` (identidad estable del
    // evento). El organizador puede darle otra clave a otra persona, pero no
    // a esta identidad para esta sesión.
    if (this.kickedIdentities.has(claims.playerId)) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.kicked);
    }
    // C-1: si ya hay una plaza para este `playerId` (misma persona, otra
    // pestaña abierta o una reconexión que llega sin el token nativo de
    // Colyseus), esto no es un jugador nuevo que compita por cupo — `onJoin`
    // la heredará (`adoptSeat`) en vez de sumar una plaza más.
    const hasSeat = this.activeSeatByPlayerId.has(claims.playerId);
    // C-15: el cupo se evaluaba en `onAuth`, pero el cliente no entra en
    // `this.clients` hasta `onJoin` — varias autorizaciones concurrentes
    // podían pasar todas el `<` antes de que ninguna contara. `inFlightJoins`
    // reserva el cupo desde el momento en que se autoriza.
    const occupied = this.clients.length - this.spectators.size + this.inFlightJoins;
    if (!hasSeat && occupied >= this.playerCapacity) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.sessionFull);
    }
    if (!hasSeat) this.inFlightJoins += 1;
    return { role: "player", claims };
  }

  override onJoin(client: Client): void {
    const auth = client.auth as EventClientAuth;
    if (auth.role === "spectator") {
      this.spectators.add(client.sessionId);
      return;
    }
    const claims = auth.claims;
    this.inFlightJoins = Math.max(0, this.inFlightJoins - 1);
    this.playerClaims.set(client.sessionId, claims);
    const previousSessionId = this.activeSeatByPlayerId.get(claims.playerId);
    this.activeSeatByPlayerId.set(claims.playerId, client.sessionId);
    if (previousSessionId !== undefined && previousSessionId !== client.sessionId) {
      this.playerClaims.delete(previousSessionId);
      this.adoptSeat(previousSessionId, client, claims.displayName);
      return;
    }
    super.onJoin(client, { name: claims.displayName });
  }

  override onDrop(client: Client, code?: number): void {
    // Los observadores no reservan plaza ni admiten reconexión (specs/19 §2).
    if (this.spectators.has(client.sessionId)) return;
    super.onDrop(client, code);
  }

  override onLeave(client: Client, code?: number): void {
    if (this.spectators.delete(client.sessionId)) return;
    this.inFlightJoins = Math.max(0, this.inFlightJoins - 1);
    const claims = this.playerClaims.get(client.sessionId);
    super.onLeave(client, code);
    if (claims && this.activeSeatByPlayerId.get(claims.playerId) === client.sessionId) {
      this.activeSeatByPlayerId.delete(claims.playerId);
    }
    this.playerClaims.delete(client.sessionId);
  }

  protected override canAct(client: Client): boolean {
    return !this.spectators.has(client.sessionId);
  }

  /** Observador o jugador (C-3): decide el rol del token LiveKit, nunca el payload del cliente. */
  protected override mediaRoleFor(client: Client): MediaRole {
    return this.spectators.has(client.sessionId) ? "observer" : "player";
  }

  /** Un observador no tiene fila en `players`: nombre genérico (C-3). */
  protected override mediaNameFor(client: Client): string | undefined {
    return this.spectators.has(client.sessionId) ? "Organizador" : super.mediaNameFor(client);
  }

  /** `events.config.allowVideo` (C-3, specs/12 §4): default `false`, decide el organizador. */
  protected override mediaAllowVideoPolicy(): boolean {
    return this.eventAllowVideo;
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

  /**
   * Inicio conjunto del organizador (ticket "inicio conjunto", specs/11 §4.1
   * y §4.5, specs/19 §2): lo llama la ruta interna
   * `POST /internal/events/:eventId/start-all` vía `matchMaker.remoteRoomCall`
   * — nunca un jugador ni el anfitrión del grupo. Reutiliza `readiness()` y
   * `startCore()` de `GameRoom` (mismo motor que `handleStart`), pero con
   * reglas propias: un grupo **vacío** nunca arranca (ni con `force`, para no
   * dejar sin anfitrión a quien llegue después); con `force` ("Comenzar
   * igualmente" del panel) SÍ se salta el mínimo de la sala — a diferencia del
   * "Empezar igualmente" de un anfitrión, que nunca baja del mínimo — porque
   * aquí es una decisión explícita del organizador sobre TODOS los grupos a
   * la vez, no la de un anfitrión sobre el suyo.
   */
  organizerStartGroup(opts: { force: boolean }): GroupStartResult {
    const { connected, ready, min } = this.readiness();
    const base = { sessionId: this.eventSessionId, connected, ready, min };
    if (this.state.phase !== "lobby" || !this.session) {
      return { ...base, status: "already_started" };
    }
    if (connected === 0) return { ...base, status: "empty" };
    if (!opts.force) {
      if (connected < min) return { ...base, status: "min_not_met" };
      if (ready < connected) return { ...base, status: "not_ready" };
    }
    this.startCore();
    return { ...base, status: "started" };
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
