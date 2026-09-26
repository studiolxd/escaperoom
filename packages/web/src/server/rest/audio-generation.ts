import {
  AudioGenerationError,
  type Actor,
  type AudioGenerationErrorCode,
  type AudioGenerationService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de generación de audio (ticket 4.9). */
export type AudioGenerationHandlerDeps = {
  generation: AudioGenerationService | null;
  resolveActor: (request: Request) => Promise<Actor>;
};

const STATUS_BY_CODE: Record<AudioGenerationErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 422,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  INSUFFICIENT_CREDITS: 402,
};

const handle = handleDomainErrors(AudioGenerationError, STATUS_BY_CODE);

function requireGeneration(generation: AudioGenerationService | null): AudioGenerationService {
  if (!generation) {
    throw new AudioGenerationError(
      "PROVIDER_UNAVAILABLE",
      "La generación de audio por IA no está configurada (falta ELEVENLABS_API_KEY)",
    );
  }
  return generation;
}

/**
 * Handlers REST de la generación de audio por IA (ticket 4.9, specs/15 §2-3).
 * Adaptadores finos sobre `AudioGenerationService`: el coste, la comprobación
 * de saldo, la llamada a ElevenLabs, la subida y la moderación viven en el
 * servicio de dominio.
 */
export function createAudioGenerationHandlers(deps: AudioGenerationHandlerDeps) {
  return {
    /**
     * `POST /api/audio/generate/preview` — `{ text }`. Sintetiza y devuelve el
     * audio en base64 SIN cobrar ni almacenar (specs/15 §3).
     */
    async preview(request: Request): Promise<Response> {
      return handle(async () => {
        const generation = requireGeneration(deps.generation);
        const actor = await deps.resolveActor(request);
        const body = await readJson(request);
        const result = await generation.preview(actor, body);
        return Response.json(
          {
            costCredits: result.costCredits,
            characterCount: result.characterCount,
            contentType: result.contentType,
            audioBase64: Buffer.from(result.audio).toString("base64"),
          },
          { headers: NO_STORE },
        );
      });
    },

    /**
     * `POST /api/audio/generate/confirm` — `{ text, referenceId }`. Cobra los
     * créditos SOLO si la generación, la subida y el alta tuvieron éxito; el
     * audio queda `approved`, disponible al instante (ADR-039).
     */
    async confirm(request: Request): Promise<Response> {
      return handle(async () => {
        const generation = requireGeneration(deps.generation);
        const actor = await deps.resolveActor(request);
        const body = await readJson(request);
        const result = await generation.confirm(actor, body);
        return Response.json(
          {
            ref: result.ref,
            costCredits: result.costCredits,
            balanceAfter: Number(result.balanceAfter),
            asset: {
              id: result.asset.id,
              status: result.asset.status,
              durationMs: result.asset.durationMs,
              createdAt: result.asset.createdAt.toISOString(),
            },
          },
          { status: 201, headers: NO_STORE },
        );
      });
    },
  };
}
