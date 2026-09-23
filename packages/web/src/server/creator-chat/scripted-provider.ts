import type {
  ChatContentBlock,
  ChatMessage,
  ChatModelProvider,
  ChatModelRequest,
  ChatModelResponse,
  ChatToolResultBlock,
} from "./provider";

/** Respuesta guionizada del "modelo": texto y/o llamadas a tools. */
export type ScriptedReply = {
  text?: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
};

export type ScriptedStepContext = {
  messages: ChatMessage[];
  /** Resultados de las tools del turno anterior (vacío si el último mensaje es del creador). */
  lastToolResults: ChatToolResultBlock[];
  /** Nombres de las tools ofrecidas al modelo. */
  toolNames: string[];
};

/** Un paso del guion: fijo o calculado a partir de la conversación. */
export type ScriptedStep = ScriptedReply | ((ctx: ScriptedStepContext) => ScriptedReply);

export type ScriptedProvider = ChatModelProvider & {
  /** Peticiones recibidas (para asserts). */
  readonly requests: ChatModelRequest[];
  /** Pasos del guion aún sin consumir. */
  remaining(): number;
};

/** Tokens ficticios: ~4 caracteres por token, como orden de magnitud. */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

/**
 * Proveedor FAKE guionizado (ticket 4.6): cada llamada consume el siguiente
 * paso del guion. Sustituye al modelo en tests y CI —nunca llama a la API— y
 * ejercita el orquestador y el MCP reales. El texto se emite en varios
 * fragmentos para probar el streaming.
 */
export function createScriptedChatProvider(steps: ScriptedStep[]): ScriptedProvider {
  const queue = [...steps];
  const requests: ChatModelRequest[] = [];
  let callCounter = 0;

  return {
    id: "scripted",
    model: "scripted",
    requests,
    remaining: () => queue.length,
    async complete(request: ChatModelRequest): Promise<ChatModelResponse> {
      // Copia de la historia: el orquestador sigue añadiendo mensajes al mismo array.
      requests.push({ ...request, messages: [...request.messages] });
      const step = queue.shift();
      if (!step) throw new Error("scripted provider: el guion no tiene más pasos");
      const last = request.messages.at(-1);
      const lastToolResults =
        last?.role === "user"
          ? last.content.filter(
              (block): block is ChatToolResultBlock => block.type === "tool_result",
            )
          : [];
      const reply =
        typeof step === "function"
          ? step({
              messages: request.messages,
              lastToolResults,
              toolNames: request.tools.map((tool) => tool.name),
            })
          : step;

      const content: ChatContentBlock[] = [];
      if (reply.text) {
        for (const piece of reply.text.match(/\S+\s*/g) ?? []) request.onTextDelta?.(piece);
        content.push({ type: "text", text: reply.text });
      }
      for (const call of reply.toolCalls ?? []) {
        callCounter += 1;
        content.push({
          type: "tool_use",
          id: `toolu_scripted_${callCounter}`,
          name: call.name,
          input: call.input,
        });
      }
      return {
        content,
        stopReason: reply.toolCalls?.length ? "tool_use" : "end_turn",
        usage: {
          inputTokens: estimateTokens([request.system, request.messages]),
          outputTokens: estimateTokens(content),
        },
      };
    },
  };
}
