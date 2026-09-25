import { randomInt } from "node:crypto";
import { Room, ServerError, type Client } from "@colyseus/core";
import { z } from "zod";
import { logger } from "@escaperoom/kit/logger";
import type { EngineResult } from "@escaperoom/shared/engine";
import {
  readGameAccessTokenConfig,
  verifyGameAccessToken,
  type GameAccessClaims,
  type GameAccessTokenError,
} from "@escaperoom/shared/game-access-token";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
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
  CHAT_MESSAGE,
  ERROR_MESSAGE,
  GAME_DOOR_REACH,
  GAME_ERRORS,
  GAME_MAX_STEP,
  GAME_MESSAGES,
  GAME_TICK_MS,
  GAME_TIME_LIMIT_SEC,
  MAX_PLAYERS,
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
  /** `purchase.playSessionStartedAt` ya estaba fijado: la partida ya se jugó. */
  playSessionUsed: "PLAY_SESSION_ALREADY_USED",
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
  | ({ kind: "solved" | "hint_used"; puzzleId: string; actorId: string | null } & GameMilestoneClock)
  | ({ kind: "door_opened"; objectId: string; actorId: string | null } & GameMilestoneClock)
  | ({ kind: "game_ended"; result: SessionResult } & GameMilestoneClock);

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

  private roomPackage!: RoomPackage;
  private session?: RoomSession;
  private createdAt = 0;
  private seed = 0;
  private ended = false;
  /** Paneles abiertos por jugador: tras cada acción se les reenvía la vista. */
  private readonly openPanels = new Map<string, Set<string>>();
  /** Chat de la partida (specs/11 §4.4): en cualquier fase, también en el lobby. */
  private readonly chat = new RoomChat();
  /** Rate limit por mensaje y jugador (specs/11 §9); `undefined` = apagado. */
  private messageLimiter?: MessageRateLimiter;
  /** Rechazos de un observador dentro de la ventana (C-8): tras el tope, se le corta. */
  private readonly deniedActions = new Map<string, { count: number; windowStart: number }>();
  /** Claims del `gameToken` que autorizó crear esta room (C-4/B-4); ausente en Playtest/Event. */
  protected gameAccess?: GameAccessClaims;
  /** Paquete resuelto por una compra B2C (B-4): pisa `resolveRoomPackage(options.packageId)`. */
  private purchasedRoomPackage?: RoomPackage;

  override async onCreate(options: GameRoomOptions = {}): Promise<void> {
    if (this.requiresGameAccessToken()) {
      await this.authorizeGameAccessCreate(options);
    }
    const roomPackage = this.loadRoomPackage(options);
    this.roomPackage = roomPackage;
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
        handler(client, payload);
      });
    on(GAME_MESSAGES.startGame, (client) => this.handleStart(client));
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
  }

  /**
   * Límites por mensaje de la room (specs/11 §9). `null` los apaga; por
   * defecto salen de `GAME_MESSAGE_RATE_LIMIT` (ver `readGameMessageRateLimits`).
   */
  protected messageRateLimits(): GameMessageRateLimits | null {
    return readGameMessageRateLimits();
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
   * reclama su única partida (`GameAccessStore.claimPlaySession`, escritura
   * condicional `IS NULL`: specs/02, "una compra = una partida"). Rechaza con
   * `ServerError` (nunca un stack trace, specs/11 §7) si el token falta, es
   * inválido, es una partida de prueba fuera de un entorno que la permita, o
   * la compra ya se jugó. Deja `this.gameAccess`/`this.purchasedRoomPackage`
   * listos para `onAuth`/`loadRoomPackage`.
   */
  private async authorizeGameAccessCreate(options: GameRoomOptions): Promise<void> {
    const config = readGameAccessTokenConfig();
    if (!config) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.missing);
    }
    const verified = verifyGameAccessToken(config.secret, options.gameToken);
    if (!verified.ok) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERROR_BY_TOKEN_ERROR[verified.error]);
    }
    this.gameAccess = verified.claims;
    if (verified.claims.kind === "dev_test") {
      if (!devTestGameTokenAllowed()) {
        throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.devTestForbidden);
      }
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
  override onAuth(_client: Client, options: GameRoomOptions = {}): unknown {
    if (!this.requiresGameAccessToken()) return true;
    const config = readGameAccessTokenConfig();
    if (!config) throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERRORS.missing);
    const verified = verifyGameAccessToken(config.secret, options.gameToken);
    if (!verified.ok) {
      throw new ServerError(GAME_ACCESS_FORBIDDEN_CODE, GAME_ACCESS_ERROR_BY_TOKEN_ERROR[verified.error]);
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
    if (this.gameAccess?.kind !== "purchase" || this.gameAccess.purchaseId !== verified.claims.purchaseId) {
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
   * Gancho de hitos (ticket 5.12): no hace nada en la `GameRoom`; la
   * `EventRoom` lo sobrescribe para persistirlos. Se llama de forma síncrona
   * desde el bucle de juego, así que quien lo implemente no debe bloquear.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- punto de extensión
  protected onMilestone(milestone: GameMilestone): void {}

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
    startedAt: number | null;
    endedAt: number | null;
    elapsedMs: number;
  } {
    const game = this.session?.state;
    const now = this.logicalNow();
    const started = Boolean(game?.flags.game_started);
    const endedAt = started && game?.endedAt !== undefined ? game.endedAt : null;
    let players = 0;
    this.state.players.forEach((player) => {
      if (player.connected) players += 1;
    });
    return {
      phase: (LIVE_PHASES as readonly string[]).includes(this.state.phase)
        ? (this.state.phase as LivePhase)
        : "lobby",
      result: toSessionResult(game?.result) ?? null,
      puzzlesSolved: game ? solvedPuzzleIds(game).length : 0,
      puzzlesTotal: this.roomPackage.puzzles.length,
      hintsUsed: game ? Object.values(game.hintsUsed).reduce((sum, cost) => sum + cost, 0) : 0,
      players,
      startedAt: started && game ? this.createdAt + game.startedAt : null,
      endedAt: endedAt !== null ? this.createdAt + endedAt : null,
      elapsedMs: started && game ? Math.max(0, (endedAt ?? now) - game.startedAt) : 0,
    };
  }

  override onJoin(client: Client, options: GameJoinOptions = {}): void {
    const session = this.ensureSession(client.sessionId);
    const moved = session.spawnPlayer(client.sessionId, this.logicalNow());
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
    this.state.players.set(client.sessionId, player);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.openPanels.set(client.sessionId, new Set());
    this.chat.join(client.sessionId);

    this.publish(moved.engine);
  }

  override onLeave(client: Client): void {
    // El jugador conserva su inventario (puede llevar la llave de oro): solo se
    // marca desconectado. La reconexión con gracia es de fase 6.
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.openPanels.delete(client.sessionId);
    this.chat.leave(client.sessionId);
    this.messageLimiter?.forget(client.sessionId);
    this.deniedActions.delete(client.sessionId);
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
  }

  private handleStart(client: Client): void {
    if (client.sessionId !== this.state.hostId) {
      this.fail(
        client,
        GAME_ERRORS.permissionDenied,
        "Solo el anfitrión puede empezar la partida.",
      );
      return;
    }
    if (this.state.phase !== "lobby" || !this.session) {
      this.fail(client, GAME_ERRORS.invalidState, "La partida ya ha empezado.");
      return;
    }
    const started = this.session.start(this.logicalNow());
    if (this.session.state.flags.game_started) {
      this.onMilestone({ kind: "game_started", at: this.createdAt + this.session.state.startedAt });
    }
    this.publish(started);
  }

  private handleMove(client: Client, payload: z.infer<typeof movePayload>): void {
    const session = this.playing(client);
    if (!session) return;
    const current = session.playerPosition(client.sessionId);
    if (!current) return;

    const targetRoomId = payload.roomId ?? current.roomId;
    if (targetRoomId !== current.roomId) {
      this.handleRoomChange(client, session, current, targetRoomId);
      return;
    }

    const grid = this.roomPackage.map.rooms.find((room) => room.id === current.roomId)!.grid;
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
    // Desde el lado de la puerta hay que estar a su alcance; desde el otro lado
    // (la puerta vive en la habitación destino) no hay objeto con el que medir.
    const door = this.roomPackage.objects.find(
      (object) => object.roomId === current.roomId && object.leadsTo === targetRoomId,
    );
    const nearDoor = door === undefined || distance(current, door.position) <= GAME_DOOR_REACH;
    if (!nearDoor || !session.canEnterRoom(current.roomId, targetRoomId)) {
      this.fail(client, GAME_ERRORS.roomLocked, "La puerta está cerrada o demasiado lejos.");
      return;
    }
    const target = this.roomPackage.map.rooms.find((room) => room.id === targetRoomId)!;
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
    client.send(GAME_MESSAGES.puzzleView, {
      puzzleId: puzzle.id,
      view: session.puzzleView(puzzle.id, client.sessionId),
    });
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
    if (!this.session || this.state.phase === "lobby") return;
    this.publish(this.session.tick(this.logicalNow()));
  }

  // — Sincronización ——————————————————————————————————————————————

  /** Crea la sesión con el primer jugador como principal (el motor lo siembra). */
  private ensureSession(firstPlayerId: string): RoomSession {
    this.session ??= createRoomSession(this.roomPackage, {
      playerId: firstPlayerId,
      playerIds: [firstPlayerId],
      timeLimitSec: GAME_TIME_LIMIT_SEC,
      now: this.logicalNow(),
      // Reparto del `memory` (y mezclas `random`) distinto en cada partida.
      rng: (puzzleId) => createSlidingRng(this.seed ^ hashId(puzzleId)),
    });
    return this.session;
  }

  /** Difunde los efectos del motor y refleja el estado en el room state. */
  private publish(result: EngineResult | null | undefined): void {
    if (result) {
      for (const effect of result.effects) {
        switch (effect.type) {
          case "show_dialog":
            this.broadcast(GAME_MESSAGES.dialogShow, { dialogId: effect.dialogId });
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
        const def = this.roomPackage.puzzles.find((puzzle) => puzzle.id === event.puzzleId);
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
    this.syncState();
    this.refreshOpenPanels();
    this.announceEnd();
  }

  /** Hito de puerta abierta: solo objetos que llevan a otra habitación. */
  private doorOpened(objectId: string): void {
    const door = this.roomPackage.objects.find((object) => object.id === objectId);
    if (!door?.leadsTo) return;
    this.onMilestone({ kind: "door_opened", objectId, actorId: null, ...this.milestoneClock() });
  }

  private syncState(): void {
    const session = this.session;
    if (!session) return;
    const game = session.state;
    this.state.clock = this.logicalNow();
    this.state.phase = game.phase;
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
      puzzle.state = runtime.state;
      puzzle.attempts = runtime.attempts;
      puzzle.solvedBy = runtime.solvedBy ?? "";
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
      const encoded = JSON.stringify(value);
      if (this.state.flags.get(flag) !== encoded) this.state.flags.set(flag, encoded);
    }
    this.state.players.forEach((player, playerId) => {
      const position = session.playerPosition(playerId);
      if (!position) return;
      player.x = position.x;
      player.y = position.y;
      player.roomId = position.roomId;
    });
  }

  private refreshOpenPanels(): void {
    const session = this.session;
    if (!session) return;
    for (const client of this.clients) {
      for (const puzzleId of this.openPanels.get(client.sessionId) ?? []) {
        client.send(GAME_MESSAGES.puzzleView, {
          puzzleId,
          view: session.puzzleView(puzzleId, client.sessionId),
        });
      }
    }
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
  }

  // — Utilidades ——————————————————————————————————————————————————

  /** Reloj lógico de la sala (ms desde su creación). */
  private logicalNow(): number {
    return Date.now() - this.createdAt;
  }

  /** La sesión si la partida está en juego; si no, responde el error y devuelve `undefined`. */
  private playing(client: Client): RoomSession | undefined {
    if (!this.session || this.state.phase !== "playing") {
      this.fail(client, GAME_ERRORS.invalidState, "La partida no está en juego.");
      return undefined;
    }
    return this.session;
  }

  /** Puzzle de la habitación del jugador (no se juega un panel de otra sala). */
  private accessiblePuzzle(
    client: Client,
    session: RoomSession,
    puzzleId: string,
  ): PuzzleDefinition | undefined {
    const puzzle = this.roomPackage.puzzles.find((candidate) => candidate.id === puzzleId);
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

function sanitizeName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const clean = name.replace(/[<>]/g, "").trim().slice(0, 32);
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
