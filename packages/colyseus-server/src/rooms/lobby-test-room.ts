import { randomUUID } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import { z } from "zod";
import {
  ChatPayloadSchema,
  checkChatRateLimit,
  CHAT_RATE_LIMIT_EMPTY,
  filterChatText,
  type ChatRateLimitState,
} from "@escaperoom/shared/chat";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_INVALID_PAYLOAD_ERROR,
  CHAT_MAX_LENGTH,
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
  ERROR_MESSAGE,
  MAX_PLAYERS,
  MAX_STEP_PER_TICK,
  MOVE_MESSAGE,
  WORLD_BOUNDS,
} from "../constants.js";
import { MEDIA_TOKEN_REQUEST_MESSAGE, sendMediaTokenToClient } from "../media/index.js";
import { MOVE_TOO_FAST, validateMove, type MoveLimits } from "../movement.js";
import { ChatMessageState, LobbyState, PlayerState } from "../schema/lobby-state.js";
import { pickPlayerTint } from "../tints.js";

/** Payload de `move` (specs/11 §4.2). El servidor valida el tipo antes de usarlo. */
const movePayload = z.object({
  x: z.number(),
  y: z.number(),
});

const MOVE_LIMITS: MoveLimits = {
  maxDistance: MAX_STEP_PER_TICK,
  bounds: WORLD_BOUNDS,
};

/** Posiciones de aparición dentro del grid de prueba (se reutilizan en bucle). */
const SPAWN_POINTS = [
  { x: 4, y: 4 },
  { x: 5, y: 4 },
  { x: 4, y: 5 },
  { x: 5, y: 5 },
  { x: 3, y: 4 },
  { x: 6, y: 5 },
  { x: 4, y: 3 },
  { x: 5, y: 6 },
] as const;

/**
 * Room de prueba `lobby_test`: estado autoritativo de jugadores y validación de
 * movimiento con rechazo de teletransporte (ticket 0.5, specs/11 §3–4).
 *
 * También integra el módulo de medios (ticket 2.2): al pedir `request_media_token`
 * firma un token LiveKit para la room derivada de `this.roomId` (specs/12 §1).
 * movimiento con rechazo de teletransporte (ticket 0.5, specs/11 §3–4), más el
 * chat en partida (ticket 2.1, specs/11 §4.4 y §9; specs/17 §3).
 */
export class LobbyTestRoom extends Room<{ state: LobbyState }> {
  override maxClients = MAX_PLAYERS;

  /** Estado del rate limit de chat por jugador (`sessionId` → ventana). */
  private readonly chatRateLimits = new Map<string, ChatRateLimitState>();

  override onCreate(): void {
    this.state = new LobbyState();

    this.onMessage(MOVE_MESSAGE, movePayload, (client, payload) => {
      this.handleMove(client, payload);
    });

    this.onMessage(MEDIA_TOKEN_REQUEST_MESSAGE, (client, payload) => {
      void sendMediaTokenToClient(client, this.roomId, payload);
    });

    this.onMessage(CHAT_MESSAGE, (client, payload) => {
      this.handleChat(client, payload);
    });
  }

  override onJoin(client: Client): void {
    const index = this.state.players.size;
    const spawn = SPAWN_POINTS[index % SPAWN_POINTS.length]!;

    const usedTints: string[] = [];
    this.state.players.forEach((player) => usedTints.push(player.tint));

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = `Jugador ${index + 1}`;
    player.x = spawn.x;
    player.y = spawn.y;
    player.tint = pickPlayerTint(usedTints);

    this.state.players.set(client.sessionId, player);
    this.chatRateLimits.set(client.sessionId, CHAT_RATE_LIMIT_EMPTY);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.chatRateLimits.delete(client.sessionId);
  }

  /** Valida y aplica (o rechaza) un movimiento pedido por un cliente. */
  private handleMove(client: Client, payload: { x: number; y: number }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    const result = validateMove({ x: player.x, y: player.y }, payload, MOVE_LIMITS);
    if (!result.ok) {
      client.send(ERROR_MESSAGE, {
        code: result.error,
        message:
          result.error === MOVE_TOO_FAST
            ? "Movimiento rechazado: el salto supera la distancia máxima por tick."
            : "Movimiento rechazado: posición fuera del grid.",
      });
      return;
    }

    player.x = result.position.x;
    player.y = result.position.y;
  }

  /**
   * Procesa un mensaje de chat: rate limit (2/s), validación de payload, filtro
   * de lenguaje y difusión con ventana móvil de 50 (specs/11 §4.4, §9). El
   * texto se censura y se marca `filtered`; nunca se difunde el original.
   */
  private handleChat(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    const now = Date.now();
    const rate = checkChatRateLimit(
      this.chatRateLimits.get(client.sessionId) ?? CHAT_RATE_LIMIT_EMPTY,
      now,
    );
    if (!rate.ok) {
      client.send(ERROR_MESSAGE, {
        code: CHAT_RATE_LIMITED_ERROR,
        message: `Demasiados mensajes: espera ${rate.retryAfterMs} ms antes de volver a escribir.`,
        retryAfterMs: rate.retryAfterMs,
      });
      return;
    }
    this.chatRateLimits.set(client.sessionId, rate.state);

    const parsed = ChatPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      client.send(ERROR_MESSAGE, {
        code: CHAT_INVALID_PAYLOAD_ERROR,
        message: `Mensaje inválido: se espera texto de 1 a ${CHAT_MAX_LENGTH} caracteres.`,
      });
      return;
    }

    const filtered = filterChatText(parsed.data.text);
    if (!filtered.text) {
      client.send(ERROR_MESSAGE, {
        code: CHAT_INVALID_PAYLOAD_ERROR,
        message: "Mensaje inválido: el texto está vacío tras desinfectarlo.",
      });
      return;
    }

    const message = new ChatMessageState();
    message.id = randomUUID();
    message.authorId = client.sessionId;
    message.authorName = player.name;
    message.text = filtered.text;
    message.ts = now;
    message.filtered = filtered.filtered;

    this.state.chat.push(message);
    while (this.state.chat.length > CHAT_HISTORY_LIMIT) {
      this.state.chat.shift();
    }
  }
}
