import {
  CREATOR_CHAT_ERROR_CODES,
  type CreatorChatErrorCode,
  type CreatorChatEvent,
  type CreatorChatLink,
  type CreatorChatUsage,
} from "./creator-chat-protocol";

/** Aviso del sistema en el hilo (topes, errores, fin anómalo). */
export type CreatorChatNotice =
  | { kind: "limit"; reason: "turns" | "tokens" }
  | { kind: "error"; code: CreatorChatErrorCode | "UNKNOWN" }
  | { kind: "stop"; reason: "refusal" | "max_tokens" };

export type CreatorChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: "running" | "ok" | "error";
      text: string;
      code: string | null;
      link: CreatorChatLink | null;
    }
  | { kind: "notice"; id: string; notice: CreatorChatNotice };

export type CreatorChatState = {
  items: CreatorChatItem[];
  conversationId: string | null;
  roomId: string | null;
  usage: CreatorChatUsage | null;
  /** Hay una respuesta en curso. */
  pending: boolean;
  /** Tope alcanzado: la conversación no admite más mensajes. */
  closed: boolean;
};

export function initialCreatorChatState(roomId: string | null = null): CreatorChatState {
  return { items: [], conversationId: null, roomId, usage: null, pending: false, closed: false };
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function asChatErrorCode(code: unknown): CreatorChatErrorCode | "UNKNOWN" {
  return typeof code === "string" && (CREATOR_CHAT_ERROR_CODES as readonly string[]).includes(code)
    ? (code as CreatorChatErrorCode)
    : "UNKNOWN";
}

/** El creador envía un mensaje. */
export function startUserMessage(state: CreatorChatState, text: string): CreatorChatState {
  return {
    ...state,
    pending: true,
    items: [...state.items, { kind: "user", id: nextId("user"), text }],
  };
}

/** Aviso local (p. ej. la petición falló antes de abrir el stream). */
export function addNotice(state: CreatorChatState, notice: CreatorChatNotice): CreatorChatState {
  return {
    ...state,
    pending: false,
    items: [...state.items, { kind: "notice", id: nextId("notice"), notice }],
  };
}

/** Fin del stream, haya llegado o no `done`. */
export function finishResponse(state: CreatorChatState): CreatorChatState {
  return { ...state, pending: false };
}

/** Aplica un evento del stream al hilo (pura: la usan la UI y los tests). */
export function applyChatEvent(state: CreatorChatState, event: CreatorChatEvent): CreatorChatState {
  switch (event.type) {
    case "conversation":
      return {
        ...state,
        conversationId: event.conversationId,
        roomId: event.roomId ?? state.roomId,
      };
    case "text": {
      const last = state.items.at(-1);
      if (last?.kind === "assistant") {
        return {
          ...state,
          items: [...state.items.slice(0, -1), { ...last, text: last.text + event.delta }],
        };
      }
      return {
        ...state,
        items: [...state.items, { kind: "assistant", id: nextId("assistant"), text: event.delta }],
      };
    }
    case "tool_call":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "tool",
            id: event.id,
            name: event.name,
            input: event.input,
            status: "running",
            text: "",
            code: null,
            link: null,
          },
        ],
      };
    case "tool_result":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "tool" && item.id === event.id
            ? {
                ...item,
                status: event.isError ? "error" : "ok",
                text: event.text,
                code: event.code,
                link: event.link,
              }
            : item,
        ),
      };
    case "room":
      return { ...state, roomId: event.roomId };
    case "usage":
      return {
        ...state,
        usage: {
          turns: event.turns,
          maxTurns: event.maxTurns,
          tokens: event.tokens,
          maxTokens: event.maxTokens,
        },
      };
    case "limit":
      return {
        ...addNotice(state, { kind: "limit", reason: event.reason }),
        closed: true,
      };
    case "error":
      return addNotice(state, { kind: "error", code: event.code });
    case "done":
      return event.stopReason === "refusal" || event.stopReason === "max_tokens"
        ? addNotice(state, { kind: "stop", reason: event.stopReason })
        : finishResponse(state);
  }
}
