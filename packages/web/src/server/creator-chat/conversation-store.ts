import { randomUUID } from "node:crypto";
import type { ChatMessage } from "./provider";

/** Estado de una conversación del chat del creador (solo en servidor). */
export type ChatConversation = {
  id: string;
  /** Dueño: solo él puede continuarla. */
  userId: string;
  /** Idioma en el que responde el asistente. */
  locale: string;
  /** Draft sobre el que trabaja (el de `?roomId=` o el que crea `create_room`). */
  roomId: string | null;
  /** Prompt de sistema, fijo durante la conversación (prefijo cacheable). */
  system: string;
  messages: ChatMessage[];
  /** Llamadas al modelo consumidas. */
  turns: number;
  /** Tokens (entrada + salida) consumidos. */
  tokens: number;
  /** Hay una respuesta en curso (una sola a la vez por conversación). */
  busy: boolean;
  updatedAt: number;
};

export interface ChatConversationStore {
  create(input: {
    userId: string;
    locale: string;
    roomId: string | null;
    system: string;
  }): ChatConversation;
  /** La conversación si existe, no caducó y es de `userId`. */
  get(id: string, userId: string): ChatConversation | null;
  touch(conversation: ChatConversation): void;
  /** Conversaciones vivas (no caducadas) de `userId` (B-6: tope por usuario). */
  countActive(userId: string): number;
}

export type InMemoryConversationStoreOptions = {
  /** Inactividad tras la que se olvida una conversación (por defecto 6 h). */
  ttlMs?: number;
  /** Máximo de conversaciones en memoria; se descartan las más antiguas (500). */
  maxConversations?: number;
  now?: () => number;
};

/**
 * Conversaciones en memoria del proceso. El historial (y con él los contadores
 * de turnos y tokens) vive en el servidor: el cliente solo envía el id y su
 * mensaje, así no puede reescribir la historia ni reiniciar los topes sin
 * empezar una conversación nueva. Al reiniciar el proceso se pierden; el draft
 * no, porque vive en la base de datos.
 */
export function createInMemoryConversationStore(
  options: InMemoryConversationStoreOptions = {},
): ChatConversationStore {
  const ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000;
  const max = options.maxConversations ?? 500;
  const now = options.now ?? Date.now;
  const conversations = new Map<string, ChatConversation>();

  const evict = () => {
    const limit = now() - ttlMs;
    for (const [id, conversation] of conversations) {
      if (conversation.updatedAt < limit && !conversation.busy) conversations.delete(id);
    }
    // Map conserva el orden de inserción; `touch` reinserta al final.
    for (const id of conversations.keys()) {
      if (conversations.size <= max) break;
      conversations.delete(id);
    }
  };

  return {
    create({ userId, locale, roomId, system }) {
      evict();
      const conversation: ChatConversation = {
        id: randomUUID(),
        userId,
        locale,
        roomId,
        system,
        messages: [],
        turns: 0,
        tokens: 0,
        busy: false,
        updatedAt: now(),
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    get(id, userId) {
      const conversation = conversations.get(id);
      if (!conversation || conversation.userId !== userId) return null;
      if (conversation.updatedAt < now() - ttlMs) {
        conversations.delete(id);
        return null;
      }
      return conversation;
    },
    touch(conversation) {
      conversation.updatedAt = now();
      conversations.delete(conversation.id);
      conversations.set(conversation.id, conversation);
    },
    countActive(userId) {
      evict();
      let count = 0;
      for (const conversation of conversations.values()) {
        if (conversation.userId === userId) count += 1;
      }
      return count;
    },
  };
}
