import { DEFAULT_CREATOR_CHAT_MODEL } from "./anthropic-provider";
import { DEFAULT_GOOGLE_CREATOR_CHAT_MODEL } from "./google-provider";
import { DEFAULT_OPENAI_CREATOR_CHAT_MODEL } from "./openai-provider";

/** Proveedores del modelo de lenguaje soportados por el chat del creador. */
export type CreatorChatProviderId = "anthropic" | "openai" | "google";

/** Topes de coste de una conversación del chat del creador. */
export type CreatorChatLimits = {
  /** Llamadas al modelo por conversación (cada vuelta del bucle de tools cuenta). */
  maxTurns: number;
  /** Tokens de entrada + salida acumulados por conversación. */
  maxTokens: number;
  /** Tokens de salida de cada respuesta. */
  maxOutputTokens: number;
  /** Caracteres del resultado de una tool que se reenvían al modelo. */
  toolResultMaxChars: number;
};

export const DEFAULT_CREATOR_CHAT_LIMITS: CreatorChatLimits = {
  maxTurns: 60,
  maxTokens: 1_500_000,
  maxOutputTokens: 16_000,
  toolResultMaxChars: 12_000,
};

export type CreatorChatConfig =
  | { configured: false }
  | {
      configured: true;
      provider: CreatorChatProviderId;
      apiKey: string;
      model: string;
      limits: CreatorChatLimits;
    };

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<CreatorChatProviderId, string> = {
  anthropic: DEFAULT_CREATOR_CHAT_MODEL,
  openai: DEFAULT_OPENAI_CREATOR_CHAT_MODEL,
  google: DEFAULT_GOOGLE_CREATOR_CHAT_MODEL,
};

/** Variable de entorno con la clave de la API de cada proveedor. */
const API_KEY_ENV_BY_PROVIDER: Record<CreatorChatProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

function isProviderId(value: string): value is CreatorChatProviderId {
  return value === "anthropic" || value === "openai" || value === "google";
}

/**
 * Configuración del chat desde el entorno:
 *
 * | Variable | Uso |
 * | --- | --- |
 * | `CREATOR_CHAT_PROVIDER` | Proveedor del modelo: `anthropic` (por defecto), `openai` o `google`. |
 * | `ANTHROPIC_API_KEY` | Clave de la API de Anthropic (proveedor `anthropic`). |
 * | `OPENAI_API_KEY` | Clave de la API de OpenAI (proveedor `openai`). |
 * | `GOOGLE_GENERATIVE_AI_API_KEY` | Clave de la API de Google Generative AI (proveedor `google`). |
 * | `CREATOR_CHAT_MODEL` | Modelo del proveedor elegido (por defecto, el de ese proveedor: `claude-sonnet-5`, `gpt-5.1` o `gemini-3-pro`). |
 * | `CREATOR_CHAT_MAX_TURNS` | Llamadas al modelo por conversación (60). |
 * | `CREATOR_CHAT_MAX_TOKENS` | Tokens por conversación (1 500 000). |
 * | `CREATOR_CHAT_MAX_OUTPUT_TOKENS` | Tokens de salida por respuesta (16 000). |
 * | `CREATOR_CHAT_TOOL_RESULT_MAX_CHARS` | Caracteres de un resultado de tool para el modelo (12 000). |
 *
 * Un valor no numérico o ≤ 0 se ignora y rige el de por defecto. Sin la
 * clave del proveedor elegido (o de Anthropic si `CREATOR_CHAT_PROVIDER` no
 * se especifica o trae un valor no reconocido) el chat está «no
 * configurado» — falla cerrado en vez de arrancar sin poder llamar al
 * modelo.
 */
export function readCreatorChatConfig(
  env: Record<string, string | undefined> = process.env,
): CreatorChatConfig {
  const rawProvider = env.CREATOR_CHAT_PROVIDER?.trim();
  const provider = rawProvider && isProviderId(rawProvider) ? rawProvider : "anthropic";
  const apiKey = env[API_KEY_ENV_BY_PROVIDER[provider]]?.trim();
  if (!apiKey) return { configured: false };
  const d = DEFAULT_CREATOR_CHAT_LIMITS;
  return {
    configured: true,
    provider,
    apiKey,
    model: env.CREATOR_CHAT_MODEL?.trim() || DEFAULT_MODEL_BY_PROVIDER[provider],
    limits: {
      maxTurns: positiveInt(env.CREATOR_CHAT_MAX_TURNS, d.maxTurns),
      maxTokens: positiveInt(env.CREATOR_CHAT_MAX_TOKENS, d.maxTokens),
      maxOutputTokens: positiveInt(env.CREATOR_CHAT_MAX_OUTPUT_TOKENS, d.maxOutputTokens),
      toolResultMaxChars: positiveInt(env.CREATOR_CHAT_TOOL_RESULT_MAX_CHARS, d.toolResultMaxChars),
    },
  };
}
