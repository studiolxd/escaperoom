import { randomInt } from "node:crypto";
import {
  CloseCode,
  Room,
  ServerError,
  type Client,
  type Deferred,
  type Delayed,
} from "@colyseus/core";
import { z } from "zod";
import * as Sentry from "@sentry/node";
import { logger } from "@escaperoom/kit/logger";
import { sanitizeChatText } from "@escaperoom/shared/chat";
import type { EngineResult } from "@escaperoom/shared/engine";
import { resolveLocalizedText } from "@escaperoom/shared/hints";
import { PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS } from "@escaperoom/shared/game-access";
import {
  readGameAccessTokenConfig,
  verifyGameAccessToken,
  type GameAccessClaims,
  type GameAccessTokenError,
} from "@escaperoom/shared/game-access-token";
import {
  lobbyRoomOf,
  resolveRoomTimeLimitSec,
  withLobbyRoom,
  type PuzzleDefinition,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import { LIVE_PHASES, type LivePhase } from "@escaperoom/shared/event-progress";
import {
  createRoomSession,
  solvedPuzzleIds,
  toSessionResult,
  type RoomPuzzleActionResult,
  type RoomSession,
  type SessionResult,
} from "@escaperoom/shared/session";
import { createSlidingRng, visibleFragmentsByIndex } from "@escaperoom/shared/templates";
import {
  ABANDONED_GAME_TIMEOUT_SEC,
  CHAT_MESSAGE,
  ERROR_MESSAGE,
  GAME_DOOR_REACH,
  GAME_ERRORS,
  GAME_MAX_STEP,
  GAME_MESSAGES,
  GAME_TICK_MS,
  HOST_REASSIGN_GRACE_SEC,
  LOBBY_RECONNECT_GRACE_SEC,
  MAX_PLAYERS,
  RESULTS_ROOM_LIFETIME_SEC,
} from "../constants.js";
import { RoomChat } from "../chat.js";
import { devTestGameTokenAllowed, getGameAccessRuntime } from "../game/access-runtime.js";
import { loadAvatarCharacterIds } from "../game/avatar-pack.js";
import { resolveRoomPackage } from "../game/room-packages.js";
import { isCharacterAvailable, pickPlayerCharacter } from "../characters.js";
import {
  MEDIA_TOKEN_REQUEST_MESSAGE,
  sendMediaTokenToClient,
  type MediaRole,
} from "../media/index.js";
import {
  MESSAGE_RATE_LIMITED_ERROR,
  MessageRateLimiter,
  readGameMessageRateLimits,
  type GameMessageRateLimits,
} from "../message-rate-limit.js";
import { distance, validateMove } from "../movement.js";
import {
  GameInventoryState,
  GamePlayerState,
  GamePuzzleState,
  GameRoomState,
} from "../schema/game-state.js";
import { pickPlayerTint } from "../tints.js";

/** Opciones de creación: el cliente solo elige **qué** paquete (por id), nunca lo envía. */
export interface GameRoomOptions {
  packageId?: string;
  /**
   * Token firmado por web (C-4/B-4): acredita una compra B2C o, fuera de
   * producción, una partida de prueba. Exigido para crear o unirse a una
   * `GameRoom` "desnuda" (no `EventRoom`/`PlaytestRoom`, que tienen su propio
   * `joinToken`/token de playtest).
   */
  gameToken?: string;
}

/** Rechazo de `create`/`join` sin `gameToken` válido (código HTTP-like, como `ServerError`). */
export const GAME_ACCESS_FORBIDDEN_CODE = 403;

/** Motivos de rechazo que ve el cliente (specs/11 §7: nunca un stack trace). */
export const GAME_ACCESS_ERRORS = {
  missing: "GAME_TOKEN_REQUIRED",
  invalid: "GAME_TOKEN_INVALID",
  expired: "GAME_TOKEN_EXPIRED",
  devTestForbidden: "GAME_TOKEN_DEV_TEST_FORBIDDEN",
  /** La compra no existe, no tiene la versión, o Postgres no está configurado. */
  unavailable: "GAME_UNAVAILABLE",
  /** La compra ya está consumida (terminó) o "en curso" en otra room, sin caducar. */
  playSessionUsed: "PLAY_SESSION_ALREADY_USED",
  /** C-13: identidad expulsada de esta partida (`kick`); no puede volver a entrar. */
  kicked: "PLAYER_KICKED",
} as const;

const GAME_ACCESS_ERROR_BY_TOKEN_ERROR: Record<GameAccessTokenError, string> = {
  MALFORMED: GAME_ACCESS_ERRORS.invalid,
  BAD_SIGNATURE: GAME_ACCESS_ERRORS.invalid,
  EXPIRED: GAME_ACCESS_ERRORS.expired,
};

/**
 * C-8: ventana en la que se cuentan los rechazos de un observador. Un
 * observador real, en una sesión larga, puede acumular decenas de intentos
 * rechazados con calma (specs/19 §2: puede pedir pistas por error, intentar
 * un candado…) — eso nunca debe desconectarlo. Lo que hay que cortar es la
 * ráfaga: muchos rechazos EN POCO TIEMPO, que es indistinguible de
 * `client.send` a velocidad de línea.
 */
const OBSERVER_DENIAL_WINDOW_MS = 10_000;
/**
 * C-8: tantos rechazos dentro de la ventana cortan la conexión. Por debajo
 * del cubo `total` del rate limiter (30/s, `message-rate-limit.ts`): una
 * ráfaga real lo alcanza en menos de un segundo, mientras que un observador
 * que prueba unas pocas acciones a lo largo de la partida (la ventana se
 * reinicia si pasan más de `OBSERVER_DENIAL_WINDOW_MS` entre rechazos) no se
 * acerca ni de lejos.
 */
const OBSERVER_DENIAL_KICK_LIMIT = 25;
/** Código de cierre del WebSocket al expulsar a un observador que inunda mensajes. */
const OBSERVER_KICK_CLOSE_CODE = 4403;

/** Opciones de join. */
export interface GameJoinOptions {
  name?: string;
  /** Personaje elegido en el lobby (A1); si falta o está ocupado, el servidor asigna uno. */
  characterId?: string;
  /**
   * Identidad de plaza estable por navegador (C-2, ajuste 2026-09-25): la
   * `GameRoom` desnuda no tiene un `playerId` como `EventRoom` (el del
   * `joinToken`) — varias personas legítimamente comparten el mismo
   * `gameToken` de compra —, así que la reconexión por recarga o por cerrar y
   * reabrir la pestaña, cuando el token de reconexión nativo de Colyseus se
   * pierde o caduca, se resuelve con este id aleatorio que guarda el propio
   * navegador (`localStorage`, nunca ligado a una cuenta). Mismo mecanismo
   * que `EventRoom.activeSeatByPlayerId`/`adoptSeat`, con `seatKey` como
   * identidad en vez de `playerId`.
   */
  seatKey?: string;
}

/** Tiempo y pistas de la partida en el instante de un hito. */
export interface GameMilestoneClock {
  /** Epoch ms del hito (reloj lógico de la sala: `createdAt` + ms de juego). */
  at: number;
  /** Tiempo jugado desde el inicio. */
  elapsedMs: number;
  /** Coste acumulado de las pistas (`GameState.hintsUsed`). */
  hintsUsed: number;
}

/**
 * Hito de la partida (ticket 5.12): lo que la `EventRoom` persiste en
 * `progressEvent`. `actorId` es el `sessionId` de Colyseus de quien lo provocó
 * (si se sabe). Nunca lleva datos que resuelvan un puzzle.
 */
export type GameMilestone =
  | { kind: "game_started"; at: number }
  | ({
      kind: "solved" | "hint_used";
      puzzleId: string;
      actorId: string | null;
    } & GameMilestoneClock)
  | ({ kind: "door_opened"; objectId: string; actorId: string | null } & GameMilestoneClock)
  | ({ kind: "game_ended"; result: SessionResult } & GameMilestoneClock)
  | ({
      kind: "player_left";
      playerId: string;
      reason: "left" | "kicked";
      actorId: string | null;
    } & GameMilestoneClock);

const movePayload = z.object({
  x: z.number(),
  y: z.number(),
  roomId: z.string().min(1).max(64).optional(),
});
const objectPayload = z.object({ objectId: z.string().min(1).max(64) });
const useItemPayload = z.object({
  itemId: z.string().min(1).max(64),
  objectId: z.string().min(1).max(64),
});
const combinePayload = z.object({
  puzzleId: z.string().min(1).max(64).optional(),
  inputs: z.array(z.string().min(1).max(64)).min(1).max(2),
});
const puzzlePayload = z.object({ puzzleId: z.string().min(1).max(64) });
const optionalPuzzlePayload = z.object({ puzzleId: z.string().min(1).max(64).optional() });
const attemptPayload = z.object({ puzzleId: z.string().min(1).max(64), attempt: z.unknown() });
const selectCharacterPayload = z.object({ characterId: z.string().min(1).max(64) });
const emptyPayload = z.object({}).passthrough();
/** `start_game` (C-13): `force` es "Empezar igualmente" (nunca por debajo del mínimo). */
const startGamePayload = z.object({ force: z.boolean().optional() });
const setReadyPayload = z.object({ ready: z.boolean() });
const kickPayload = z.object({ playerId: z.string().min(1).max(64) });
const platePayload = z.object({
  puzzleId: z.string().min(1).max(64).optional(),
  plateId: z.string().min(1).max(64),
  active: z.boolean(),
});

/** Forma de `attempt` por plantilla (specs/11 §5; `sliding`/`pipes` van pieza a pieza). */
const codeAttempt = z.object({ code: z.string().max(32) });
const slidingAttempt = z.object({ move: z.number().int().min(0).max(1024) });
const memoryAttempt = z.object({ flip: z.string().min(1).max(64) });
const pipesAttempt = z.union([
  z.object({
    rotate: z.number().int().min(0).max(1024),
    turns: z.number().int().min(1).max(3).optional(),
  }),
  z.object({ gate: z.number().int().min(0).max(1024) }),
]);
const splitAttempt = z.union([
  z.object({ symbols: z.array(z.string().max(32)).max(32) }),
  z.object({ code: z.string().max(64) }),
]);

/** Desenlaces de plantilla que no son un error del jugador. */
const OK_OUTCOMES = new Set([
  "correct",
  "solved",
  "moved",
  "rotated",
  "opened",
  "flipped",
  "match",
  "mismatch",
  "turn_ended",
  "revealed",
  "activated",
  "deactivated",
]);

/**
 * Resultado de `startFromLobby` (encargo lobby-diseño): `ok` o el rechazo con
 * su código de protocolo (`GAME_ERRORS`) y un mensaje legible.
 */
export type StartFromLobbyResult = { ok: true } | { ok: false; code: string; message: string };

/** Traducción de desenlaces de plantilla a errores de `attempt_result` (specs/11 §5). */
const ATTEMPT_ERRORS: Record<string, string> = {
  wrong: "wrong_code",
  unavailable: "not_available",
  already_solved: "already_resolved",
  already_revealed: "already_resolved",
};

/**
 * `GameRoom` (specs/11 §1): una partida. Ejecuta el `RoomSession` de `shared`
 * como estado autoritativo —motor de reglas + las 8 plantillas— y sincroniza
 * una proyección pública en el room state. Todo lo que resolvería un puzzle
 * (códigos, reparto del `memory`, fragmentos de `split_clue`, testigo de
 * `pipes`) solo sale en respuestas dirigidas al jugador autorizado.
 *
 * Reloj: lógico, en ms desde la creación de la sala; lo avanza la simulación
 * cada `GAME_TICK_MS` (timers del cronómetro y el `delay` de la victoria).
 */
export class GameRoom extends Room<{ state: GameRoomState }> {
  override maxClients = MAX_PLAYERS;
  /** C-8: Colyseus corta al cliente que supere esto, aunque ignore el rate limit de la app. */
  override maxMessagesPerSecond = 60;

  /** `protected`: `EventRoom` las lee para el arranque conjunto del organizador (ticket "inicio conjunto"). */
  protected roomPackage!: RoomPackage;
  /** Sala de espera de la partida (la diseñada o la generada por `withLobbyRoom`). */
  private lobbyRoomId = "";
  /**
   * Encargo lobby-diseño: el anfitrión ya pulsó «Empezar» (o se invocó
   * `startFromLobby` desde fuera). La fase pasa a `starting` y el reloj sigue
   * parado hasta que el PRIMER jugador entra al mapa (`enter_map`).
   */
  private launched = false;
  protected session?: RoomSession;
  private createdAt = 0;
  private seed = 0;
  private ended = false;
  /** Paneles abiertos por jugador: tras cada acción se les reenvía la vista. */
  protected readonly openPanels = new Map<string, Set<string>>();
  /**
   * C-9 (revisión de la PR #163: la versión derivada de `GamePuzzleState`
   * —state/attempts/solvedBy— no bastaba, `puzzleView` depende de mucho más
   * que eso: la ficha movida de un `sliding_puzzle`, la carta levantada de un
   * `memory`, la rotación de un `pipes`, la ventana de simultaneidad de
   * `simultaneous_plates`, la posición del jugador en `split_clue`… Nada de
   * eso mueve `state`/`attempts` hasta resolver, así que un segundo jugador
   * con el panel abierto dejaba de ver los cambios del primero). Por eso la
   * condición de reenvío es el CONTENIDO real de la vista: se serializa
   * `puzzleView(puzzleId, sessionId)` y se compara con la última
   * serialización mandada a ESE cliente para ESE panel; solo se manda si
   * difiere. Sigue eliminando lo que señalaba la auditoría (recalcular y
   * mandar sin condición en cada tick de 250 ms) sin arriesgar una vista
   * desactualizada por una fuente de cambio no cubierta.
   */
  private readonly sentPanelViews = new Map<string, Map<string, string>>();
  /** C-9: última vez (reloj lógico) que se sincronizó `state.clock` a los clientes. */
  private lastClockSyncAt = -Infinity;
  /** C-9: último valor bruto (sin `JSON.stringify`) sincronizado de cada flag. */
  private readonly flagMirror = new Map<string, string | number | boolean>();
  /** Chat de la partida (specs/11 §4.4): en cualquier fase, también en el lobby. */
  protected readonly chat = new RoomChat();
  /** Rate limit por mensaje y jugador (specs/11 §9); `undefined` = apagado. */
  protected messageLimiter?: MessageRateLimiter;
  /** Rechazos de un observador dentro de la ventana (C-8): tras el tope, se le corta. */
  protected readonly deniedActions = new Map<string, { count: number; windowStart: number }>();
  /**
   * C-2: reconexión en curso por `sessionId` (lo que devuelve
   * `allowReconnection`). Se rechazan todas al terminar la partida —ya no se
   * puede seguir jugando— y se cancela la de quien vuelve.
   */
  protected readonly pendingReconnections = new Map<string, Deferred<Client>>();
  /** C-2: temporizador de reasignación de anfitrión (60 s), por `sessionId` desconectado. */
  protected readonly hostReassignTimers = new Map<string, Delayed>();
  /**
   * Partidas abandonadas (decisión 2026-09-26): temporizador armado mientras
   * la partida está lanzada (`starting`/`playing`) y NADIE está conectado.
   * Se cancela en cuanto alguien reconecta o entra tarde; `undefined` si no
   * hay ninguna cuenta atrás en curso (siempre hay al menos un conectado, o
   * la partida no está lanzada/ya terminó).
   */
  private abandonedGameTimer?: Delayed;
  /**
   * `true` si el cierre en curso es por abandono (temporizador de arriba, no
   * un `game_ended` normal): `onMilestone` lo usa para LIBERAR la compra
   * (`releasePlaySession`) en vez de consumirla (`markPlaySessionEnded`) —
   * decisión del usuario: una partida abandonada no debe gastar la única
   * partida de una compra B2C, para poder volver a jugarla.
   */
  private closedAsAbandoned = false;
  /**
   * C-2 (ajuste de producto): anfitrión ORIGINAL mientras un anfitrión
   * PROVISIONAL ocupa el puesto (se reasignó a los `HOST_REASSIGN_GRACE_SEC`
   * de una desconexión). Si el original vuelve antes de que termine la
   * partida, recupera el puesto y esto se limpia; `null` si nadie espera.
   */
  protected originalHostId: string | null = null;
  /**
   * C-2 (ajuste 2026-09-25): `seatKey` del navegador → `sessionId` activo con
   * esa plaza (misma persona, pestaña recargada/reabierta sin el token de
   * reconexión nativo de Colyseus). Análogo al `activeSeatByPlayerId` de
   * `EventRoom`, pero para la `GameRoom` desnuda (sin `playerId`).
   */
  private readonly activeSeatByKey = new Map<string, string>();
  /**
   * C-13: identidades expulsadas (`kick`) durante la vida de esta room — no
   * pueden volver a entrar ni con el enlace de invitación ni (en `EventRoom`)
   * con su clave de evento. En la `GameRoom` desnuda la identidad es el
   * `seatKey` del navegador (lo único estable que ya existía, C-2); en
   * `EventRoom` es el `playerId` del `joinToken` (identidad real de evento).
   */
  protected readonly kickedIdentities = new Set<string>();
  /** `sessionId` expulsado cuyo `onLeave` aún no ha llegado (para difundir `reason: "kicked"`). */
  private readonly pendingKickReasons = new Set<string>();
  /** Inverso de `activeSeatByKey`, para poder limpiarlo al purgar una plaza. */
  private readonly seatKeyBySession = new Map<string, string>();
  /** Claims del `gameToken` que autorizó crear esta room (C-4/B-4); ausente en Playtest/Event. */
  protected gameAccess?: GameAccessClaims;
  /** Paquete resuelto por una compra B2C (B-4): pisa `resolveRoomPackage(options.packageId)`. */
  private purchasedRoomPackage?: RoomPackage;
  /** Latido de la reclamación de compra (ticket duración-salas); solo si `gameAccess.kind === "purchase"`. */
  private heartbeatInterval?: Delayed;

  /**
   * C-20 (auditoría 2026-09-24): envuelve la creación real (`setupRoom`) para
   * registrar y capturar en Sentry cualquier fallo de `onCreate` (token
   * inválido, paquete desconocido…) antes de dejarlo seguir su curso
   * (Colyseus lo convierte en un rechazo de matchmaking al cliente).
   */
  override async onCreate(options: GameRoomOptions = {}): Promise<void> {
    try {
      await this.setupRoom(options);
    } catch (err) {
      this.roomLogger.error({ err }, "game-room: fallo en onCreate");
      Sentry.captureException(err);
      throw err;
    }
  }

  private async setupRoom(options: GameRoomOptions): Promise<void> {
    if (this.requiresGameAccessToken()) {
      await this.authorizeGameAccessCreate(options);
    }
    // La partida siempre tiene sala de espera: la diseñada por el creador o,
    // si la sala no tiene (todas las anteriores a este campo), una generada
    // con el suelo y los muros de su habitación inicial (`withLobbyRoom`).
    const roomPackage = withLobbyRoom(this.loadRoomPackage(options));
    this.roomPackage = roomPackage;
    this.lobbyRoomId = lobbyRoomOf(roomPackage.map)?.id ?? "";
    this.maxClients = Math.min(MAX_PLAYERS, roomPackage.meta.players.max);
    this.createdAt = Date.now();
    this.seed = randomInt(0, 2 ** 31);

    this.state = new GameRoomState();
    this.state.phase = "lobby";
    this.state.result = "";
    this.state.roomPackageId = roomPackage.meta.id;
    this.state.roomPackageVersion = roomPackage.meta.version;

    const limits = this.messageRateLimits();
    this.messageLimiter = limits ? new MessageRateLimiter(limits) : undefined;

    // Rate limit por jugador PRIMERO (specs/11 §9, ticket 6.3; C-8): un
    // observador que inunda también gasta su cuota (30 msg/s), así que nunca
    // desborda la room a velocidad de línea aunque `canAct` lo vaya a
    // rechazar después. Un mensaje por encima de su cuota se descarta sin
    // llegar al handler y el emisor recibe UN `error RATE_LIMITED` por tipo y
    // ventana. Después, `canAct`: la `EventRoom` (5.9) admite observadores de
    // solo lectura cuyas acciones se rechazan antes de llegar al motor — pero
    // solo se les responde `PERMISSION_DENIED` las primeras veces; tras el
    // tope (`OBSERVER_DENIAL_KICK_LIMIT`) se les corta la conexión en vez de
    // seguir respondiendo a cada mensaje (C-8).
    const on = (type: string, handler: (client: Client, payload: unknown) => void) =>
      this.onMessage(type, (client, payload: unknown) => {
        const decision = this.messageLimiter?.check(client.sessionId, type, payload);
        if (decision && !decision.ok) {
          if (decision.notify) {
            client.send(ERROR_MESSAGE, {
              code: MESSAGE_RATE_LIMITED_ERROR,
              message: `Demasiados mensajes «${type}»: espera ${decision.retryAfterMs} ms.`,
              retryAfterMs: decision.retryAfterMs,
              messageType: type,
            });
          }
          return;
        }
        if (!this.canAct(client)) {
          this.notePermissionDenied(client);
          return;
        }
        // C-20 (auditoría 2026-09-24): un handler que lanza no debe tumbar la
        // room entera (Colyseus no atrapa nada aquí) ni desaparecer sin
        // rastro — se registra con el tipo de mensaje y se captura en Sentry.
        try {
          handler(client, payload);
        } catch (err) {
          this.roomLogger.error(
            { err, sessionId: client.sessionId, messageType: type },
            "game-room: fallo en un handler",
          );
          Sentry.captureException(err, { extra: { roomId: this.roomId, messageType: type } });
        }
      });
    on(GAME_MESSAGES.startGame, (client, payload) =>
      this.withPayload(client, startGamePayload, payload ?? {}, (data) =>
        this.handleStart(client, data),
      ),
    );
    on(GAME_MESSAGES.setReady, (client, payload) =>
      this.withPayload(client, setReadyPayload, payload, (data) =>
        this.handleSetReady(client, data),
      ),
    );
    on(GAME_MESSAGES.kick, (client, payload) =>
      this.withPayload(client, kickPayload, payload, (data) => this.handleKick(client, data)),
    );
    on(GAME_MESSAGES.enterMap, (client, payload) =>
      this.withPayload(client, emptyPayload, payload ?? {}, () => this.handleEnterMap(client)),
    );
    on(GAME_MESSAGES.move, (client, payload) =>
      this.withPayload(client, movePayload, payload, (data) => this.handleMove(client, data)),
    );
    on(GAME_MESSAGES.interact, (client, payload) =>
      this.withPayload(client, objectPayload, payload, (data) => this.handleInteract(client, data)),
    );
    on(GAME_MESSAGES.useItem, (client, payload) =>
      this.withPayload(client, useItemPayload, payload, (data) => this.handleUseItem(client, data)),
    );
    on(GAME_MESSAGES.combine, (client, payload) =>
      this.withPayload(client, combinePayload, payload, (data) => this.handleCombine(client, data)),
    );
    on(GAME_MESSAGES.puzzleOpen, (client, payload) =>
      this.withPayload(client, puzzlePayload, payload, (data) => this.handleOpen(client, data)),
    );
    on(GAME_MESSAGES.puzzleClose, (client, payload) =>
      this.withPayload(client, puzzlePayload, payload, (data) => {
        this.openPanels.get(client.sessionId)?.delete(data.puzzleId);
      }),
    );
    on(GAME_MESSAGES.puzzleAttempt, (client, payload) =>
      this.withPayload(client, attemptPayload, payload, (data) => this.handleAttempt(client, data)),
    );
    on(GAME_MESSAGES.plateState, (client, payload) =>
      this.withPayload(client, platePayload, payload, (data) => this.handlePlate(client, data)),
    );
    on(GAME_MESSAGES.splitView, (client, payload) =>
      this.withPayload(client, optionalPuzzlePayload, payload ?? {}, (data) =>
        this.handleSplitView(client, data),
      ),
    );
    on(GAME_MESSAGES.hintRequest, (client, payload) =>
      this.withPayload(client, puzzlePayload, payload, (data) => this.handleHint(client, data)),
    );
    on(GAME_MESSAGES.selectCharacter, (client, payload) =>
      this.withPayload(client, selectCharacterPayload, payload, (data) =>
        this.handleSelectCharacter(client, data),
      ),
    );
    on(CHAT_MESSAGE, (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.chat.handle(client, player.name, payload, this.state.chat);
    });
    // Medios (specs/11 §8, ticket 2.2): token LiveKit de la room derivada de
    // `this.roomId`; sin claves llega `configured: false` y se juega sin medios.
    // `role`/`name` los decide el servidor (C-3): el cliente solo puede REBAJAR
    // `allowVideo` a `false`, nunca subirlo por encima de la política.
    on(MEDIA_TOKEN_REQUEST_MESSAGE, (client, payload) => {
      sendMediaTokenToClient(client, this.roomId, payload, {
        role: this.mediaRoleFor(client),
        name: this.mediaNameFor(client),
        allowVideo: this.mediaAllowVideoPolicy(),
      }).catch((err: unknown) => {
        logger.warn(
          { err, roomId: this.roomId, sessionId: client.sessionId },
          "media: fallo al enviar el token al cliente",
        );
      });
    });

    this.setTimestep(() => this.handleTick(), GAME_TICK_MS);

    // Ticket duración-salas: renueva la reclamación de la compra mientras la
    // room viva, para que una partida larga (o sin duración) nunca se
    // considere abandonada solo por cuánto hace que empezó (ver
    // `PLAY_SESSION_STALE_AFTER_SECONDS`).
    if (this.gameAccess?.kind === "purchase") {
      const purchaseId = this.gameAccess.purchaseId;
      this.heartbeatInterval = this.clock.setInterval(() => {
        getGameAccessRuntime()
          ?.heartbeatPlaySession(purchaseId, this.roomId)
          .catch((err: unknown) => {
            logger.warn(
              { err, roomId: this.roomId, purchaseId },
              "game-access: fallo al renovar el latido",
            );
          });
      }, PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS * 1000);
    }
  }

  /**
   * Límites por mensaje de la room (specs/11 §9). `null` los apaga; por
   * defecto salen de `GAME_MESSAGE_RATE_LIMIT` (ver `readGameMessageRateLimits`).
   */
  protected messageRateLimits(): GameMessageRateLimits | null {
    return readGameMessageRateLimits();
  }

  /**
   * Puntos de extensión de los plazos de C-2 (segundos): puros `const` por
   * defecto, pero como método para que los tests puedan acortarlos con una
   * subclase en vez de esperar minutos reales.
   */
  protected lobbyReconnectGraceSeconds(): number {
    return LOBBY_RECONNECT_GRACE_SEC;
  }

  protected hostReassignGraceSeconds(): number {
    return HOST_REASSIGN_GRACE_SEC;
  }

  protected resultsRoomLifetimeSeconds(): number {
    return RESULTS_ROOM_LIFETIME_SEC;
  }

  /** Partidas abandonadas: segundos sin nadie conectado antes de cerrarla (decisión 2026-09-26). */
  protected abandonedGameTimeoutSeconds(): number {
    return ABANDONED_GAME_TIMEOUT_SEC;
  }

  /**
   * Resuelve el paquete de la partida en servidor (el cliente solo elige el id).
   * `this.purchasedRoomPackage` (B-4) pisa `packageId`: una compra siempre
   * juega la versión exacta comprada, nunca lo que pida el cliente.
   * `PlaytestRoom`/`EventRoom` sobrescriben este método entero (borrador
   * congelado / paquete del evento) y nunca llaman a `super`.
   */
  protected loadRoomPackage(options: GameRoomOptions): RoomPackage {
    if (this.purchasedRoomPackage) return this.purchasedRoomPackage;
    const roomPackage = resolveRoomPackage(options.packageId);
    if (!roomPackage) {
      throw new Error(`Paquete de sala desconocido: «${options.packageId ?? ""}».`);
    }
    return roomPackage;
  }

  /**
   * ¿Esta clase exige un `gameToken` para crearse (C-4)? `true` en la
   * `GameRoom` desnuda; `EventRoom`/`PlaytestRoom` tienen su propio token
   * (`joinToken`/token de playtest) y lo desactivan.
   */
  protected requiresGameAccessToken(): boolean {
    return true;
  }

  /**
   * Verifica el `gameToken` de creación (C-4/B-4) y, si acredita una compra,
   * RECLAMA su partida (`GameAccessStore.claimPlaySession`, escritura
   * condicional: specs/02, "una compra = una partida", consumida al
   * terminar — `onMilestone`/`onDispose` más abajo). Rechaza con
   * `ServerError` (nunca un stack trace, specs/11 §7) si el token falta, es
   * inválido, es una partida de prueba fuera de un entorno que la permita, o
   * la compra ya está consumida o en curso en otra room sin caducar. Deja
   * `this.gameAccess`/`this.purchasedRoomPackage` listos para
   * `onAuth`/`loadRoomPackage`.
   */
  private async authorizeGameAccessCreate(options: GameRoomOptions): Promise<void> {
    const config = readGameAccessTokenConfig();
    if (!config) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.missing);
    }
    const verified = verifyGameAccessToken(config.secret, options.gameToken);
    if (!verified.ok) {
      throw new ServerError(
        GAME_ACCESS_FORBIDDEN_CODE,
        GAME_ACCESS_ERROR_BY_TOKEN_ERROR[verified.error],
      );
    }
    this.gameAccess = verified.claims;
    if (verified.claims.kind === "dev_test") {
      if (!devTestGameTokenAllowed()) {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.devTestForbidden);
      }
      return;
    }
    if (verified.claims.kind === "free") {
      // Sala realmente gratis (punto i, `docs/DEUDA.md`): carga el paquete
      // publicado, pero SIN `claimPlaySession` — no hay compra que reclamar
      // ni consumir, el abuso ya se frenó al FIRMAR el token (cuota por IP).
      const runtime = getGameAccessRuntime();
      const roomPackage = runtime
        ? await runtime.loadRoomVersionPackage(verified.claims.roomVersionId).catch(() => null)
        : null;
      if (!runtime || !roomPackage) {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.unavailable);
      }
      this.purchasedRoomPackage = roomPackage;
      return;
    }
    const runtime = getGameAccessRuntime();
    const roomPackage = runtime
      ? await runtime.loadRoomVersionPackage(verified.claims.roomVersionId).catch(() => null)
      : null;
    if (!runtime || !roomPackage) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.unavailable);
    }
    const claimed = await runtime
      .claimPlaySession(verified.claims.purchaseId, this.roomId)
      .catch(() => false);
    if (!claimed) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.playSessionUsed);
    }
    this.purchasedRoomPackage = roomPackage;
  }

  /**
   * `onAuth` de cada cliente que se une (creador incluido, `create()` lo
   * llama tras `onCreate`; y cualquiera que entre por `joinById`, C-4): exige
   * el mismo `gameToken` que autorizó la room y, si es de compra, que sea
   * **la misma compra** (evita que el token de compra de otra sala/usuario
   * cuele en esta partida). `EventRoom`/`PlaytestRoom` sobrescriben `onAuth`
   * entero y nunca llaman a `super`.
   */
  override onAuth(_client: Client, options: GameRoomOptions & { seatKey?: string } = {}): unknown {
    try {
      return this.authorizeJoin(_client, options);
    } catch (err) {
      if (err instanceof ServerError) {
        this.roomLogger.warn(
          { code: err.code, message: err.message },
          "game-room: token de acceso rechazado",
        );
      }
      throw err;
    }
  }

  private authorizeJoin(_client: Client, options: GameRoomOptions & { seatKey?: string }): unknown {
    if (options.seatKey && this.kickedIdentities.has(options.seatKey)) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.kicked);
    }
    if (!this.requiresGameAccessToken()) return true;
    const config = readGameAccessTokenConfig();
    if (!config) throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.missing);
    const verified = verifyGameAccessToken(config.secret, options.gameToken);
    if (!verified.ok) {
      throw new ServerError(
        GAME_ACCESS_FORBIDDEN_CODE,
        GAME_ACCESS_ERROR_BY_TOKEN_ERROR[verified.error],
      );
    }
    if (verified.claims.kind === "dev_test") {
      if (!devTestGameTokenAllowed()) {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.devTestForbidden);
      }
      if (this.gameAccess?.kind !== "dev_test") {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.invalid);
      }
      return true;
    }
    if (verified.claims.kind === "free") {
      if (
        this.gameAccess?.kind !== "free" ||
        this.gameAccess.roomVersionId !== verified.claims.roomVersionId
      ) {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.invalid);
      }
      return true;
    }
    if (
      this.gameAccess?.kind !== "purchase" ||
      this.gameAccess.purchaseId !== verified.claims.purchaseId
    ) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.invalid);
    }
    return true;
  }

  /**
   * ¿Puede este cliente enviar intenciones? Siempre en la `GameRoom`; la
   * `EventRoom` (5.9) lo niega a los observadores.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- punto de extensión
  protected canAct(client: Client): boolean {
    return true;
  }

  /** Rol de medios (specs/12) del cliente; la `EventRoom` distingue observadores. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- punto de extensión
  protected mediaRoleFor(client: Client): MediaRole {
    return "player";
  }

  /** Nombre servidor-autoritativo (C-3) para el token de medios del cliente. */
  protected mediaNameFor(client: Client): string | undefined {
    return this.state.players.get(client.sessionId)?.name;
  }

  /**
   * Política de vídeo del servidor (C-3, specs/12 §4): `undefined` deja que
   * `resolveMediaToken` use `LIVEKIT_ALLOW_VIDEO`; la `EventRoom` la fija con
   * `events.config.allowVideo` (default `false`).
   */
  protected mediaAllowVideoPolicy(): boolean | undefined {
    return undefined;
  }

  /**
   * Gancho de hitos (ticket 5.12): la `EventRoom` lo sobrescribe entero para
   * persistirlos (sin llamar a `super`). Aquí solo consume el `game_ended`
   * de una compra B2C (B-4): marca `playSessionEndedAt` — consumo
   * DEFINITIVO de la única partida de la compra (specs/02, decisión del
   * README: se gasta al terminar, no al crear). Se llama de forma síncrona
   * desde el bucle de juego: la escritura es asíncrona y no bloquea.
   *
   * Excepción (decisión 2026-09-26, partidas abandonadas): si el cierre lo
   * disparó `closeAbandonedGame` (`this.closedAsAbandoned`), en vez de
   * consumirla se LIBERA (`releasePlaySession`) — una partida abandonada
   * (nadie volvió en 60 min) no debe gastar la única partida de la compra;
   * el usuario tiene que poder reclamarla de nuevo.
   */
  /** C-20: logger con `roomId` ya en el contexto, en vez de repetirlo en cada log. */
  protected get roomLogger() {
    return logger.child({ roomId: this.roomId });
  }

  protected onMilestone(milestone: GameMilestone): void {
    this.recordAnalytics(milestone);
    if (milestone.kind !== "game_ended" || this.gameAccess?.kind !== "purchase") return;
    const purchaseId = this.gameAccess.purchaseId;
    const runtime = getGameAccessRuntime();
    if (this.closedAsAbandoned) {
      runtime?.releasePlaySession(purchaseId, this.roomId).catch((err: unknown) => {
        logger.warn(
          { err, roomId: this.roomId, purchaseId },
          "game-access: fallo al liberar la compra tras un abandono",
        );
      });
      return;
    }
    runtime?.markPlaySessionEnded(purchaseId).catch((err: unknown) => {
      logger.warn(
        { err, roomId: this.roomId, purchaseId },
        "game-access: fallo al consumir la compra",
      );
    });
  }

  /**
   * Analítica de partida (C-13, auditoría 2026-09-24: "hoy Colyseus no emite
   * ninguna"): cada hito (`onMilestone`) queda como un log estructurado
   * (`roomLogger`, C-20) — sin backend propio todavía, pero YA enganchado a
   * un sumidero real (nunca a `console.log` suelto), listo para que un
   * consumidor de logs o un backend de analítica dedicado lo recoja sin tocar
   * este punto. `EventRoom.onMilestone` lo llama explícitamente (sobrescribe
   * el método entero y no llama a `super`).
   */
  protected recordAnalytics(milestone: GameMilestone): void {
    this.roomLogger.info({ milestone }, `analytics: ${milestone.kind}`);
  }

  /** Reloj de un hito: ahora, tiempo jugado y pistas acumuladas. */
  private milestoneClock(): GameMilestoneClock {
    const game = this.session?.state;
    const now = this.logicalNow();
    const started = Boolean(game?.flags.game_started);
    const end = game?.endedAt ?? now;
    return {
      // Mismo reloj que `progressCounters`: lo persistido cuadra con lo vivo.
      at: this.createdAt + end,
      elapsedMs: started && game ? Math.max(0, end - game.startedAt) : 0,
      hintsUsed: game ? Object.values(game.hintsUsed).reduce((sum, cost) => sum + cost, 0) : 0,
    };
  }

  /**
   * Progreso público de la partida (ticket 5.9): contadores y tiempos, nunca
   * soluciones. Lo lee el panel del organizador a través de la `EventRoom`.
   */
  protected progressCounters(): {
    phase: LivePhase;
    result: SessionResult | null;
    puzzlesSolved: number;
    puzzlesTotal: number;
    hintsUsed: number;
    players: number;
    /** Mínimo de `meta.players.min` (inicio conjunto, panel del organizador). */
    minPlayers: number;
    /** Conectados con "Listo" marcado (inicio conjunto, panel del organizador). */
    readyCount: number;
    startedAt: number | null;
    endedAt: number | null;
    elapsedMs: number;
  } {
    const game = this.session?.state;
    const now = this.logicalNow();
    const started = Boolean(game?.flags.game_started);
    const endedAt = started && game?.endedAt !== undefined ? game.endedAt : null;
    const { connected, ready, min } = this.readiness();
    return {
      phase: (LIVE_PHASES as readonly string[]).includes(this.state.phase)
        ? (this.state.phase as LivePhase)
        : "lobby",
      result: toSessionResult(game?.result) ?? null,
      puzzlesSolved: game ? solvedPuzzleIds(game).length : 0,
      puzzlesTotal: this.roomPackage.puzzles.length,
      hintsUsed: game ? Object.values(game.hintsUsed).reduce((sum, cost) => sum + cost, 0) : 0,
      players: connected,
      minPlayers: min,
      readyCount: ready,
      startedAt: started && game ? this.createdAt + game.startedAt : null,
      endedAt: endedAt !== null ? this.createdAt + endedAt : null,
      elapsedMs: started && game ? Math.max(0, (endedAt ?? now) - game.startedAt) : 0,
    };
  }

  override onJoin(client: Client, options: GameJoinOptions = {}): void {
    // C-2 (ajuste 2026-09-25): `seatKey` reconoce a quien ya tenía plaza en
    // esta room —recarga o pestaña reabierta sin el token de reconexión
    // nativo de Colyseus— y le devuelve exactamente su jugador en vez de
    // sumarle uno nuevo mientras la vieja plaza queda vacía hasta el fin.
    const seatKey = options.seatKey;
    const previousSessionId = seatKey ? this.activeSeatByKey.get(seatKey) : undefined;
    if (seatKey) this.activeSeatByKey.set(seatKey, client.sessionId);
    if (previousSessionId !== undefined && previousSessionId !== client.sessionId) {
      this.seatKeyBySession.set(client.sessionId, seatKey!);
      this.adoptSeat(previousSessionId, client, options.name ?? "");
      this.seatKeyBySession.delete(previousSessionId);
      return;
    }
    if (seatKey) this.seatKeyBySession.set(client.sessionId, seatKey);

    // Todo jugador nuevo aparece en la sala de espera (encargo lobby-diseño):
    // antes de «Empezar», y también quien llega tarde a una partida ya
    // empezada — verá la introducción y su 3-2-1 y entrará al mapa en curso
    // con `enter_map`. (Una reconexión no pasa por aquí: conserva su plaza.)
    const session = this.ensureSession(client.sessionId);
    const moved = session.spawnPlayer(client.sessionId, this.logicalNow(), this.lobbyRoomId);
    const position = session.playerPosition(client.sessionId)!;

    const usedTints: string[] = [];
    const usedCharacters: string[] = [];
    this.state.players.forEach((existing) => {
      usedTints.push(existing.tint);
      usedCharacters.push(existing.characterId);
    });
    const player = new GamePlayerState();
    player.id = client.sessionId;
    player.name = sanitizeName(options.name) ?? `Jugador ${this.state.players.size + 1}`;
    player.x = position.x;
    player.y = position.y;
    player.roomId = position.roomId;
    player.tint = pickPlayerTint(usedTints);
    player.characterId = this.resolveJoinCharacter(options.characterId, usedCharacters);
    player.connected = true;
    player.inMap = false;
    this.state.players.set(client.sessionId, player);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.openPanels.set(client.sessionId, new Set());
    this.chat.join(client.sessionId);
    this.cancelAbandonedGameCheck();

    this.publish(moved.engine);
  }

  /**
   * Desconexión SIN consentir (caída de red, cierre de pestaña): specs/11
   * §8.1. El jugador conserva su inventario, posición y `characterId` —solo
   * se marca desconectado— y se le reserva la plaza:
   * - En juego (`playing`): hasta que la partida termine (`"manual"`; el
   *   propio `announceEnd` rechaza todas las pendientes).
   * - En el lobby: `LOBBY_RECONNECT_GRACE_SEC`, para no dejar cupo fantasma.
   * Si era el anfitrión, `scheduleHostReassignment` cubre el otro plazo (el
   * puesto, no la plaza).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por Colyseus (`code`, subclases lo usan)
  override onDrop(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    if (client.sessionId === this.state.hostId) this.scheduleHostReassignment(client.sessionId);
    if (this.ended) return; // `onLeave` purga: tras `game_ended` no hay reconexión.
    // Partida lanzada (`starting`/`playing`): la plaza se reserva hasta el fin.
    const seconds = this.launched ? ("manual" as const) : this.lobbyReconnectGraceSeconds();
    const reservation = this.allowReconnection(client, seconds);
    reservation.catch(() => undefined); // evita "unhandled rejection"; `onLeave` hace la purga real.
    this.pendingReconnections.set(client.sessionId, reservation);
    this.scheduleAbandonedGameCheck();
  }

  /** La reconexión de `onDrop` tuvo éxito (specs/11 §8.1): recupera plaza y, si tocaba, anfitrión. */
  override onReconnect(client: Client): void {
    this.pendingReconnections.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.cancelHostReassignment(client.sessionId);
    if (this.originalHostId === client.sessionId) {
      // Recupera el puesto; el anfitrión provisional lo pierde.
      this.state.hostId = client.sessionId;
      this.originalHostId = null;
    }
    this.openPanels.set(client.sessionId, new Set());
    this.chat.join(client.sessionId);
    this.cancelAbandonedGameCheck();
  }

  /**
   * Salida EFECTIVA (specs/11 §8.1): consentida (botón «salir»), por `kick`
   * (C-13), o porque la reconexión de `onDrop` se agotó/rechazó (grace
   * vencida o fin de partida). En todos los casos ya no vuelve: difunde
   * `player_left` (C-13: "X ha salido"/"X ha sido expulsado", lo traduce el
   * cliente por `reason`), registra el hito y purga la plaza (y, si aún era
   * anfitrión, lo reasigna ya mismo).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por Colyseus (`code`, subclases lo usan)
  override onLeave(client: Client, code?: number): void {
    this.pendingReconnections.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const wasKicked = this.pendingKickReasons.delete(client.sessionId);
    if (player) {
      const reason = wasKicked ? "kicked" : "left";
      this.broadcast(GAME_MESSAGES.playerLeft, {
        playerId: client.sessionId,
        name: player.name,
        reason,
      });
      this.onMilestone({
        kind: "player_left",
        playerId: client.sessionId,
        reason,
        actorId: wasKicked ? this.state.hostId || null : client.sessionId,
        ...this.milestoneClock(),
      });
    }
    this.purgePlayer(client.sessionId);
    this.scheduleAbandonedGameCheck();
  }

  /**
   * Un cliente nuevo (`sessionId` distinto) hereda la plaza de otro con la
   * misma identidad externa (C-1/C-2: la misma persona —pestaña duplicada
   * mientras la anterior sigue conectada, o una pestaña cerrada que se
   * reabre sin el token nativo de Colyseus—, nunca alguien nuevo). Copia
   * posición, inventario, personaje, tinte y paneles abiertos; expulsa al
   * socket anterior sin gracia (ya se ha migrado lo necesario) y, si tenía
   * el puesto de anfitrión (en curso o solo reservado como original),
   * traspasa la referencia. Solo la usa `EventRoom` (tiene una identidad de
   * jugador estable —el `playerId` del `joinToken`—, ausente en la
   * `GameRoom` desnuda, donde el `gameToken` no distingue personas).
   */
  protected adoptSeat(previousSessionId: string, newClient: Client, displayName: string): void {
    const newId = newClient.sessionId;
    const session = this.ensureSession(newId);
    const previous = this.state.players.get(previousSessionId);
    if (previous) {
      session.renamePlayer(previousSessionId, newId);
      const player = new GamePlayerState();
      player.id = newId;
      player.name = sanitizeName(displayName) ?? previous.name;
      player.x = previous.x;
      player.y = previous.y;
      player.roomId = previous.roomId;
      player.tint = previous.tint;
      player.characterId = previous.characterId;
      player.connected = true;
      player.ready = previous.ready;
      player.inMap = previous.inMap;
      this.state.players.set(newId, player);
      this.state.players.delete(previousSessionId);
      const inventory = this.state.inventories.get(previousSessionId);
      if (inventory) {
        this.state.inventories.set(newId, inventory);
        this.state.inventories.delete(previousSessionId);
      }
      if (this.state.hostId === previousSessionId) this.state.hostId = newId;
      if (this.originalHostId === previousSessionId) this.originalHostId = newId;
    } else {
      // La plaza anterior ya se había purgado del todo (tardó en volver más
      // que la gracia disponible): entra como si fuera nueva (sala de espera).
      const moved = session.spawnPlayer(newId, this.logicalNow(), this.lobbyRoomId);
      const position = session.playerPosition(newId)!;
      const usedTints: string[] = [];
      this.state.players.forEach((existing) => usedTints.push(existing.tint));
      const player = new GamePlayerState();
      player.id = newId;
      player.name = sanitizeName(displayName) ?? `Jugador ${this.state.players.size + 1}`;
      player.x = position.x;
      player.y = position.y;
      player.roomId = position.roomId;
      player.tint = pickPlayerTint(usedTints);
      player.characterId = this.resolveJoinCharacter(undefined, []);
      player.connected = true;
      player.inMap = false;
      this.state.players.set(newId, player);
      if (!this.state.hostId) this.state.hostId = newId;
      this.publish(moved.engine);
    }
    this.openPanels.set(newId, new Set(this.openPanels.get(previousSessionId) ?? []));
    this.openPanels.delete(previousSessionId);
    this.sentPanelViews.set(newId, this.sentPanelViews.get(previousSessionId) ?? new Map());
    this.sentPanelViews.delete(previousSessionId);
    this.chat.leave(previousSessionId);
    this.chat.join(newId);
    this.messageLimiter?.forget(previousSessionId);
    this.deniedActions.delete(previousSessionId);
    this.cancelHostReassignment(previousSessionId);
    this.pendingReconnections.get(previousSessionId)?.reject(new Error("duplicate_session"));
    this.pendingReconnections.delete(previousSessionId);
    this.clients.get(previousSessionId)?.leave(CloseCode.CONSENTED, "duplicate_session");
    this.cancelAbandonedGameCheck();
  }

  /** Libera por completo la plaza de `sessionId` (purga tras la gracia, o salida consentida). */
  private purgePlayer(sessionId: string): void {
    this.cancelHostReassignment(sessionId);
    this.state.players.delete(sessionId);
    this.state.inventories.delete(sessionId);
    this.openPanels.delete(sessionId);
    this.sentPanelViews.delete(sessionId);
    this.chat.leave(sessionId);
    this.messageLimiter?.forget(sessionId);
    this.deniedActions.delete(sessionId);
    if (this.originalHostId === sessionId) this.originalHostId = null;
    if (this.state.hostId === sessionId) this.reassignHostNow();
    const seatKey = this.seatKeyBySession.get(sessionId);
    if (seatKey && this.activeSeatByKey.get(seatKey) === sessionId) {
      this.activeSeatByKey.delete(seatKey);
    }
    this.seatKeyBySession.delete(sessionId);
  }

  /**
   * Anfitrión ausente: a los `HOST_REASSIGN_GRACE_SEC` de su desconexión,
   * otro jugador conectado pasa a anfitrión PROVISIONAL (ajuste de
   * producto); no toca la plaza (esa la gestiona `onDrop`/`allowReconnection`).
   * Se cancela si vuelve antes (`onReconnect`) o si su plaza se purga antes
   * (`purgePlayer`, p. ej. en el lobby).
   */
  protected scheduleHostReassignment(sessionId: string): void {
    this.cancelHostReassignment(sessionId);
    const timer = this.clock.setTimeout(() => {
      this.hostReassignTimers.delete(sessionId);
      if (this.state.hostId !== sessionId) return; // ya se resolvió de otra forma
      this.originalHostId = sessionId;
      this.reassignHostNow();
    }, this.hostReassignGraceSeconds() * 1000);
    this.hostReassignTimers.set(sessionId, timer);
  }

  protected cancelHostReassignment(sessionId: string): void {
    this.hostReassignTimers.get(sessionId)?.clear();
    this.hostReassignTimers.delete(sessionId);
  }

  /** Pasa el anfitrión al primer jugador conectado que no sea el actual (o a nadie: `""`). */
  protected reassignHostNow(): void {
    const current = this.state.hostId;
    let next = "";
    this.state.players.forEach((candidate, sessionId) => {
      if (next === "" && candidate.connected && sessionId !== current) next = sessionId;
    });
    this.state.hostId = next;
  }

  /** Conectados ahora mismo (`GamePlayerState.connected`); no incluye observadores. */
  private connectedPlayerCount(): number {
    let connected = 0;
    this.state.players.forEach((player) => {
      if (player.connected) connected += 1;
    });
    return connected;
  }

  /**
   * Partidas abandonadas (decisión 2026-09-26): arma (o rearma) la cuenta
   * atrás cuando, con la partida lanzada (`starting`/`playing`) y sin
   * terminar, deja de haber NADIE conectado. Se llama tras cada `onDrop`/
   * `onLeave` — los únicos eventos que pueden dejar la room a cero
   * conectados, porque en juego la plaza se reserva indefinidamente
   * (`onDrop`, C-2) y por tanto `onLeave` no llega por sí solo (specs/11
   * §8.1). Sin efecto si ya hay una cuenta atrás en curso o si sigue habiendo
   * alguien conectado (`cancelAbandonedGameCheck` la limpia).
   */
  private scheduleAbandonedGameCheck(): void {
    if (!this.launched || this.ended) return;
    if (this.abandonedGameTimer || this.connectedPlayerCount() > 0) return;
    this.abandonedGameTimer = this.clock.setTimeout(() => {
      this.abandonedGameTimer = undefined;
      this.closeAbandonedGame();
    }, this.abandonedGameTimeoutSeconds() * 1000);
  }

  /** Cancela la cuenta atrás de abandono (alguien reconectó o entró tarde). */
  private cancelAbandonedGameCheck(): void {
    this.abandonedGameTimer?.clear();
    this.abandonedGameTimer = undefined;
  }

  /**
   * Cierra la partida como abandonada (decisión 2026-09-26): nadie conectado
   * durante `abandonedGameTimeoutSeconds()`. Fuerza el resultado `aborted`
   * (`RoomSession.abort`, idempotente) y reutiliza `announceEnd` —difunde
   * `game_ended`, registra el hito, rechaza las reconexiones pendientes y
   * programa el cierre de la room— para no duplicar ese camino. `EventRoom`
   * no necesita sobrescribir nada: su `onMilestone` ya persiste cualquier
   * `game_ended` con el resultado que traiga, y el panel del organizador
   * muestra el grupo con el estado que ya tenga para partidas terminadas.
   */
  private closeAbandonedGame(): void {
    if (this.ended || !this.session) return;
    this.roomLogger.warn(
      { timeoutSec: this.abandonedGameTimeoutSeconds() },
      "game-room: cierre por abandono (sin jugadores conectados)",
    );
    this.closedAsAbandoned = true;
    this.session.abort(this.logicalNow());
    this.announceEnd();
  }

  /**
   * Si la room se cierra sin que la partida terminara (B-4: todos se fueron,
   * se expulsó la room, el servidor se reinicia con gracia…) y era de una
   * compra, LIBERA la reclamación (`playSessionStartedAt`/
   * `playSessionColyseusId` a `NULL`) para que se pueda volver a jugar. Si
   * terminó (`this.ended`, fijado por `announceEnd`), ya está consumida
   * (`onMilestone`): no toca nada. `EventRoom` sobrescribe `onDispose` entero
   * (vacía su cola de progreso) y nunca juega paquetes comprados, así que no
   * llama a `super`.
   */
  onDispose(): Promise<void> | void {
    this.heartbeatInterval?.clear();
    if (this.ended || this.gameAccess?.kind !== "purchase") return;
    const purchaseId = this.gameAccess.purchaseId;
    return getGameAccessRuntime()
      ?.releasePlaySession(purchaseId, this.roomId)
      .catch((err: unknown) => {
        logger.warn(
          { err, roomId: this.roomId, purchaseId },
          "game-access: fallo al liberar la compra",
        );
      });
  }

  // — Handlers ————————————————————————————————————————————————————

  /**
   * Personajes seleccionables del pack (A1/B4): el servidor es la autoridad,
   * valida contra esta lista y contra los ya ocupados en la sala. Mientras
   * falten personajes (hoy solo `caballero-m`), el resto cae al maniquí de
   * reserva, que no es único.
   */
  private availableCharacters(): readonly string[] {
    return loadAvatarCharacterIds();
  }

  /** `characterId` de un jugador que se une: el elegido si es válido, o el primero libre. */
  private resolveJoinCharacter(requested: string | undefined, usedCharacters: string[]): string {
    const available = this.availableCharacters();
    if (requested && isCharacterAvailable(requested, available, usedCharacters)) {
      return requested;
    }
    return pickPlayerCharacter(available, usedCharacters);
  }

  private handleSelectCharacter(client: Client, data: { characterId: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const usedCharacters: string[] = [];
    this.state.players.forEach((existing) => {
      if (existing.id !== client.sessionId) usedCharacters.push(existing.characterId);
    });
    if (!isCharacterAvailable(data.characterId, this.availableCharacters(), usedCharacters)) {
      this.fail(client, GAME_ERRORS.notAvailable, "Ese personaje ya está en uso.");
      return;
    }
    player.characterId = data.characterId;
    // C-13 (decisión del usuario): cambiar de personaje quita el "Listo".
    player.ready = false;
  }

  /** C-13 (specs/11 §4.1): marca/desmarca "Listo" en el lobby; sin efecto fuera de él. */
  private handleSetReady(client: Client, data: { ready: boolean }): void {
    if (this.state.phase !== "lobby") {
      this.fail(client, GAME_ERRORS.invalidState, "La partida ya ha empezado.");
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.ready = data.ready;
  }

  /**
   * Conectados, "Listos" y mínimo exigido (specs/11 §4.1): lo usa
   * `EventRoom.organizerStartGroup` (inicio conjunto del organizador, ticket
   * "inicio conjunto") y `progressCounters` (panel del organizador en vivo).
   * `handleStart`/`startFromLobby` cuentan por su cuenta (no dependen de
   * este helper) para no arrastrar el ticket a su propia lógica.
   */
  protected readiness(): { connected: number; ready: number; min: number } {
    let connected = 0;
    let ready = 0;
    this.state.players.forEach((player) => {
      if (!player.connected) return;
      connected += 1;
      if (player.ready) ready += 1;
    });
    return { connected, ready, min: this.roomPackage.meta.players.min };
  }

  /**
   * C-13 (decisiones del usuario): "Empezar" exige que TODOS los conectados
   * estén "Listo"; "Empezar igualmente" (`force`) se salta eso pero NUNCA
   * arranca por debajo de `meta.players.min` conectados — ni con `force`.
   */
  private handleStart(client: Client, data: { force?: boolean }): void {
    if (client.sessionId !== this.state.hostId) {
      this.fail(
        client,
        GAME_ERRORS.permissionDenied,
        "Solo el anfitrión puede empezar la partida.",
      );
      return;
    }
    // Ticket "inicio conjunto": con la opción activa, el anfitrión no puede
    // arrancar su grupo por su cuenta (defensa en profundidad — el cliente ya
    // le oculta "Empezar" y muestra "Esperando al organizador"); solo
    // `EventRoom.organizerStartGroup` puede.
    if (this.state.organizerControlsStart) {
      this.fail(
        client,
        GAME_ERRORS.permissionDenied,
        "Solo el organizador puede iniciar esta partida (inicio conjunto).",
      );
      return;
    }
    const result = this.startFromLobby({ force: data.force });
    if (!result.ok) this.fail(client, result.code, result.message);
  }

  /**
   * Cierra el lobby y lanza la partida (encargo lobby-diseño; C-13 para las
   * reglas): exige a TODOS los conectados «Listo» salvo `force` («Empezar
   * igualmente»), y NUNCA arranca por debajo de `meta.players.min`
   * conectados — ni con `force`, salvo `skipMinimum` (ticket "inicio
   * conjunto": únicamente `EventRoom.organizerStartGroup` lo pasa, para
   * "Comenzar igualmente" del organizador — nunca el anfitrión). No arranca
   * el reloj: la fase pasa a `starting` y cada jugador ve su introducción y
   * su 3-2-1; el reloj arranca cuando el PRIMERO entra al mapa (`enter_map`).
   *
   * Público y sin cliente a propósito: el inicio conjunto de todos los grupos
   * de un evento ("Todos los grupos comienzan juntos") lo invoca desde fuera
   * de la room (p. ej. `matchMaker.remoteRoomCall(roomId, "startFromLobby",
   * [{ force: true }])`). El anfitrión lo dispara con `start_game`.
   */
  startFromLobby(options: { force?: boolean; skipMinimum?: boolean } = {}): StartFromLobbyResult {
    if (this.launched || this.state.phase !== "lobby" || !this.session) {
      return { ok: false, code: GAME_ERRORS.invalidState, message: "La partida ya ha empezado." };
    }
    const connected: GamePlayerState[] = [];
    this.state.players.forEach((player) => {
      if (player.connected) connected.push(player);
    });
    if (!options.skipMinimum && connected.length < this.roomPackage.meta.players.min) {
      return {
        ok: false,
        code: GAME_ERRORS.minPlayersNotMet,
        message: `Hacen falta al menos ${this.roomPackage.meta.players.min} jugadores conectados.`,
      };
    }
    if (!options.force && connected.some((player) => !player.ready)) {
      return {
        ok: false,
        code: GAME_ERRORS.playersNotReady,
        message: "Todavía hay jugadores que no están «Listo».",
      };
    }
    this.launched = true;
    this.syncState({ forceClock: true });
    return { ok: true };
  }

  /** ¿Ya se cerró el lobby (`startFromLobby`)? Para quien orquesta la room desde fuera. */
  get lobbyClosed(): boolean {
    return this.launched;
  }

  /**
   * `enter_map` (encargo lobby-diseño, specs/11 §4.1): el jugador terminó su
   * introducción y su 3-2-1 — sale de la sala de espera y aparece en la
   * habitación inicial (spawn normal). El PRIMERO que entra arranca el reloj
   * de la partida (`RoomSession.start`: `startedAt`/`endsAt`, hito
   * `game_started`); los que sigan leyendo la introducción ya consumen tiempo.
   * Idempotente para quien ya está en el mapa.
   */
  private handleEnterMap(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.session;
    if (!player || !session) return;
    if (!this.launched) {
      this.fail(client, GAME_ERRORS.invalidState, "La partida aún no ha empezado.");
      return;
    }
    if (this.ended || session.ended) {
      this.fail(client, GAME_ERRORS.invalidState, "La partida ha terminado.");
      return;
    }
    if (player.inMap) return;
    const now = this.logicalNow();
    const moved = session.spawnPlayer(client.sessionId, now);
    player.inMap = true;
    player.ready = false;
    const results: Array<EngineResult | null | undefined> = [moved.engine];
    if (!session.state.flags.game_started) {
      results.push(session.start(now));
      this.onMilestone({ kind: "game_started", at: this.createdAt + session.state.startedAt });
    }
    for (const result of results) this.publish(result);
  }

  /** C-13 (solo anfitrión, specs/11 §4.5): expulsa a otro jugador; no puede volver a esta room. */
  private handleKick(client: Client, data: { playerId: string }): void {
    if (client.sessionId !== this.state.hostId) {
      this.fail(client, GAME_ERRORS.permissionDenied, "Solo el anfitrión puede expulsar.");
      return;
    }
    if (data.playerId === client.sessionId) {
      this.fail(client, GAME_ERRORS.kickTargetInvalid, "No puedes expulsarte a ti mismo.");
      return;
    }
    const target = this.state.players.get(data.playerId);
    if (!target || !target.connected) {
      this.fail(client, GAME_ERRORS.kickTargetInvalid, "Ese jugador no está conectado.");
      return;
    }
    const identity = this.identityFor(data.playerId);
    if (identity) this.kickedIdentities.add(identity);
    this.pendingKickReasons.add(data.playerId);
    this.clients.get(data.playerId)?.leave(CloseCode.CONSENTED, "kicked");
  }

  /**
   * Identidad estable de `sessionId` para el bloqueo de reingreso de `kick`
   * (C-13): el `seatKey` del navegador en la `GameRoom` desnuda (único id
   * estable que ya existía, C-2); `EventRoom` la resuelve por `playerId` del
   * `joinToken` (sobrescribe este método).
   */
  protected identityFor(sessionId: string): string | undefined {
    return this.seatKeyBySession.get(sessionId);
  }

  private handleMove(client: Client, payload: z.infer<typeof movePayload>): void {
    // En la sala de espera (antes de entrar al mapa) el avatar también se
    // mueve y los demás lo ven, pero sin cruzar a ninguna otra habitación.
    const inLobby = this.inLobby(client);
    const session = inLobby ? this.session : this.playing(client);
    if (!session) return;
    const current = session.playerPosition(client.sessionId);
    if (!current) return;

    const targetRoomId = payload.roomId ?? current.roomId;
    if (inLobby && targetRoomId !== current.roomId) {
      this.fail(
        client,
        GAME_ERRORS.roomLocked,
        "Desde la sala de espera se entra al mapa al empezar.",
      );
      return;
    }
    if (targetRoomId !== current.roomId) {
      this.handleRoomChange(client, session, current, targetRoomId);
      return;
    }

    const roomDef = this.roomPackage.map.rooms.find((room) => room.id === current.roomId);
    if (!roomDef) {
      this.fail(client, GAME_ERRORS.invalidState, "Habitación actual inválida.");
      return;
    }
    const grid = roomDef.grid;
    const result = validateMove(current, payload, {
      maxDistance: GAME_MAX_STEP,
      bounds: { minX: 0, minY: 0, maxX: grid.cols - 1, maxY: grid.rows - 1 },
    });
    if (!result.ok) {
      this.fail(client, result.error, "Movimiento rechazado por el servidor.");
      return;
    }
    const moved = session.movePlayer(
      client.sessionId,
      current.roomId,
      result.position.x,
      result.position.y,
      this.logicalNow(),
    );
    this.publish(moved.engine);
  }

  /**
   * Cruce de habitación: el jugador debe estar junto a una puerta **abierta**
   * que conecte ambas; aparece en un punto de spawn de la nueva habitación.
   */
  private handleRoomChange(
    client: Client,
    session: RoomSession,
    current: { roomId: string; x: number; y: number },
    targetRoomId: string,
  ): void {
    // C-6: una conexión entre dos habitaciones puede declararse desde
    // cualquiera de los dos lados (`canEnterRoom`, en `shared`, ya la trata
    // como bidireccional); si solo se buscaba la puerta declarada en la
    // habitación de SALIDA, cruzar en el sentido contrario no exigía
    // distancia alguna (bastaba con `canEnterRoom` == puerta abierta).
    const door =
      this.roomPackage.objects.find(
        (object) => object.roomId === current.roomId && object.leadsTo === targetRoomId,
      ) ??
      this.roomPackage.objects.find(
        (object) => object.roomId === targetRoomId && object.leadsTo === current.roomId,
      );
    const nearDoor = door === undefined || distance(current, door.position) <= GAME_DOOR_REACH;
    if (!nearDoor || !session.canEnterRoom(current.roomId, targetRoomId)) {
      this.fail(client, GAME_ERRORS.roomLocked, "La puerta está cerrada o demasiado lejos.");
      return;
    }
    const target = this.roomPackage.map.rooms.find((room) => room.id === targetRoomId);
    if (!target) {
      this.fail(client, GAME_ERRORS.invalidState, "Habitación destino inválida.");
      return;
    }
    const index = [...this.state.players.values()].filter((p) => p.roomId === targetRoomId).length;
    const spawn = target.spawnPoints[index % Math.max(1, target.spawnPoints.length)] ?? {
      x: 0,
      y: 0,
    };
    const moved = session.movePlayer(
      client.sessionId,
      targetRoomId,
      spawn.x,
      spawn.y,
      this.logicalNow(),
    );
    this.publish(moved.engine);
  }

  private handleInteract(client: Client, payload: z.infer<typeof objectPayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const result = session.interact(payload.objectId, this.logicalNow(), client.sessionId);
    if (result.rejected) {
      this.fail(client, GAME_ERRORS.notAvailable, rejectionMessage(result.rejected));
      return;
    }
    this.publish(result.engine);
  }

  private handleUseItem(client: Client, payload: z.infer<typeof useItemPayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const result = session.useItemOnObject(
      payload.itemId,
      payload.objectId,
      this.logicalNow(),
      client.sessionId,
    );
    if (result.rejected) {
      this.fail(client, GAME_ERRORS.notAvailable, rejectionMessage(result.rejected));
      return;
    }
    this.publish(result.engine);
  }

  private handleCombine(client: Client, payload: z.infer<typeof combinePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const puzzle =
      this.roomPackage.puzzles.find(
        (candidate) =>
          candidate.type === "combine_items" &&
          (payload.puzzleId === undefined || candidate.id === payload.puzzleId),
      ) ?? null;
    if (!puzzle) {
      this.fail(client, GAME_ERRORS.notAvailable, "No hay recetas en esta sala.");
      return;
    }
    const combined = session.combine(
      puzzle.id,
      payload.inputs,
      this.logicalNow(),
      client.sessionId,
    );
    client.send(GAME_MESSAGES.attemptResult, {
      puzzleId: puzzle.id,
      ok: combined.result.outcome === "combined",
      outcome: combined.result.outcome,
      ...(combined.result.outcome === "combined" ? { output: combined.result.output } : {}),
    });
    this.publish(combined.engine);
  }

  private handleOpen(client: Client, payload: z.infer<typeof puzzlePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const puzzle = this.accessiblePuzzle(client, session, payload.puzzleId);
    if (!puzzle) return;
    if (session.puzzleState(puzzle.id) === "locked") {
      this.fail(client, GAME_ERRORS.notAvailable, "El puzzle aún está bloqueado.");
      return;
    }
    this.openPanels.get(client.sessionId)?.add(puzzle.id);
    const view = session.puzzleView(puzzle.id, client.sessionId);
    client.send(GAME_MESSAGES.puzzleView, { puzzleId: puzzle.id, view });
    this.markPanelSent(client.sessionId, puzzle.id, JSON.stringify(view));
  }

  private handleAttempt(client: Client, payload: z.infer<typeof attemptPayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const puzzle = this.accessiblePuzzle(client, session, payload.puzzleId);
    if (!puzzle) return;

    const now = this.logicalNow();
    const actor = client.sessionId;
    const outcome = this.runAttempt(session, puzzle, payload.attempt, now, actor);
    if (!outcome) {
      this.fail(client, GAME_ERRORS.invalidState, "Intento con forma inválida para este puzzle.");
      return;
    }

    const ok = OK_OUTCOMES.has(outcome.outcome);
    client.send(GAME_MESSAGES.attemptResult, {
      puzzleId: puzzle.id,
      ok,
      outcome: outcome.outcome,
      ...(ok ? {} : { error: ATTEMPT_ERRORS[outcome.outcome] ?? outcome.outcome }),
      ...(outcome.retryAfterSec !== undefined ? { retryAfterSec: outcome.retryAfterSec } : {}),
      ...(outcome.revealedSymbol ? { revealedSymbol: outcome.revealedSymbol } : {}),
    });
    this.publish(outcome.engine);
  }

  /** Despacha el `attempt` a la plantilla del puzzle; `null` si la forma no encaja. */
  private runAttempt(
    session: RoomSession,
    puzzle: PuzzleDefinition,
    attempt: unknown,
    now: number,
    actor: string,
  ):
    | (RoomPuzzleActionResult<string> & { retryAfterSec?: number; revealedSymbol?: string | null })
    | null {
    switch (puzzle.type) {
      case "hidden_key":
        return session.revealHiddenKey(puzzle.id, now, actor);
      case "code_lock": {
        const parsed = codeAttempt.safeParse(attempt);
        if (!parsed.success) return null;
        const result = session.attemptCode(puzzle.id, parsed.data.code, now, actor);
        return {
          outcome: result.outcome,
          engine: result.engine,
          ...(result.lockedUntil !== null
            ? { retryAfterSec: Math.max(0, Math.ceil((result.lockedUntil - now) / 1000)) }
            : {}),
        };
      }
      case "sliding_puzzle": {
        const parsed = slidingAttempt.safeParse(attempt);
        if (!parsed.success) return null;
        return session.moveSlidingTile(puzzle.id, parsed.data.move, now, actor);
      }
      case "memory": {
        const parsed = memoryAttempt.safeParse(attempt);
        if (!parsed.success) return null;
        return session.flipMemoryCard(puzzle.id, parsed.data.flip, now, actor);
      }
      case "pipes": {
        const parsed = pipesAttempt.safeParse(attempt);
        if (!parsed.success) return null;
        return "gate" in parsed.data
          ? session.openPipesGate(puzzle.id, parsed.data.gate, now, actor)
          : session.rotatePipe(puzzle.id, parsed.data.rotate, now, actor, parsed.data.turns ?? 1);
      }
      case "split_clue": {
        const parsed = splitAttempt.safeParse(attempt);
        if (!parsed.success) return null;
        const input = "symbols" in parsed.data ? parsed.data.symbols : parsed.data.code;
        return session.submitSplitClue(puzzle.id, input, now, actor);
      }
      // `combine_items` usa `combine`; `simultaneous_plates`, `plate_state` (specs/11 §5).
      case "combine_items":
      case "simultaneous_plates":
        return null;
    }
  }

  private handlePlate(client: Client, payload: z.infer<typeof platePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const puzzle = this.roomPackage.puzzles.find(
      (candidate) =>
        candidate.type === "simultaneous_plates" &&
        (payload.puzzleId === undefined || candidate.id === payload.puzzleId) &&
        candidate.plates.some((plate) => plate.objectId === payload.plateId),
    );
    if (!puzzle) {
      this.fail(client, GAME_ERRORS.notAvailable, "Esa placa no existe.");
      return;
    }
    const result = session.setPlate(
      puzzle.id,
      payload.plateId,
      payload.active,
      this.logicalNow(),
      client.sessionId,
    );
    client.send(GAME_MESSAGES.attemptResult, {
      puzzleId: puzzle.id,
      ok: OK_OUTCOMES.has(result.outcome),
      outcome: result.outcome,
    });
    this.publish(result.engine);
  }

  /**
   * `split_view` (specs/11 §4.3): el servidor calcula qué fragmentos ve **este**
   * jugador según su posición (mirilla) y solo se los envía a él.
   */
  private handleSplitView(client: Client, payload: z.infer<typeof optionalPuzzlePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const position = session.playerPosition(client.sessionId);
    const puzzle = this.roomPackage.puzzles.find(
      (candidate) =>
        candidate.type === "split_clue" &&
        (payload.puzzleId === undefined
          ? candidate.roomId === position?.roomId
          : candidate.id === payload.puzzleId),
    );
    if (!puzzle || puzzle.type !== "split_clue") {
      this.fail(client, GAME_ERRORS.notAvailable, "No hay ninguna pista repartida aquí.");
      return;
    }
    const view = session.splitClueView(puzzle.id, client.sessionId);
    client.send(GAME_MESSAGES.splitFragments, {
      puzzleId: puzzle.id,
      viewpointId: view.viewpointId || null,
      fragments:
        view.viewpointId || view.bridged
          ? visibleFragmentsByIndex(puzzle, view.viewpointId, view.bridged)
          : {},
    });
  }

  private handleHint(client: Client, payload: z.infer<typeof puzzlePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    // C-7: sin esto se leían pistas de puzzles `locked` de fases posteriores
    // (fuera de la habitación del jugador) y se quemaban pistas de puzzles
    // `solved` (ya no hace falta ninguna).
    const puzzle = this.accessiblePuzzle(client, session, payload.puzzleId);
    if (!puzzle) return;
    const state = session.puzzleState(puzzle.id);
    if (state === "locked" || state === "solved") {
      this.fail(client, GAME_ERRORS.notAvailable, "Ese puzzle no admite pistas ahora.");
      return;
    }
    const result = session.requestHint(payload.puzzleId);
    if (!result.ok) {
      this.fail(client, GAME_ERRORS.notAvailable, result.error.code);
      return;
    }
    const view = session.hintView();
    const delivered = view.puzzles
      .find((entry) => entry.puzzleId === payload.puzzleId)
      ?.hints.at(-1);
    client.send(GAME_MESSAGES.hintDelivered, {
      puzzleId: payload.puzzleId,
      tier: delivered?.tier ?? null,
      text: delivered?.text ?? null,
    });
    this.onMilestone({
      kind: "hint_used",
      puzzleId: payload.puzzleId,
      actorId: client.sessionId,
      ...this.milestoneClock(),
    });
    this.syncState();
  }

  private handleTick(): void {
    // El reloj no corre hasta que el primer jugador entra al mapa.
    if (!this.session || !this.session.state.flags.game_started) return;
    this.publish(this.session.tick(this.logicalNow()), { fromTick: true });
  }

  // — Sincronización ——————————————————————————————————————————————

  /** Crea la sesión con el primer jugador como principal (el motor lo siembra). */
  protected ensureSession(firstPlayerId: string): RoomSession {
    this.session ??= createRoomSession(this.roomPackage, {
      playerId: firstPlayerId,
      playerIds: [firstPlayerId],
      timeLimitSec: this.timeLimitSeconds(),
      now: this.logicalNow(),
      // Reparto del `memory` (y mezclas `random`) distinto en cada partida.
      rng: (puzzleId) => createSlidingRng(this.seed ^ hashId(puzzleId)),
    });
    return this.session;
  }

  /**
   * Límite de partida en segundos, `undefined` = sin duración (ticket
   * duración-salas, specs/04 §6): resuelto de `meta.timeLimitMinutes` de la
   * sala (retrocompatible: ausente → `DEFAULT_ROOM_TIME_LIMIT_MINUTES`,
   * `null` → sin duración). `EventRoom` lo sobrescribe para aplicar el
   * override del organizador por encima de este valor.
   */
  protected timeLimitSeconds(): number | undefined {
    return resolveRoomTimeLimitSec(this.roomPackage.meta);
  }

  /**
   * Difunde los efectos del motor y refleja el estado en el room state.
   * `fromTick` (C-9): el tick de simulación (250 ms) nunca fuerza
   * `state.clock` a todos los clientes — se sincroniza como mucho 1 vez por
   * segundo salvo que la llamada venga de un mensaje real (reacción inmediata).
   */
  private publish(
    result: EngineResult | null | undefined,
    opts: { fromTick?: boolean } = {},
  ): void {
    if (result) {
      for (const effect of result.effects) {
        switch (effect.type) {
          case "show_dialog":
            this.broadcast(GAME_MESSAGES.dialogShow, { dialogId: effect.dialogId });
            break;
          case "show_image":
            this.broadcast(GAME_MESSAGES.imageShow, {
              image: effect.image,
              ...(effect.caption
                ? {
                    caption: resolveLocalizedText(
                      effect.caption,
                      this.roomPackage.meta.defaultLanguage,
                    ),
                  }
                : {}),
            });
            break;
          case "set_object_state":
            this.broadcast(GAME_MESSAGES.objectStateChanged, {
              objectId: effect.objectId,
              state: effect.state,
            });
            if (effect.state === "open") this.doorOpened(effect.objectId);
            break;
          case "unlock_door":
            this.broadcast(GAME_MESSAGES.objectStateChanged, {
              objectId: effect.objectId,
              state: "open",
            });
            this.doorOpened(effect.objectId);
            break;
          case "grant_item":
            this.broadcast(GAME_MESSAGES.itemGranted, {
              playerId: effect.playerId,
              itemId: effect.itemId,
            });
            break;
          default:
            break;
        }
      }
      for (const event of result.events) {
        if (event.type !== "on_puzzle_solved") continue;
        const def = this.session?.getPuzzleDefinition(event.puzzleId);
        this.broadcast(GAME_MESSAGES.puzzleSolved, {
          puzzleId: event.puzzleId,
          solvedBy: event.playerId ?? null,
          grantsItems: def?.grantsItems ?? [],
          unlocks: def?.unlocks ?? [],
        });
        this.onMilestone({
          kind: "solved",
          puzzleId: event.puzzleId,
          actorId: event.playerId ?? null,
          ...this.milestoneClock(),
        });
      }
    }
    this.syncState({ forceClock: !opts.fromTick });
    this.refreshOpenPanels();
    this.announceEnd();
  }

  /** Hito de puerta abierta: solo objetos que llevan a otra habitación. */
  private doorOpened(objectId: string): void {
    const door = this.session?.getObjectDefinition(objectId);
    if (!door?.leadsTo) return;
    this.onMilestone({ kind: "door_opened", objectId, actorId: null, ...this.milestoneClock() });
  }

  /**
   * `forceClock` (C-9): fuera de una llamada desde un mensaje, `state.clock`
   * solo se sincroniza como mucho 1 vez por segundo — evita un patch de
   * Colyseus a todos los clientes en cada tick de 250 ms solo por el reloj.
   */
  private syncState(opts: { forceClock?: boolean } = {}): void {
    const session = this.session;
    if (!session) return;
    const game = session.state;
    const now = this.logicalNow();
    if (opts.forceClock || now - this.lastClockSyncAt >= 1000) {
      this.state.clock = now;
      this.lastClockSyncAt = now;
    }
    this.state.phase = game.phase === "lobby" && this.launched ? "starting" : game.phase;
    this.state.result = game.result ?? "";
    this.state.startedAt = game.flags.game_started ? game.startedAt : 0;
    this.state.endsAt =
      game.flags.game_started && game.timeLimitSec !== undefined
        ? game.startedAt + game.timeLimitSec * 1000
        : 0;

    for (const [objectId, objectState] of Object.entries(game.objectStates)) {
      if (this.state.objects.get(objectId) !== objectState) {
        this.state.objects.set(objectId, objectState);
      }
    }
    for (const [puzzleId, runtime] of Object.entries(game.puzzleStates)) {
      let puzzle = this.state.puzzles.get(puzzleId);
      if (!puzzle) {
        puzzle = new GamePuzzleState();
        this.state.puzzles.set(puzzleId, puzzle);
      }
      const solvedBy = runtime.solvedBy ?? "";
      if (
        puzzle.state !== runtime.state ||
        puzzle.attempts !== runtime.attempts ||
        puzzle.solvedBy !== solvedBy
      ) {
        puzzle.state = runtime.state;
        puzzle.attempts = runtime.attempts;
        puzzle.solvedBy = solvedBy;
      }
    }
    for (const [playerId, items] of Object.entries(game.inventory)) {
      if (!this.state.players.has(playerId)) continue;
      let inventory = this.state.inventories.get(playerId);
      if (!inventory) {
        inventory = new GameInventoryState();
        this.state.inventories.set(playerId, inventory);
      }
      if (inventory.items.join("\u0000") !== items.join("\u0000")) {
        inventory.items.clear();
        inventory.items.push(...items);
      }
    }
    for (const [flag, value] of Object.entries(game.flags)) {
      if (flag === "time_remaining") continue; // cambia cada tick; el cliente usa `endsAt`.
      if (this.flagMirror.get(flag) === value) continue; // evita `JSON.stringify` si no cambió.
      this.flagMirror.set(flag, value);
      this.state.flags.set(flag, JSON.stringify(value));
    }
    this.state.players.forEach((player, playerId) => {
      const position = session.playerPosition(playerId);
      if (!position) return;
      player.x = position.x;
      player.y = position.y;
      player.roomId = position.roomId;
    });
  }

  /**
   * C-9 (revisión de la PR #163): la vista de un panel abierto solo se
   * reenvía si su CONTENIDO cambió desde el último envío a ESE cliente —
   * `puzzleView` depende de la plantilla completa (posición de fichas,
   * cartas levantadas, rotación de tuberías, ventana de simultaneidad,
   * posición del jugador en `split_clue`…), no solo de la proyección pública
   * (`state`/`attempts`/`solvedBy`), así que comparar por esa proyección
   * dejaba a un segundo jugador con el panel abierto sin ver los cambios del
   * primero hasta que el puzzle cambiara de estado. Se sigue recalculando
   * (y, si no cambió, sin mandar nada) en vez de mandar sin condición en cada
   * tick de 250 ms; el coste de `puzzleView` es pequeño y solo se paga por
   * los paneles realmente abiertos.
   */
  private refreshOpenPanels(): void {
    const session = this.session;
    if (!session) return;
    for (const client of this.clients) {
      const openPuzzles = this.openPanels.get(client.sessionId);
      if (!openPuzzles || openPuzzles.size === 0) continue;
      for (const puzzleId of openPuzzles) {
        const view = session.puzzleView(puzzleId, client.sessionId);
        const serialized = JSON.stringify(view);
        if (this.sentPanelViews.get(client.sessionId)?.get(puzzleId) === serialized) continue;
        client.send(GAME_MESSAGES.puzzleView, { puzzleId, view });
        this.markPanelSent(client.sessionId, puzzleId, serialized);
      }
    }
  }

  private markPanelSent(sessionId: string, puzzleId: string, serializedView: string): void {
    let sent = this.sentPanelViews.get(sessionId);
    if (!sent) {
      sent = new Map();
      this.sentPanelViews.set(sessionId, sent);
    }
    sent.set(puzzleId, serializedView);
  }

  private announceEnd(): void {
    const session = this.session;
    if (this.ended || !session?.ended) return;
    this.ended = true;
    const summary = session.summary(this.logicalNow());
    this.broadcast(GAME_MESSAGES.gameEnded, {
      result: session.state.result,
      stats: summary?.stats ?? null,
    });
    this.onMilestone({
      kind: "game_ended",
      result: toSessionResult(session.state.result) ?? "aborted",
      ...this.milestoneClock(),
    });
    // Fin de partida y cierre (specs/11 §8.1, ajuste de producto): ya no se
    // puede reconectar para seguir jugando —se rechazan todas las
    // reconexiones pendientes—, y la room se mantiene un margen para la
    // pantalla de resultados antes de desconectar a todos y destruirse.
    for (const reservation of this.pendingReconnections.values())
      reservation.reject(new Error("game_ended"));
    this.pendingReconnections.clear();
    for (const timer of this.hostReassignTimers.values()) timer.clear();
    this.hostReassignTimers.clear();
    this.clock.setTimeout(() => {
      this.disconnect().catch((err: unknown) => {
        logger.warn(
          { err, roomId: this.roomId },
          "game-room: fallo al cerrar la room tras los resultados",
        );
      });
    }, this.resultsRoomLifetimeSeconds() * 1000);
  }

  // — Utilidades ——————————————————————————————————————————————————

  /** Reloj lógico de la sala (ms desde su creación). */
  private logicalNow(): number {
    return Date.now() - this.createdAt;
  }

  /** La sesión si la partida está en juego; si no, responde el error y devuelve `undefined`. */
  private playing(client: Client): RoomSession | undefined {
    const player = this.state.players.get(client.sessionId);
    if (!this.session || this.state.phase !== "playing" || !player?.inMap) {
      this.fail(client, GAME_ERRORS.invalidState, "La partida no está en juego.");
      return undefined;
    }
    return this.session;
  }

  /** ¿Está el jugador en la sala de espera (aún sin entrar al mapa) de una partida sin terminar? */
  private inLobby(client: Client): boolean {
    const player = this.state.players.get(client.sessionId);
    return Boolean(this.session && player && !player.inMap && !this.ended && !this.session.ended);
  }

  /** Puzzle de la habitación del jugador (no se juega un panel de otra sala). */
  private accessiblePuzzle(
    client: Client,
    session: RoomSession,
    puzzleId: string,
  ): PuzzleDefinition | undefined {
    const puzzle = session.getPuzzleDefinition(puzzleId);
    if (!puzzle) {
      this.fail(client, GAME_ERRORS.notAvailable, "Ese puzzle no existe.");
      return undefined;
    }
    const position = session.playerPosition(client.sessionId);
    // `combine_items` es el inventario: se usa desde cualquier sala.
    if (puzzle.type !== "combine_items" && position?.roomId !== puzzle.roomId) {
      this.fail(client, GAME_ERRORS.notAvailable, "Ese puzzle está en otra habitación.");
      return undefined;
    }
    return puzzle;
  }

  private withPayload<T>(
    client: Client,
    schema: z.ZodType<T>,
    payload: unknown,
    handler: (data: T) => void,
  ): void {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      this.fail(client, GAME_ERRORS.invalidState, "Mensaje con forma inválida.");
      return;
    }
    handler(parsed.data);
  }

  private fail(client: Client, code: string, message: string): void {
    client.send(ERROR_MESSAGE, { code, message });
  }

  /**
   * Un cliente sin permiso (observador) que sigue enviando mensajes (C-8): se
   * le sigue avisando `PERMISSION_DENIED` (ya cuenta contra su cuota del rate
   * limiter, que corta el ruido a velocidad de línea), pero si se acumulan
   * `OBSERVER_DENIAL_KICK_LIMIT` rechazos en `OBSERVER_DENIAL_WINDOW_MS`
   * (una ráfaga, no un observador que prueba unas pocas cosas a lo largo de
   * la partida) se le corta la conexión.
   */
  private notePermissionDenied(client: Client): void {
    this.fail(client, GAME_ERRORS.permissionDenied, "Un observador no puede actuar.");
    const now = Date.now();
    const state = this.deniedActions.get(client.sessionId);
    if (!state || now - state.windowStart > OBSERVER_DENIAL_WINDOW_MS) {
      this.deniedActions.set(client.sessionId, { count: 1, windowStart: now });
      return;
    }
    state.count += 1;
    if (state.count >= OBSERVER_DENIAL_KICK_LIMIT) {
      this.deniedActions.delete(client.sessionId);
      client.leave(OBSERVER_KICK_CLOSE_CODE);
    }
  }
}

