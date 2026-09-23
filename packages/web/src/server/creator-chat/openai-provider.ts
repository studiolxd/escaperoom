import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createAiSdkChatProvider } from "./ai-sdk-provider";
import type { ChatModelProvider } from "./provider";

/** Modelo por defecto del chat del creador con OpenAI (configurable con `CREATOR_CHAT_MODEL`). */
export const DEFAULT_OPENAI_CREATOR_CHAT_MODEL = "gpt-5.1";

export type OpenAiProviderOptions = {
  apiKey: string;
  model?: string;
  /** Modelo del AI SDK ya construido (tests); por defecto, `createOpenAI({ apiKey })(model)`. */
  languageModel?: LanguageModel;
};

/** Proveedor sobre OpenAI vía el Vercel AI SDK (`@ai-sdk/openai`), mismo contrato que `anthropic-provider.ts`. */
export function createOpenAiChatProvider(options: OpenAiProviderOptions): ChatModelProvider {
  const model = options.model ?? DEFAULT_OPENAI_CREATOR_CHAT_MODEL;
  const languageModel = options.languageModel ?? createOpenAI({ apiKey: options.apiKey })(model);
  return createAiSdkChatProvider({ id: "openai", model: languageModel, modelName: model });
}
