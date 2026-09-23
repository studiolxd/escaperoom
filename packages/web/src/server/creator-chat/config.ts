import { DEFAULT_CREATOR_CHAT_MODEL } from "./anthropic-provider";

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
  | { configured: true; apiKey: string; model: string; limits: CreatorChatLimits };

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Configuración del chat desde el entorno:
 *
 * | Variable | Uso |
 * | --- | --- |
 * | `ANTHROPIC_API_KEY` | Clave de la API de Anthropic. Sin ella el chat está «no configurado». |
 * | `CREATOR_CHAT_MODEL` | Modelo (por defecto `claude-sonnet-5`). |
 * | `CREATOR_CHAT_MAX_TURNS` | Llamadas al modelo por conversación (60). |
 * | `CREATOR_CHAT_MAX_TOKENS` | Tokens por conversación (1 500 000). |
 * | `CREATOR_CHAT_MAX_OUTPUT_TOKENS` | Tokens de salida por respuesta (16 000). |
 * | `CREATOR_CHAT_TOOL_RESULT_MAX_CHARS` | Caracteres de un resultado de tool para el modelo (12 000). |
 *
 * Un valor no numérico o ≤ 0 se ignora y rige el de por defecto.
 */
export function readCreatorChatConfig(
  env: Record<string, string | undefined> = process.env,
): CreatorChatConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { configured: false };
  const d = DEFAULT_CREATOR_CHAT_LIMITS;
  return {
    configured: true,
    apiKey,
    model: env.CREATOR_CHAT_MODEL?.trim() || DEFAULT_CREATOR_CHAT_MODEL,
    limits: {
      maxTurns: positiveInt(env.CREATOR_CHAT_MAX_TURNS, d.maxTurns),
      maxTokens: positiveInt(env.CREATOR_CHAT_MAX_TOKENS, d.maxTokens),
      maxOutputTokens: positiveInt(env.CREATOR_CHAT_MAX_OUTPUT_TOKENS, d.maxOutputTokens),
      toolResultMaxChars: positiveInt(env.CREATOR_CHAT_TOOL_RESULT_MAX_CHARS, d.toolResultMaxChars),
    },
  };
}
