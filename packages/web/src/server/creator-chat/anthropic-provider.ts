import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createAiSdkChatProvider } from "./ai-sdk-provider";
import type { ChatModelProvider } from "./provider";

/** Modelo por defecto del chat del creador (configurable con `CREATOR_CHAT_MODEL`). */
export const DEFAULT_CREATOR_CHAT_MODEL = "claude-sonnet-5";

export type AnthropicProviderOptions = {
  apiKey: string;
  model?: string;
  /** Modelo del AI SDK ya construido (tests); por defecto, `createAnthropic({ apiKey })(model)`. */
  languageModel?: LanguageModel;
};

/**
 * Proveedor sobre Anthropic vía el Vercel AI SDK (`@ai-sdk/anthropic`). El
 * bucle de tools lo lleva el orquestador: aquí solo hay UNA llamada por
 * turno (ver `ai-sdk-provider.ts`).
 *
 * Coste: se activa `cacheControl` (prefijo estable de system + tools +
 * historia), que se repite en cada turno del bucle — solo tiene sentido en
 * Anthropic.
 */
export function createAnthropicChatProvider(options: AnthropicProviderOptions): ChatModelProvider {
  const model = options.model ?? DEFAULT_CREATOR_CHAT_MODEL;
  const languageModel = options.languageModel ?? createAnthropic({ apiKey: options.apiKey })(model);
  return createAiSdkChatProvider({ id: "anthropic", model: languageModel, modelName: model, cacheControl: true });
}
