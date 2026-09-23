/**
 * Proveedor del modelo de lenguaje del chat del creador (ticket 4.6). El
 * orquestador solo conoce esta interfaz: la implementación real habla con la
 * API del modelo a través del Vercel AI SDK (`ai-sdk-provider.ts`, con
 * wrappers finos por proveedor en `anthropic-provider.ts`,
 * `openai-provider.ts` y `google-provider.ts`) y la guionizada
 * (`scripted-provider.ts`) sustituye al modelo en tests, sin red.
 *
 * Los mensajes usan un formato neutro. El razonamiento extendido del modelo
 * (p. ej. los bloques `thinking` de Claude) viaja como bloque `reasoning`: el
 * AI SDK ya lo normaliza de forma genérica entre proveedores (lo expone como
 * una content part `reasoning` con metadatos propios del proveedor en
 * `providerOptions`) y lo reenvía tal cual en el siguiente turno si se le
 * devuelve sin tocar — ver el comentario en `ai-sdk-provider.ts`. `opaque` se
 * conserva por si algún proveedor necesita en el futuro un passthrough crudo
 * que el AI SDK no normalice.
 */

export type ChatTextBlock = { type: "text"; text: string };
export type ChatToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ChatToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  /** Texto legible que devuelve la tool del MCP (lo que ve el modelo). */
  content: string;
  isError: boolean;
};
/** Razonamiento extendido del modelo, normalizado por el AI SDK entre proveedores. */
export type ChatReasoningBlock = {
  type: "reasoning";
  text: string;
  /** Metadatos propios del proveedor (p. ej. la firma de un bloque `thinking` de Claude); se reenvían sin tocar. */
  providerOptions?: Record<string, unknown>;
};
/** Bloque propio de un proveedor que debe reenviarse sin cambios. */
export type ChatOpaqueBlock = { type: "opaque"; provider: string; block: unknown };

export type ChatContentBlock =
  | ChatTextBlock
  | ChatToolUseBlock
  | ChatToolResultBlock
  | ChatReasoningBlock
  | ChatOpaqueBlock;

export type ChatMessage = { role: "user" | "assistant"; content: ChatContentBlock[] };

/** Tool ofrecida al modelo: nombre, descripción y JSON Schema del MCP. */
export type ChatToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ChatModelStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export type ChatModelRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  /** Tope de tokens de salida de esta respuesta. */
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Fragmentos de texto según llegan (streaming). */
  onTextDelta?: (delta: string) => void;
};

export type ChatModelUsage = { inputTokens: number; outputTokens: number };

export type ChatModelResponse = {
  content: ChatContentBlock[];
  stopReason: ChatModelStopReason;
  usage: ChatModelUsage;
};

export interface ChatModelProvider {
  /** Identificador del proveedor (`anthropic`, `scripted`). */
  readonly id: string;
  /** Modelo que usa (para logs y la UI). */
  readonly model: string;
  /** Una llamada al modelo: una respuesta del asistente (texto y/o llamadas a tools). */
  complete(request: ChatModelRequest): Promise<ChatModelResponse>;
}

/** Fallo del proveedor, con un código estable para la UI. */
export class ChatProviderError extends Error {
  readonly code: "MODEL_AUTH" | "MODEL_RATE_LIMITED" | "MODEL_ERROR";
  constructor(code: ChatProviderError["code"], message: string) {
    super(message);
    this.name = "ChatProviderError";
    this.code = code;
  }
}