/** Formato invisible/de control (zero-width, marcas direccionales…): specs/26 C-18. */
const INVISIBLE_FORMAT_CHARS = /\p{Cf}/gu;

/**
 * C-18: reutiliza `sanitizeChatText` (HTML, caracteres de control, espacios)
 * y además quita el formato invisible (`\p{Cf}`: zero-width space/joiner,
 * marcas direccionales…) que aquella no cubre — un nombre hecho enteramente
 * de esos caracteres se veía vacío pero pasaba el `.trim()`.
 */
function sanitizeName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  // `sanitizeChatText` quita las etiquetas COMPLETAS (`<b>…</b>`); el
  // `[<>]` suelto es solo para lo que quede sin cerrar (`<script`).
  const clean = sanitizeChatText(name)
    .replace(/[<>]/g, "")
    .replace(INVISIBLE_FORMAT_CHARS, "")
    .trim()
    .slice(0, 32);
  return clean.length > 0 ? clean : undefined;
}

function rejectionMessage(rejection: string): string {
  switch (rejection) {
    case "wrong_room":
      return "Ese objeto está en otra habitación.";
    case "missing_item":
      return "No tienes ese objeto.";
    default:
      return "La partida ha terminado.";
  }
}

/** Hash FNV-1a de 32 bits (semilla por puzzle a partir de la de la sala). */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
