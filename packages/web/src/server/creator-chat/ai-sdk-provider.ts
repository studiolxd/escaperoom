import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { APICallError, jsonSchema, streamText, tool, type LanguageModel, type ModelMessage } from "ai";
import {
  ChatProviderError,
  type ChatContentBlock,
  type ChatMessage,
  type ChatModelProvider,
  type ChatModelRequest,
  type ChatModelResponse,
  type ChatModelStopReason,
  type ChatToolDefinition,
} from "./provider";

/**
 * Proveedor genérico del chat del creador sobre el Vercel AI SDK (`ai`):
 * `createAnthropicChatProvider`, `createOpenAiChatProvider` y
 * `createGoogleChatProvider` son wrappers finos sobre esta función,
 * parametrizados por un `LanguageModel` ya resuelto de
 * `@ai-sdk/{anthropic,openai,google}`.
 *
 * El bucle de tools sigue siendo del orquestador (`orchestrator.ts`): las
 * tools se declaran SIN `execute`, así que `streamText` para tras devolver
 * la(s) `tool_use` sin ejecutar nada — una llamada al modelo por `complete()`,
 * igual que con el SDK nativo de Anthropic antes de esta migración.
 *
 * Razonamiento extendido (bloques `reasoning`): el SDK nativo de Anthropic
 * exponía los bloques `thinking`/`redacted_thinking` tal cual y el código
 * viejo los reenviaba sin tocar como bloque `opaque`. El AI SDK los
 * normaliza en una content part `reasoning` genérica (con la firma u otros
 * metadatos del proveedor en `providerOptions`) y los reenvía automáticamente
 * en el siguiente turno si se le devuelven los mismos `ModelMessage` sin
 * tocar (comportamiento por defecto, `sendReasoning: true` en el proveedor de
 * Anthropic). Es un cambio de comportamiento intencional: antes era un
 * passthrough crudo específico de Anthropic; ahora es una normalización
 * genérica que en teoría funciona igual con el razonamiento de otros
 * proveedores.
 */

export type CreateAiSdkChatProviderOptions = {
  /** Identificador del proveedor (`anthropic`, `openai`, `google`). */
  id: string;
  /** Modelo ya resuelto contra `@ai-sdk/{anthropic,openai,google}`. */
  model: LanguageModel;
  /** Nombre del modelo (para logs y la UI). */
  modelName: string;
  /**
   * Cachea el prefijo estable (system + tools + historia) en cada turno del
   * bucle — solo tiene sentido en Anthropic (`providerOptions.anthropic.cacheControl`).
   */
  cacheControl?: boolean;
};

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  // El nombre de la tool no viaja en `ChatToolResultBlock` (solo el id del
  // `tool_use`); se recupera de las `tool_use` vistas antes en la historia.
  const toolNameById = new Map<string, string>();
  const result: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
      for (const block of message.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          toolNameById.set(block.id, block.name);
          content.push({ type: "tool-call", toolCallId: block.id, toolName: block.name, input: block.input });
        } else if (block.type === "reasoning") {
          content.push({
            type: "reasoning",
            text: block.text,
            ...(block.providerOptions
              ? { providerOptions: block.providerOptions as SharedV4ProviderOptions }
              : {}),
          });
        }
        // `tool_result` y `opaque` no aparecen en mensajes del asistente.
      }
      result.push({ role: "assistant", content });
      continue;
    }

    // role "user": puede traer texto del creador O resultados de tools (el
    // orquestador nunca mezcla los dos en el mismo `ChatMessage`), pero el AI
    // SDK separa los resultados de tools en un rol `tool` propio.
    const toolResults = message.content.filter(
      (block): block is Extract<ChatContentBlock, { type: "tool_result" }> => block.type === "tool_result",
    );
    const rest = message.content.filter((block) => block.type !== "tool_result");

    if (rest.length > 0) {
      result.push({
        role: "user",
        content: rest
          .filter((block): block is Extract<ChatContentBlock, { type: "text" }> => block.type === "text")
          .map((block) => ({ type: "text", text: block.text })),
      });
    }
    if (toolResults.length > 0) {
      result.push({
        role: "tool",
        content: toolResults.map((block) => ({
          type: "tool-result",
          toolCallId: block.toolUseId,
          toolName: toolNameById.get(block.toolUseId) ?? "unknown_tool",
          output: block.isError
            ? { type: "error-text", value: block.content }
            : { type: "text", value: block.content },
        })),
      });
    }
  }

  return result;
}

function stopReasonOf(finishReason: string): ChatModelStopReason {
  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "tool-calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content-filter":
      return "refusal";
    default:
      return "other";
  }
}

function translateError(error: unknown): unknown {
  if (error instanceof Error && error.name === "AbortError") return error;
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return new ChatProviderError("MODEL_AUTH", error.message);
    if (status === 429) return new ChatProviderError("MODEL_RATE_LIMITED", error.message);
    return new ChatProviderError("MODEL_ERROR", error.message);
  }
  if (error instanceof Error) return new ChatProviderError("MODEL_ERROR", error.message);
  return error;
}

export function createAiSdkChatProvider(options: CreateAiSdkChatProviderOptions): ChatModelProvider {
  return {
    id: options.id,
    model: options.modelName,
    async complete(request: ChatModelRequest): Promise<ChatModelResponse> {
      // streamText no relanza el error de `doStream` (lo envuelve en un
      // `NoOutputGeneratedError` genérico al consumir `content`/`usage`): se
      // captura el error real con `onError` y se prefiere al traducir.
      let streamError: unknown;
      try {
        const tools = Object.fromEntries(
          request.tools.map((definition: ChatToolDefinition) => [
            definition.name,
            tool({ description: definition.description, inputSchema: jsonSchema(definition.inputSchema) }),
          ]),
        );

        const result = streamText({
          model: options.model,
          system: request.system,
          messages: toModelMessages(request.messages),
          tools,
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: request.signal,
          onError: ({ error }) => {
            streamError = error;
          },
          ...(options.cacheControl
            ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
            : {}),
        });

        if (request.onTextDelta) {
          for await (const delta of result.textStream) request.onTextDelta(delta);
        }

        const [content, finishReason, usage] = await Promise.all([
          result.content,
          result.finishReason,
          result.usage,
        ]);

        const blocks: ChatContentBlock[] = [];
        for (const part of content) {
          if (part.type === "text") {
            blocks.push({ type: "text", text: part.text });
          } else if (part.type === "reasoning") {
            blocks.push({
              type: "reasoning",
              text: part.text,
              ...(part.providerMetadata ? { providerOptions: part.providerMetadata } : {}),
            });
          } else if (part.type === "tool-call") {
            const input =
              typeof part.input === "object" && part.input !== null
                ? (part.input as Record<string, unknown>)
                : {};
            blocks.push({ type: "tool_use", id: part.toolCallId, name: part.toolName, input });
          }
        }

        return {
          content: blocks,
          stopReason: stopReasonOf(finishReason),
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
          },
        };
      } catch (error) {
        throw translateError(streamError ?? error);
      }
    },
  };
}
