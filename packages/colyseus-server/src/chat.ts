import { randomUUID } from "node:crypto";
import type { ArraySchema } from "@colyseus/schema";
import type { Client } from "@colyseus/core";
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
  CHAT_RATE_LIMITED_ERROR,
  ERROR_MESSAGE,
} from "./constants.js";
import { ChatMessageState } from "./schema/lobby-state.js";

/**
 * Chat de una room (ticket 2.1, specs/11 §4.4 y §9; specs/17 §3): rate limit
 * (2/s) por jugador, validación de payload, filtro de lenguaje y difusión en
 * `state.chat` con ventana móvil de 50. El texto se censura y se marca
 * `filtered`; nunca se difunde el original.
 *
 * La usa la `GameRoom`, que según specs/11 §3 lleva `chat` en su estado.
 */
export class RoomChat {
  /** Estado del rate limit por jugador (`sessionId` → ventana). */
  private readonly rateLimits = new Map<string, ChatRateLimitState>();

  join(sessionId: string): void {
    this.rateLimits.set(sessionId, CHAT_RATE_LIMIT_EMPTY);
  }

  leave(sessionId: string): void {
    this.rateLimits.delete(sessionId);
  }

  /** Procesa un mensaje `chat` de `client` (autor visible `authorName`). */
  handle(
    client: Client,
    authorName: string,
    payload: unknown,
    chat: ArraySchema<ChatMessageState>,
  ): void {
    const now = Date.now();
    const rate = checkChatRateLimit(
      this.rateLimits.get(client.sessionId) ?? CHAT_RATE_LIMIT_EMPTY,
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
    this.rateLimits.set(client.sessionId, rate.state);

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
    message.authorName = authorName;
    message.text = filtered.text;
    message.ts = now;
    message.filtered = filtered.filtered;

    chat.push(message);
    while (chat.length > CHAT_HISTORY_LIMIT) {
      chat.shift();
    }
  }
}
