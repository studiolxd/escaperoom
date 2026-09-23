import Anthropic from "@anthropic-ai/sdk";
import {
  ChatProviderError,
  type ChatContentBlock,
  type ChatMessage,
  type ChatModelProvider,
  type ChatModelRequest,
  type ChatModelResponse,
  type ChatModelStopReason,
} from "./provider";

const PROVIDER_ID = "anthropic";

/** Modelo por defecto del chat del creador (configurable con `CREATOR_CHAT_MODEL`). */
export const DEFAULT_CREATOR_CHAT_MODEL = "claude-sonnet-5";

export type AnthropicProviderOptions = {
  apiKey: string;
  model?: string;
  /** Cliente ya construido (tests); por defecto, `new Anthropic({ apiKey })`. */
  client?: Anthropic;
};

function toParamBlock(block: ChatContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    case "opaque":
      // Bloques de razonamiento (u otros) del propio modelo: se reenvían tal cual.
      return block.block as Anthropic.ContentBlockParam;
  }
}

function toParams(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
      .filter((block) => block.type !== "opaque" || block.provider === PROVIDER_ID)
      .map(toParamBlock),
  }));
}

function fromBlock(block: Anthropic.ContentBlock): ChatContentBlock {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "tool_use") {
    const input =
      typeof block.input === "object" && block.input !== null
        ? (block.input as Record<string, unknown>)
        : {};
    return { type: "tool_use", id: block.id, name: block.name, input };
  }
  return { type: "opaque", provider: PROVIDER_ID, block };
}

function stopReason(reason: Anthropic.StopReason | null): ChatModelStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function translateError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new ChatProviderError("MODEL_AUTH", error.message);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ChatProviderError("MODEL_AUTH", error.message);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ChatProviderError("MODEL_RATE_LIMITED", error.message);
  }
  if (error instanceof Anthropic.APIError) {
    return new ChatProviderError("MODEL_ERROR", error.message);
  }
  return error;
}

/**
 * Proveedor sobre la API de Anthropic (Messages API en streaming). El bucle
 * de tools lo lleva el orquestador: aquí solo hay UNA llamada por turno.
 *
 * Coste: `cache_control` de nivel superior cachea el prefijo estable
 * (system + tools + historia), que se repite en cada turno del bucle.
 */
export function createAnthropicChatProvider(options: AnthropicProviderOptions): ChatModelProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_CREATOR_CHAT_MODEL;

  return {
    id: PROVIDER_ID,
    model,
    async complete(request: ChatModelRequest): Promise<ChatModelResponse> {
      try {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
            messages: toParams(request.messages),
            cache_control: { type: "ephemeral" },
          },
          { signal: request.signal },
        );
        if (request.onTextDelta) stream.on("text", request.onTextDelta);
        const message = await stream.finalMessage();
        const usage = message.usage;
        return {
          content: message.content.map(fromBlock),
          stopReason: stopReason(message.stop_reason),
          usage: {
            inputTokens:
              usage.input_tokens +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0),
            outputTokens: usage.output_tokens,
          },
        };
      } catch (error) {
        throw translateError(error);
      }
    },
  };
}
