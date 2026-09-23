/**
 * Cliente HTTP directo a la API REST de ElevenLabs (ticket 4.9, specs/15 §1 y
 * §3): sin SDK, fetch + cabecera `xi-api-key`, igual de forma que el resto de
 * proveedores externos opcionales del repo (`ANTHROPIC_API_KEY` en
 * `creator-chat/config.ts`). Sin selector de voz en esta iteración
 * (specs/15 no lo pide): una única voz multilingüe por defecto.
 */

export type ElevenLabsSynthesisResult = { bytes: Uint8Array; contentType: string };

/** Puerto de síntesis de voz: lo único que el servicio de generación necesita. */
export interface ElevenLabsClient {
  synthesize(input: { text: string; voiceId: string }): Promise<ElevenLabsSynthesisResult>;
}

export class ElevenLabsError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

/** Voz multilingüe por defecto de ElevenLabs ("Rachel"): sin selector de voz (fuera de alcance). */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export type ElevenLabsHttpClientOptions = {
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
  /** Inyectable en tests; por defecto el `fetch` global. */
  fetchImpl?: typeof fetch;
};

/** Cliente real: `POST /v1/text-to-speech/{voiceId}`. */
export function createElevenLabsHttpClient(opts: ElevenLabsHttpClientOptions): ElevenLabsClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.elevenlabs.io";
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;

  return {
    async synthesize({ text, voiceId }) {
      const res = await fetchImpl(`${baseUrl}/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": opts.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: modelId }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ElevenLabsError(
          `ElevenLabs respondió ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
          res.status,
        );
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { bytes, contentType: "audio/mpeg" };
    },
  };
}

export type ElevenLabsConfig =
  | { configured: false }
  | { configured: true; apiKey: string; voiceId: string; modelId: string };

/**
 * Configuración desde el entorno:
 *
 * | Variable | Uso |
 * | --- | --- |
 * | `ELEVENLABS_API_KEY` | Clave de la API de ElevenLabs. Sin ella, la generación de audio por IA no está disponible (no rompe el resto de la app). |
 * | `ELEVENLABS_VOICE_ID` | Voz a usar (por defecto, la multilingüe de ElevenLabs). |
 * | `ELEVENLABS_MODEL_ID` | Modelo de síntesis (por defecto `eleven_multilingual_v2`). |
 */
export function readElevenLabsConfig(
  env: Record<string, string | undefined> = process.env,
): ElevenLabsConfig {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return { configured: false };
  return {
    configured: true,
    apiKey,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
  };
}

/** Cliente falso (tests): devuelve bytes deterministas sin red. */
export function createFakeElevenLabsClient(
  opts: { bytes?: Uint8Array; fail?: (input: { text: string; voiceId: string }) => boolean } = {},
): ElevenLabsClient & { calls: Array<{ text: string; voiceId: string }> } {
  const calls: Array<{ text: string; voiceId: string }> = [];
  return {
    calls,
    async synthesize(input) {
      calls.push(input);
      if (opts.fail?.(input)) {
        throw new ElevenLabsError("Fallo simulado de ElevenLabs", 500);
      }
      return { bytes: opts.bytes ?? new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" };
    },
  };
}
