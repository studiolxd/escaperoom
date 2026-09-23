/**
 * Protocolo del chat del creador (ticket 4.6) entre `POST /api/creator-chat` y
 * la UI. La respuesta es un stream NDJSON: un evento JSON por línea, en orden.
 * Este módulo no importa nada de servidor: lo comparten ruta, orquestador y
 * componente cliente.
 */

/** Ruta del endpoint del chat. */
export const CREATOR_CHAT_ENDPOINT = "/api/creator-chat" as const;

/** Tipo MIME del stream de eventos. */
export const CREATOR_CHAT_CONTENT_TYPE = "application/x-ndjson; charset=utf-8" as const;

/** Enlace accionable que devuelve una tool (playtest de `preview`, confirmación de `publish`). */
export type CreatorChatLink = { kind: "preview" | "publish_confirm"; url: string };

/** Por qué terminó una respuesta del asistente. */
export type CreatorChatStopReason = "end_turn" | "refusal" | "max_tokens" | "other";

/** Tope de coste alcanzado (turnos o tokens por conversación). */
export type CreatorChatLimitReason = "turns" | "tokens";

/** Códigos de error del chat con mensaje propio en la UI (`CreatorChat.errors`). */
export const CREATOR_CHAT_ERROR_CODES = [
  "UNAUTHORIZED",
  "CROSS_SITE",
  "NOT_CONFIGURED",
  "INVALID_REQUEST",
  "CONVERSATION_NOT_FOUND",
  "BUSY",
  "MCP_UNAVAILABLE",
  "MODEL_AUTH",
  "MODEL_RATE_LIMITED",
  "MODEL_ERROR",
] as const;
export type CreatorChatErrorCode = (typeof CREATOR_CHAT_ERROR_CODES)[number];

export type CreatorChatUsage = {
  /** Llamadas al modelo consumidas en la conversación. */
  turns: number;
  maxTurns: number;
  /** Tokens (entrada + salida) consumidos en la conversación. */
  tokens: number;
  maxTokens: number;
};

export type CreatorChatEvent =
  /** Primera línea: id de la conversación (el cliente lo reenvía) y draft asociado. */
  | { type: "conversation"; conversationId: string; roomId: string | null }
  /** Fragmento de texto del asistente (streaming). */
  | { type: "text"; delta: string }
  /** El asistente llama a una tool del MCP. */
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  /** Resultado de la tool: el texto legible del MCP y, si falla, su código. */
  | {
      type: "tool_result";
      id: string;
      name: string;
      isError: boolean;
      text: string;
      code: string | null;
      link: CreatorChatLink | null;
    }
  /** La conversación ya trabaja sobre este draft (enlace al editor). */
  | { type: "room"; roomId: string }
  | ({ type: "usage" } & CreatorChatUsage)
  /** Se alcanzó un tope de coste: la conversación no admite más mensajes. */
  | { type: "limit"; reason: CreatorChatLimitReason }
  | { type: "error"; code: CreatorChatErrorCode }
  /** Fin de la respuesta. */
  | { type: "done"; stopReason: CreatorChatStopReason };

/** Cuerpo de `POST /api/creator-chat`. */
export type CreatorChatRequest = {
  /** Mensaje del creador. */
  message: string;
  /** Conversación a continuar; sin él se empieza una nueva. */
  conversationId?: string;
  /** Draft sobre el que empezar (solo al crear la conversación). */
  roomId?: string;
  /** Idioma de la UI: el asistente responde en él. */
  locale?: string;
};

/** Longitud máxima de un mensaje del creador. */
export const CREATOR_CHAT_MAX_MESSAGE_CHARS = 8000;

export function encodeChatEvent(event: CreatorChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Lee un stream NDJSON de eventos del chat. Tolera líneas partidas entre
 * trozos y descarta las que no son JSON.
 */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CreatorChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const event = parseLine(line);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    const last = parseLine(buffer.trim());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): CreatorChatEvent | null {
  if (!line) return null;
  try {
    const value = JSON.parse(line) as unknown;
    if (typeof value === "object" && value !== null && "type" in value) {
      return value as CreatorChatEvent;
    }
  } catch {
    // Línea corrupta: se ignora.
  }
  return null;
}
