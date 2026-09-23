import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { createAiSdkChatProvider } from "./ai-sdk-provider";
import type { ChatModelProvider } from "./provider";

/** Modelo por defecto del chat del creador con Google (configurable con `CREATOR_CHAT_MODEL`). */
export const DEFAULT_GOOGLE_CREATOR_CHAT_MODEL = "gemini-3-pro";

export type GoogleProviderOptions = {
  apiKey: string;
  model?: string;
  /** Modelo del AI SDK ya construido (tests); por defecto, `createGoogleGenerativeAI({ apiKey })(model)`. */
  languageModel?: LanguageModel;
};

/** Proveedor sobre Google Gemini vía el Vercel AI SDK (`@ai-sdk/google`), mismo contrato que `anthropic-provider.ts`. */
export function createGoogleChatProvider(options: GoogleProviderOptions): ChatModelProvider {
  const model = options.model ?? DEFAULT_GOOGLE_CREATOR_CHAT_MODEL;
  const languageModel = options.languageModel ?? createGoogleGenerativeAI({ apiKey: options.apiKey })(model);
  return createAiSdkChatProvider({ id: "google", model: languageModel, modelName: model });
}
